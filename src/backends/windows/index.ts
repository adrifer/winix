// Windows backend: turns an evaluated host's `windows` IR into the resources
// `winix switch` applies.
//
// Each host gets `resources.json`: every resource with a unique name, its
// category and label (for plans and inspect), what it depends on, and how to
// check and apply it:
//
//   - packages:            winget id, source and the version to install
//   - PowerShell scripts:  testScript / setScript, run by Winix's own runner
//                          (pwsh, or Windows PowerShell for WindowsPowerShellScript)
//   - raw commands:        executable and arguments, run on every switch
//   - other DSC resources: type and properties, applied with `dsc config set`
//
// `winix switch` plans against the machine and applies only what is out of
// date; work that needs administrator rights runs in one elevated step.

import { win32 } from "node:path";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import type { ResourceRef } from "../../core/types.ts";
import type {
  WinDscProperties,
  WinDscResource,
  WinDscPropertyValue,
  WinPackage,
  WinRawCommand,
  WindowsOptions,
} from "../../types/index.ts";
import {
  emptyWindowsLock,
  reconcileInlinePins,
  windowsModulePin,
  type WindowsLock,
  type WindowsLockModule,
} from "./lockfile.ts";
import { isWindowsHost } from "./host.ts";
import {
  filePathLabel, resolveWindowsFileProperties, winixFileModuleProperties, WINIX_FILE_MODULE_RESOURCE_NAME,
} from "../../helpers/windows.ts";
import { powerShellModuleProperties, powerShellRepositoryScripts } from "./powershell.ts";
import {
  powerShellRepositoryUri, resolvePowerShellModule, validateWindowsPowerShellPolicy, windowsSettingsModule,
  type ResolvedPowerShellModule,
} from "../../helpers/windows-repositories.ts";
import { powerShellLiteral as psSingleQuoted } from "../../helpers/utils.ts";
import { windowsSourcePath } from "./paths.ts";
import { optionalFeatureProperties, wslDistroProperties } from "./wsl.ts";
import { fontsProperties } from "./fonts.ts";
import { wallpaperProperties } from "./personalization.ts";
import { npmRegistryProperties } from "./npm.ts";
import { npmRegistryEntries } from "../../helpers/windows-npm.ts";

export { isWindowsHost } from "./host.ts";

/**
 * Per-host generated output for the Windows backend.
 */
export interface WindowsHostOutput {
  /** The host's resources as `winix switch` applies them (JSON). */
  "resources.json": string;
}

/**
 * Generated output for a workspace's Windows hosts, keyed by host name.
 */
export interface WindowsOutput {
  hosts: Record<string, WindowsHostOutput>;
  /** What each host's configuration contains, for plans and inspect. */
  resources: Record<string, WindowsResourceSummary[]>;
  warnings: string[];
}

export type WindowsResourceCategory =
  | "package" | "file" | "startup" | "environment" | "settings" | "powershell"
  | "features" | "wsl" | "fonts" | "command" | "winix" | "other";

/** One resource of a host, with what plans, inspect and switch need to check and apply it. */
export interface WindowsResourceSummary {
  /** Unique within the host; dependsOn refers to it. */
  name: string;
  /** `winget/package`, `command`, or the DSC resource type. */
  type: string;
  category: WindowsResourceCategory;
  label: string;
  /** Applied with administrator rights (in switch's one elevated step). */
  elevated: boolean;
  /** Changing it can require a Windows restart (Winix never restarts). */
  reboot: boolean;
  /** Checking or changing it needs an elevated shell even when not declared elevated. */
  needsElevationToCheck?: boolean;
  dependsOn: string[];
  package?: { id: string; source: string; version?: string; anyVersion: boolean; exact: boolean };
  /** PowerShell script resources: which PowerShell runs them. */
  shell?: "pwsh" | "powershell";
  /** PowerShell script resources: returns $true when in the desired state. */
  testScript?: string;
  /** PowerShell script resources: brings the resource to the desired state. */
  setScript?: string;
  /** Raw commands: run on every switch. */
  command?: { executable: string; arguments: string[] };
  /** Other DSC resources: their properties, for `dsc config test` / `dsc config set`. */
  properties?: WinDscProperties;
}

export const WINGET_PACKAGE_TYPE = "winget/package";
export const RAW_COMMAND_TYPE = "command";
const POWERSHELL_SCRIPT_TYPE = "Microsoft.DSC.Transitional/PowerShellScript";
const WINDOWS_POWERSHELL_SCRIPT_TYPE = "Microsoft.DSC.Transitional/WindowsPowerShellScript";
const WINDOWS_SETTINGS_MODULE_COMMAND_NAME = "Ensure Microsoft Windows Settings module";

/**
 * Generate Windows bundles for every Windows host in the evaluated workspace.
 * Non-Windows hosts are skipped.
 */
export interface GenerateWindowsOptions {
  /**
   * Floating package ids whose installed version is not comparable (winget
   * reports e.g. "Unknown"). They are emitted without `version`, so DSC only
   * ensures presence instead of reinstalling the locked version on every run.
   */
  presenceOnlyPackages?: ReadonlySet<string>;
}

export function generateWindows(
  evaluatedHosts: EvaluatedHost[],
  lock: WindowsLock = emptyWindowsLock(),
  configDir?: string,
  options: GenerateWindowsOptions = {}
): WindowsOutput {
  const hosts: Record<string, WindowsHostOutput> = {};
  const resources: Record<string, WindowsResourceSummary[]> = {};
  const warnings: string[] = [];
  const windowsHosts = evaluatedHosts.filter(isWindowsHost);
  const resolvedLock = reconcileInlinePins(lock, windowsHosts);

  for (const host of windowsHosts) {
    const win = host.windows as WindowsOptions;
    const summaries = generateResources(host.name, win, resolvedLock, configDir, options.presenceOnlyPackages);
    hosts[host.name] = {
      "resources.json": JSON.stringify({ host: host.name, resources: summaries }, null, 2) + "\n",
    };
    resources[host.name] = summaries;
  }

  return { hosts, resources, warnings };
}

/** Describe every resource of one host, with how to check and apply it. */
function generateResources(
  hostName: string,
  win: WindowsOptions,
  lock: WindowsLock,
  configDir?: string,
  presenceOnlyPackages: ReadonlySet<string> = new Set()
): WindowsResourceSummary[] {
  validateWindowsWslResources(win);
  validateWindowsPowerShellPolicy(win);
  const packages = sortedPackages(win.packages ?? {});
  const registrations = Object.entries(win.powershell?.repositories?.repositories ?? {}).map(([name, feed]) => {
    const scripts = powerShellRepositoryScripts(name, powerShellRepositoryUri(feed.uri));
    const resource: WinDscResource = {
      name: `Register PowerShell repository ${name}`,
      resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
      properties: { getScript: scripts.get, testScript: scripts.test, setScript: scripts.set },
      dependsOn: packages.filter((pkg) => pkg.id.toLowerCase() === "microsoft.powershell")
        .map((pkg): ResourceRef => ({ kind: "package", id: pkg.id })),
    };
    Object.defineProperty(resource, "token", { value: Symbol(name), enumerable: false });
    return { name, resource };
  });
  const repositoryDependencies = (repository: string): ResourceRef[] => registrations
    .filter((entry) => entry.name.toLowerCase() === repository.toLowerCase())
    .map((entry) => ({ kind: "dsc", token: entry.resource.token! }));
  const developerModeRefs: ResourceRef[] = (win.dsc ?? [])
    .filter((resource) => resource.winix?.kind === "setting" && resource.properties?.DeveloperMode === true)
    .map((resource) => ({ kind: "dsc", token: resource.token! }));
  const npmResource: WinDscResource[] = win.npm?.registries ? [{
    resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
    name: "npm registries",
    properties: npmRegistryProperties(npmRegistryEntries(win.npm.registries)),
  }] : [];
  // File test/set scripts share one module instead of repeating their helpers.
  const fileModule: WinDscResource | undefined = (win.dsc ?? []).some(
    (resource) => resource.winix?.kind === "file" && resource.winix.action !== "remove",
  ) ? {
    name: WINIX_FILE_MODULE_RESOURCE_NAME,
    resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
    properties: winixFileModuleProperties(),
  } : undefined;
  if (fileModule) Object.defineProperty(fileModule, "token", { value: Symbol("winix-file-module"), enumerable: false });
  const fileModuleRefs: ResourceRef[] = fileModule ? [{ kind: "dsc", token: fileModule.token! }] : [];
  const resources = [...(win.dsc ?? []), ...npmResource].map((resource) => {
    const metadata = resource.winix;
    if (metadata?.kind === "fonts") {
      return cloneDscResource(resource, fontsProperties(metadata.sources, lock, configDir));
    }
    if (metadata?.kind === "wallpaper") {
      return cloneDscResource(resource, wallpaperProperties(metadata.wallpaper, configDir));
    }
    if (metadata?.kind === "file") {
      const properties = resolveWindowsFileProperties(resource, configDir, windowsSourcePath);
      if (metadata.wslConfig && properties) {
        properties.setScript += "\nWrite-Warning 'WSL configuration changed. Restart WSL manually when safe; Winix will not stop running distros.'";
      }
      const moduleRefs = metadata.action === "remove" ? [] : fileModuleRefs;
      const dependencies = [
        ...(resource.dependsOn ?? []), ...(metadata.action === "symlink" ? developerModeRefs : []), ...moduleRefs,
      ];
      return cloneDscResource(resource, properties, dependencies.length > 0 ? dependencies : undefined);
    }
    if (metadata?.kind === "optional-features") {
      return cloneDscResource(resource, optionalFeatureProperties(metadata.names, metadata.enabled));
    }
    if (metadata?.kind === "wsl-distro") {
      const setupRefs: ResourceRef[] = (win.dsc ?? [])
        .filter((entry) => (entry.winix?.kind === "optional-features" && entry.winix.enabled &&
          entry.winix.names.some((name) => WSL_FEATURES.includes(name.toLowerCase()))) ||
          (entry.winix?.kind === "file" && entry.winix.wslConfig))
        .map((entry) => ({ kind: "dsc", token: entry.token! }));
      const runtime = packages.find((pkg) => pkg.id.toLowerCase() === "microsoft.wsl")!;
      return cloneDscResource(resource, wslDistroProperties(metadata.distro, lock.wslImages ?? {}, lock.wslRepositories ?? {}), [
        ...setupRefs, { kind: "package", id: runtime.id }, ...(resource.dependsOn ?? []),
      ]);
    }
    if (metadata?.kind === "powershell-module") {
      const module = resolvePowerShellModule(win, metadata.module);
      const pin = windowsModulePin(lock, module);
      if (!pin) {
        throw new Error(`PowerShell module "${module.name}" has no matching pin in winix-windows.lock. Run winix update --windows.`);
      }
      const dependencies = [...repositoryDependencies(module.repository), ...(resource.dependsOn ?? [])];
      if (packages.some((pkg) => pkg.id === "Microsoft.PowerShell") &&
          !dependencies.some((ref) => ref.kind === "package" && ref.id === "Microsoft.PowerShell")) {
        dependencies.push({ kind: "package", id: "Microsoft.PowerShell" });
      }
      return cloneDscResource(resource, powerShellModuleProperties(module, pin), dependencies);
    }
    return resource;
  });
  const settingsModule = windowsSettingsModule(win);
  const prepared = prepareWindowsDscResources(win.commands ?? [], resources, settingsModule, lock,
    [...repositoryDependencies(settingsModule.repository),
      ...packages.filter((pkg) => pkg.id.toLowerCase() === "microsoft.powershell")
        .map((pkg): ResourceRef => ({ kind: "package", id: pkg.id }))]);
  const commands = prepared.commands;
  const dscResources = [
    ...registrations.map((entry) => entry.resource), ...(fileModule ? [fileModule] : []), ...prepared.dscResources,
  ];

  // Two-pass: first assign every resource a unique name and build the
  // ref → name map; then describe each resource, resolving its `dependsOn`.
  const naming = assignResourceNames(hostName, packages, commands, dscResources);

  const summaries: WindowsResourceSummary[] = [];
  for (const pkg of packages) {
    const plan = naming.packages.get(pkg)!;
    // version: "any" is presence-only and never needs a lock pin.
    const anyVersion = pkg.anyVersion === true;
    if (anyVersion && pkg.version !== undefined) {
      throw new Error(`Windows package "${pkg.id}" is declared with both version "any" and version "${pkg.version}". Declare one version policy per package.`);
    }
    const version = anyVersion ? undefined : lockedVersionForPackage(pkg, lock);
    const presenceOnly = anyVersion || (pkg.version === undefined && presenceOnlyPackages.has(pkg.id));
    summaries.push({
      name: plan.name, type: plan.type, category: "package", label: pkg.id,
      elevated: pkg.elevated === true, reboot: false, dependsOn: resolveDependsOnRefs(pkg.dependsOn, naming),
      package: {
        id: pkg.id, source: pkg.source, version: presenceOnly ? undefined : version,
        anyVersion, exact: pkg.version !== undefined,
      },
    });
  }
  for (const command of commands) {
    const plan = naming.commands.get(command)!;
    summaries.push({
      name: plan.name, type: plan.type, category: "command",
      label: command.name ?? [command.executable, ...(command.arguments ?? [])].join(" "),
      elevated: false, reboot: false, dependsOn: resolveDependsOnRefs(command.dependsOn, naming),
      command: { executable: command.executable, arguments: [...(command.arguments ?? [])] },
    });
  }
  for (const resource of dscResources) {
    const plan = naming.dsc.get(resource)!;
    summaries.push(summarizeDscResource(resource, plan, naming));
  }

  return summaries;
}

function summarizeDscResource(resource: WinDscResource, plan: ResourcePlan, naming: NamingPlan): WindowsResourceSummary {
  const properties = resource.properties ?? {};
  const scripted = resource.resourceType === POWERSHELL_SCRIPT_TYPE || resource.resourceType === WINDOWS_POWERSHELL_SCRIPT_TYPE;
  if (scripted && (typeof properties.testScript !== "string" || typeof properties.setScript !== "string")) {
    throw new Error(`${resource.resourceType} "${plan.name}" needs testScript and setScript`);
  }
  return {
    name: plan.name, type: plan.type, elevated: needsElevation(resource), reboot: false,
    dependsOn: resolveDependsOnRefs(resource.dependsOn, naming),
    ...(scripted ? {
      shell: resource.resourceType === WINDOWS_POWERSHELL_SCRIPT_TYPE ? "powershell" as const : "pwsh" as const,
      testScript: properties.testScript as string,
      setScript: properties.setScript as string,
    } : { properties }),
    ...describeWindowsDscResource(resource),
  };
}

/**
 * Applied with administrator rights: declared `elevated`, machine-wide
 * environment and PATH changes, and Windows settings (Developer Mode writes
 * machine policy).
 */
function needsElevation(resource: WinDscResource): boolean {
  const metadata = resource.winix;
  return resource.elevated === true ||
    ((metadata?.kind === "env" || metadata?.kind === "path") && metadata.scope === "machine") ||
    metadata?.kind === "setting";
}

/** Category and human label of a declared DSC resource (shared by plans and inspect). */
export function describeWindowsDscResource(resource: WinDscResource): {
  category: WindowsResourceCategory; label: string; reboot?: boolean; needsElevationToCheck?: boolean;
} {
  const metadata = resource.winix;
  switch (metadata?.kind) {
    case "file": {
      const target = filePathLabel(metadata.target).replaceAll("/", "\\");
      const label = metadata.action === "symlink" ? `link ${target} -> ${metadata.source}`
        : metadata.action === "copy" ? `copy ${metadata.source} -> ${target}`
        : metadata.action === "text" ? `write ${target}`
        : `remove ${target}`;
      return { category: metadata.wslConfig ? "wsl" : "file", label };
    }
    case "startup": return { category: "startup", label: `Startup shortcut ${metadata.name}` };
    case "env": return {
      category: "environment",
      label: metadata.action === "set" ? `${metadata.name}=${metadata.value ?? ""} (${metadata.scope})` : `unset ${metadata.name} (${metadata.scope})`,
    };
    case "path": return {
      category: "environment", label: `PATH ${metadata.action === "add" ? "+" : "-"} ${metadata.value} (${metadata.scope})`,
    };
    case "setting": return { category: "settings", label: `Windows settings ${Object.keys(resource.properties ?? {}).join(", ")}`.trim() };
    case "wallpaper": return { category: "settings", label: "Wallpaper" };
    case "fonts": return { category: "fonts", label: `Fonts (${metadata.sources.length} source(s))` };
    case "optional-features": return {
      // Checked through WMI without elevation; only enabling/disabling needs it.
      category: "features", reboot: metadata.enabled,
      label: `${metadata.enabled ? "Enable" : "Disable"} Windows features ${metadata.names.join(", ")}`,
    };
    case "wsl-distro": {
      const host = metadata.distro.host ?? metadata.distro.setup?.host;
      return { category: "wsl", label: `WSL distro ${metadata.distro.name}${host ? ` (${host})` : ""}` };
    }
    case "powershell-module": return { category: "powershell", label: `PowerShell module ${metadata.module.name}` };
  }
  if (resource.name === WINIX_FILE_MODULE_RESOURCE_NAME) {
    return { category: "winix", label: "Winix PowerShell helpers (used by file resources)" };
  }
  if (resource.name === WINDOWS_SETTINGS_MODULE_COMMAND_NAME || resource.name?.startsWith("Register PowerShell repository")) {
    return { category: "powershell", label: resource.name };
  }
  if (resource.name === "Windows personalization") return { category: "settings", label: resource.name };
  return { category: "other", label: resource.name ?? resource.resourceType };
}

const WSL_FEATURES = ["microsoft-windows-subsystem-linux", "virtualmachineplatform"];

export function validateWindowsWslResources(win: WindowsOptions): void {
  const features = new Map<string, boolean>();
  const names = new Set<string>();
  const locations = new Set<string>();
  let defaults = 0;
  let configs = 0;
  let distros = 0;
  for (const resource of win.dsc ?? []) {
    const metadata = resource.winix;
    if (metadata?.kind === "optional-features") {
      for (const name of metadata.names) {
        const key = name.toLowerCase();
        if (features.has(key) && features.get(key) !== metadata.enabled) {
          throw new Error(`Conflicting desired state for Windows optional feature: ${name}`);
        }
        features.set(key, metadata.enabled);
      }
    } else if (metadata?.kind === "wsl-distro") {
      distros++;
      const { distro } = metadata;
      const name = distro.name.toLowerCase();
      const location = (typeof distro.installLocation === "string"
        ? win32.normalize(distro.installLocation)
        : JSON.stringify({ ...distro.installLocation, path: win32.normalize(distro.installLocation.path ?? "") })).toLowerCase();
      if (names.has(name)) throw new Error(`Duplicate WSL distro: ${distro.name}`);
      if (locations.has(location)) throw new Error("WSL distros cannot share an installLocation");
      names.add(name);
      locations.add(location);
      if (distro.default) defaults++;
    } else if (metadata?.kind === "file" && metadata.wslConfig) {
      configs++;
    }
  }
  if (defaults > 1) throw new Error("Only one WSL distro can be declared default per Windows host");
  if (configs > 1) throw new Error("Declare only one windows.wsl({ config }) per Windows host");
  if (distros && !WSL_FEATURES.every((name) => features.get(name) === true)) {
    throw new Error("WSL distro declarations require windows.wsl() or both required optional features enabled");
  }
  if (distros && !Object.values(win.packages ?? {}).some((pkg) => pkg.id.toLowerCase() === "microsoft.wsl")) {
    throw new Error('WSL distro declarations require windows.package("Microsoft.WSL")');
  }
}

function prepareWindowsDscResources(
  commands: readonly WinRawCommand[],
  resources: readonly WinDscResource[],
  settingsModule: ResolvedPowerShellModule,
  lock: WindowsLock,
  repositoryDependencies: ResourceRef[]
): { commands: WinRawCommand[]; dscResources: WinDscResource[] } {
  const envResolvedResources = resolveManagedEnvironmentReferences(resources);
  if (!envResolvedResources.some((resource) => resource.winix?.kind === "setting")) {
    return { commands: [...commands], dscResources: envResolvedResources };
  }

  const pin = windowsModulePin(lock, settingsModule);
  if (!pin) throw new Error('PowerShell module "Microsoft.Windows.Settings" has no matching pin in winix-windows.lock. Run winix update --windows.');
  const ensureModule = createWindowsSettingsEnsureCommand(settingsModule, pin, repositoryDependencies);
  const ensureRef: ResourceRef = { kind: "dsc", token: ensureModule.token! };
  return {
    commands: [...commands],
    dscResources: [
      ensureModule,
      ...envResolvedResources.map((resource) => {
        if (resource.winix?.kind !== "setting") return resource;
        return cloneDscResource(resource, resource.properties, [
          ensureRef,
          ...(resource.dependsOn ?? []),
        ]);
      }),
    ],
  };
}

function createWindowsSettingsEnsureCommand(
  module: ResolvedPowerShellModule, pin: WindowsLockModule, dependsOn: ResourceRef[]
): WinDscResource {
  const resource: WinDscResource = {
    name: WINDOWS_SETTINGS_MODULE_COMMAND_NAME,
    resourceType: "Microsoft.DSC.Transitional/PowerShellScript",
    dependsOn,
    properties: powerShellModuleProperties(module, pin),
  };
  Object.defineProperty(resource, "token", {
    value: Symbol("winix.windows-settings-module"),
    enumerable: false,
    configurable: true,
  });
  return resource;
}

interface ManagedEnvEntry {
  name: string;
  value: string;
}

const WINDOWS_ENV_TOKEN = /%([^%]+)%/g;

function canonicalEnvName(name: string): string {
  return name.toLocaleUpperCase("en-US");
}

function resolveManagedEnvironmentReferences(
  resources: readonly WinDscResource[]
): WinDscResource[] {
  if (resources.length === 0) return [];

  const managedEnv = new Map<string, ManagedEnvEntry>();
  for (const resource of resources) {
    const metadata = resource.winix;
    if (metadata?.kind === "env" && metadata.action === "set") {
      managedEnv.set(canonicalEnvName(metadata.name), {
        name: metadata.name,
        value: metadata.value ?? "",
      });
    }
  }

  if (managedEnv.size === 0) return [...resources];

  const resolvedEnv = new Map<string, string>();
  const resolveEnv = (key: string, stack: string[]): string => {
    const cached = resolvedEnv.get(key);
    if (cached !== undefined) return cached;

    const entry = managedEnv.get(key);
    if (!entry) return `%${key}%`;

    const nextStack = [...stack, key];
    const resolved = entry.value.replace(WINDOWS_ENV_TOKEN, (token, name: string) => {
      const depKey = canonicalEnvName(name);
      if (!managedEnv.has(depKey)) return token;

      const cycleStart = nextStack.indexOf(depKey);
      if (cycleStart !== -1) {
        const cycle = [...nextStack.slice(cycleStart), depKey]
          .map((cycleKey) => managedEnv.get(cycleKey)?.name ?? cycleKey)
          .join(" -> ");
        throw new Error(`Circular Windows environment variable reference: ${cycle}`);
      }

      return resolveEnv(depKey, nextStack);
    });

    resolvedEnv.set(key, resolved);
    return resolved;
  };

  for (const key of managedEnv.keys()) {
    resolveEnv(key, []);
  }

  const resolveString = (value: string): string =>
    value.replace(WINDOWS_ENV_TOKEN, (token, name: string) => {
      const key = canonicalEnvName(name);
      return managedEnv.has(key) ? resolveEnv(key, []) : token;
    });

  return resources.map((resource) => {
    const metadata = resource.winix;
    if (metadata?.kind === "env" && metadata.action === "set") {
      const resolvedValue = resolveString(metadata.value ?? "");
      const properties = rewriteEnvValue(resource.properties, resolvedValue);
      return cloneDscResource(resource, properties);
    }
    if (metadata?.kind === "path") {
      const resolvedValue = resolveString(metadata.value);
      if (resolvedValue === metadata.value) return resource;
      const properties = rewritePathValue(resource.properties, metadata.value, resolvedValue);
      return cloneDscResource(resource, properties);
    }
    return resource;
  });
}

function rewriteEnvValue(
  properties: WinDscProperties | undefined,
  value: string
): WinDscProperties | undefined {
  if (!properties) return properties;
  const valueData = properties.valueData;
  if (!valueData || typeof valueData !== "object" || Array.isArray(valueData)) {
    return properties;
  }
  return {
    ...properties,
    valueData: {
      ...valueData,
      String: value,
    },
  };
}

function rewritePathValue(
  properties: WinDscProperties | undefined,
  originalValue: string,
  resolvedValue: string
): WinDscProperties | undefined {
  if (!properties) return properties;
  const original = psSingleQuoted(originalValue);
  const resolved = psSingleQuoted(resolvedValue);
  const rewritten: WinDscProperties = {};
  for (const [key, value] of Object.entries(properties)) {
    rewritten[key] = rewritePathPropertyValue(value, original, resolved);
  }
  return rewritten;
}

function rewritePathPropertyValue(
  value: WinDscPropertyValue,
  original: string,
  resolved: string
): WinDscPropertyValue {
  if (typeof value === "string") {
    return value.replaceAll(original, resolved);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => rewritePathPropertyValue(entry, original, resolved));
  }
  if (value && typeof value === "object") {
    const rewritten: { [key: string]: WinDscPropertyValue } = {};
    for (const [key, child] of Object.entries(value)) {
      rewritten[key] = rewritePathPropertyValue(child, original, resolved);
    }
    return rewritten;
  }
  return value;
}

function cloneDscResource(
  resource: WinDscResource,
  properties: WinDscProperties | undefined,
  dependsOn: ResourceRef[] | undefined = resource.dependsOn
): WinDscResource {
  const cloned: WinDscResource = { ...resource, properties };
  if (dependsOn) cloned.dependsOn = dependsOn;
  else delete cloned.dependsOn;
  if (resource.token) {
    Object.defineProperty(cloned, "token", {
      value: resource.token,
      enumerable: false,
      configurable: true,
    });
  }
  if (resource.winix) {
    Object.defineProperty(cloned, "winix", {
      value: resource.winix,
      enumerable: false,
      configurable: true,
    });
  }
  return cloned;
}

/** A resource's resolved DSC identity: its type and schema-valid name. */
interface ResourcePlan {
  type: string;
  name: string;
}

/** The naming plan for one host: per-resource plans plus the ref lookup map. */
interface NamingPlan {
  packages: Map<WinPackage, ResourcePlan>;
  commands: Map<WinRawCommand, ResourcePlan>;
  dsc: Map<WinDscResource, ResourcePlan>;
  /** Resolve a dependsOn ref to the depended-upon resource's plan. */
  byPackageId: Map<string, ResourcePlan>;
  byCommandToken: Map<symbol, ResourcePlan>;
  byDscToken: Map<symbol, ResourcePlan>;
  hostName: string;
}

/**
 * Turn an arbitrary identifier into a resource name: letters, numbers and
 * single spaces (`Git.Git` → `Git Git`). Names are stable across runs and are
 * what dependsOn and the plan refer to; the package id itself is kept in
 * `package.id`.
 */
function sanitizeName(raw: string): string {
  const cleaned = raw.replace(/[^a-zA-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.length > 0 ? cleaned : "resource";
}

/**
 * Assign a unique name to every resource in a host and build the lookup maps
 * used to resolve `dependsOn` references.
 *
 * Naming rules:
 * - Packages use the sanitized package id (`Git.Git` → `Git Git`).
 * - Commands use their explicit `name` (sanitized) when given, else a generated
 *   `command N` counter in declaration order.
 * - On a name collision, a ` N` suffix keeps names unique.
 */
function assignResourceNames(
  hostName: string,
  packages: readonly WinPackage[],
  commands: readonly WinRawCommand[],
  dscResources: readonly WinDscResource[]
): NamingPlan {
  const used = new Set<string>();
  const plan: NamingPlan = {
    packages: new Map(),
    commands: new Map(),
    dsc: new Map(),
    byPackageId: new Map(),
    byCommandToken: new Map(),
    byDscToken: new Map(),
    hostName,
  };

  const unique = (base: string): string => {
    let name = base;
    let n = 2;
    while (used.has(name)) {
      name = `${base} ${n}`;
      n += 1;
    }
    used.add(name);
    return name;
  };

  for (const pkg of packages) {
    const name = unique(sanitizeName(pkg.id));
    const rp: ResourcePlan = { type: WINGET_PACKAGE_TYPE, name };
    plan.packages.set(pkg, rp);
    plan.byPackageId.set(pkg.id, rp);
  }

  let commandCounter = 0;
  for (const command of commands) {
    commandCounter += 1;
    const base = command.name
      ? sanitizeName(command.name)
      : `command ${commandCounter}`;
    const name = unique(base);
    const rp: ResourcePlan = { type: RAW_COMMAND_TYPE, name };
    plan.commands.set(command, rp);
    if (command.token) {
      plan.byCommandToken.set(command.token, rp);
    }
  }

  let dscCounter = 0;
  for (const resource of dscResources) {
    dscCounter += 1;
    const base = resource.name
      ? sanitizeName(resource.name)
      : `dsc ${dscCounter}`;
    const name = unique(base);
    const rp: ResourcePlan = { type: resource.resourceType, name };
    plan.dsc.set(resource, rp);
    if (resource.token) {
      plan.byDscToken.set(resource.token, rp);
    }
  }

  return plan;
}

/**
 * Resolve a resource's `dependsOn` references into resource names. Throws when
 * a referenced resource is not declared in this host, which happens if a
 * handle from another host is passed to `dependsOn`.
 */
function resolveDependsOnRefs(
  refs: ResourceRef[] | undefined,
  naming: NamingPlan
): string[] {
  if (!refs || refs.length === 0) return [];
  const ids: string[] = [];
  for (const ref of refs) {
    let target: ResourcePlan | undefined;
    let what: string;
    if (ref.kind === "package") {
      target = naming.byPackageId.get(ref.id);
      what = `package "${ref.id}"`;
    } else if (ref.kind === "command") {
      target = naming.byCommandToken.get(ref.token);
      what = "a raw command";
    } else {
      target = naming.byDscToken.get(ref.token);
      what = "a DSC resource";
    }
    if (!target) {
      throw new Error(
        `windows dependsOn references ${what} that is not declared in host ` +
        `"${naming.hostName}". Resources can only depend on other resources ` +
        `within the same host.`
      );
    }
    ids.push(target.name);
  }
  return [...new Set(ids)];
}

/**
 * Stable ordering: packages sorted by id so the output is deterministic
 * regardless of declaration/merge order.
 */
function sortedPackages(packages: Record<string, WinPackage>): WinPackage[] {
  return Object.keys(packages)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((id) => packages[id]);
}

function lockedVersionForPackage(pkg: WinPackage, lock: WindowsLock): string {
  const entry = lock.packages[pkg.id];
  if (!entry) {
    throw new Error(
      `Windows package "${pkg.id}" is not locked. It has no inline version pin ` +
      `and no entry in winix-windows.lock. Run \`winix update --windows\` first.`
    );
  }
  if (entry.source !== pkg.source) {
    throw new Error(
      `Windows package "${pkg.id}" source mismatch in winix-windows.lock: ` +
      `expected "${pkg.source}", found "${entry.source}". Update the lock entry ` +
      `or change the package source in config.`
    );
  }
  return entry.version;
}
