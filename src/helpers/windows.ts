// Windows helper namespace: `windows.*` authoring surface.
//
// MVP vertical slice: packages plus raw commands. Mirrors the shape and
// naming of the `nixos.*` / `darwin.*` namespaces. Additional helpers
// (env, path, file, dsc, wsl, programs) land in follow-up milestones.

import type { Fragment, HostDef, ResourceHandle, ResourceRef } from "../core/types.ts";
import type { AccountUserRef } from "./account.ts";
import { getOptionalEvalContext } from "../sdk/index.ts";
import { inferWslSetupRepository } from "./wsl-repository.ts";
import { resolve, win32, posix } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { powerShellLiteral as psSingleQuoted } from "./utils.ts";
import type {
  WinDscProperties,
  WinDscMetadata,
  WinDscResource,
  WinPackage,
  WinPackageSource,
  WinRawCommand,
  WinSettings,
  WinFilePath,
  WinKnownFolder,
  WinKnownFolderName,
  WinStartupCommand,
  WinStartupWindowStyle,
  WinStartupAppWindowStyle,
  WinStartupExplorerOptions,
  WinWslConfig,
  WinWslDistro,
  WinWslSetup,
  WinPowerShellRepositoryPolicy,
  WinFontSource,
  WinWallpaper,
  WinPersonalization,
} from "../types/index.ts";
import { validatePowerShellRepositoryPolicy } from "./windows-repositories.ts";
import { validateFontSources, validateWallpaper, personalizationValues } from "./windows-personalization.ts";
import { personalizationProperties } from "../backends/windows/personalization.ts";
import { npmRegistryEntries } from "./windows-npm.ts";
import type { WinNpmRegistryPolicy } from "../types/windows.ts";

/**
 * Accepted call shapes for `windows.package(...)`.
 *
 * - `"Git.Git"`            → sugar for `{ source: "winget", id: "Git.Git" }`
 * - `{ id, source?, version? }` → explicit form
 */
export interface WinPackageSpec {
  id: string;
  source?: WinPackageSource;
  /**
   * Omitted: pinned in winix-windows.lock (newer installs are kept).
   * `"1.2.3"`: exactly this version. `"any"`: installed in any version; for
   * apps that update themselves or report no usable version. Never locked,
   * compared or downgraded.
   */
  version?: string;
  elevated?: boolean;
  /**
   * Resources this package must be applied after. Accepts a single handle or
   * an array of handles returned by resource-producing `windows.*` helpers.
   */
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinPackageArg = string | WinPackageSpec;

/** Options for the `windows.package(id, opts)` form. */
export type WinPackageOpts = Omit<WinPackageSpec, "id">;

/**
 * Accepted object shape for `windows.raw(...)`.
 */
export interface WinRawCommandSpec {
  name?: string;
  executable: string;
  arguments?: string[];
  /**
   * Resources this command must run after. Accepts a single handle or an array
   * of handles.
   */
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinRawCommandArg = string | WinRawCommandSpec;

/**
 * Accepted object shape for `windows.dsc(...)`, the generic DSC v3 escape
 * hatch. `type` is the fully qualified DSC resource type; `properties` is a
 * free-form JSON-like object serialized verbatim to YAML.
 */
export interface WinDscSpec {
  type: string;
  name?: string;
  properties?: WinDscProperties;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/** Options for `windows.setting(...)`. */
export interface WinSettingOpts {
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinPowerShellModuleOpts {
  /** Registered repository; inherits the host policy, otherwise PSGallery. */
  repository?: string;
  /** Include prereleases during lock resolution. Defaults to stable releases only. */
  prerelease?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

interface WinStartupSpecBase extends Omit<WinStartupCommand, "executable" | "arguments" | "workingDirectory" | "windowStyle"> {
  /**
   * Path, application name, or a windows.file.* handle (its target is used and
   * the file becomes a dependency). The same applies to arguments and
   * workingDirectory.
   */
  executable: WinFilePath | ResourceHandle;
  arguments?: (WinFilePath | ResourceHandle)[];
  workingDirectory?: WinFilePath | ResourceHandle;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinStartupAppSpec extends WinStartupSpecBase {
  /** "hidden" runs console programs without a window. Defaults to "normal". */
  windowStyle?: WinStartupAppWindowStyle;
  /** Seconds after sign-in before it starts (0 to 3600). Defaults to 0. */
  delay?: number;
}

export interface WinStartupShortcutSpec extends WinStartupSpecBase {
  windowStyle?: WinStartupWindowStyle;
  /** Move a different existing shortcut of this name to %LOCALAPPDATA%\Winix\startup-backups (default unless force). */
  backup?: boolean;
  force?: boolean;
}

export interface WinStartupNamespace {
  /**
   * Start a program when the current user signs in, through a per-user logon
   * task in Task Scheduler's \Winix\ folder: it starts right after sign-in,
   * not after every other startup entry like the Startup folder. Never run
   * during apply; no elevation needed.
   */
  app(name: string, spec: WinStartupAppSpec): ResourceHandle;
  /** A shortcut in the current user's Startup folder, which Explorer opens last at sign-in. */
  shortcut(name: string, spec: WinStartupShortcutSpec): ResourceHandle;
  /**
   * Explorer's startup pacing for Run entries and Startup-folder shortcuts:
   * `delay: false` removes its initial delay, `waitForIdle: false` stops it
   * waiting for the desktop to go idle. `true` restores the Windows default.
   */
  explorer(options: WinStartupExplorerOptions, opts?: WinSettingOpts): ResourceHandle;
}

export interface WinOptionalFeatureOpts {
  enabled?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/**
 * Authoring form of a distro's first-run `setup`. Accepts host/account values
 * instead of matching strings, and `repository: "self"` to clone the
 * checkout that holds winix.config.ts.
 */
export interface WinWslSetupSpec extends Omit<WinWslSetup, "repository" | "configDirectory" | "host" | "user"> {
  /**
   * HTTPS Git URL, or "self": use the tracked remote of the checkout holding
   * winix.config.ts (SSH remotes are converted to HTTPS). With "self", `ref`
   * defaults to the current upstream branch (or commit when detached) and
   * `configDirectory` to the config's path within the repository.
   */
  repository: string;
  /** Required unless `repository` is "self". */
  configDirectory?: string;
  /** Linux host to activate: its name, or the value returned by `host(...)`. */
  host: string | HostDef;
  /** Linux account: its name, or the factory returned by `account.user(...)`. */
  user?: string | AccountUserRef;
}

export interface WinWslDistroSpec extends Omit<WinWslDistro, "name" | "default" | "host" | "setup" | "setupRefFromCheckout"> {
  default?: boolean;
  /** Expected Linux hostname for adoption (a name or `host(...)` value); defaults to setup.host. */
  host?: string | HostDef;
  /** First-run setup for Winix-created distros; never run for adopted distros. */
  setup?: WinWslSetupSpec;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinWslOpts extends Pick<WinFileOpts, "backup" | "force" | "dependsOn"> {
  config?: WinWslConfig;
}

export interface WinWslNamespace {
  /** Declare the locked Microsoft.WSL package, required features, and optional .wslconfig. */
  (opts?: WinWslOpts): ResourceHandle;
  /** Create an absent distro or adopt a matching WSL 2/NixOS/Linux hostname registration. */
  distro(name: string, spec: WinWslDistroSpec): ResourceHandle;
}

const KNOWN_FOLDERS = {
  documents: "MyDocuments",
  desktop: "Desktop",
  localAppData: "LocalApplicationData",
  appData: "ApplicationData",
  userProfile: "UserProfile",
  programFiles: "ProgramFiles",
  programFilesX86: "ProgramFilesX86",
} as const;

function knownFolder(folder: WinKnownFolderName, path = ""): WinKnownFolder {
  if (!Object.hasOwn(KNOWN_FOLDERS, folder)) {
    throw new Error(`Unknown Windows known folder "${folder}"`);
  }
  if (typeof path !== "string" || win32.isAbsolute(path) || /^[a-z]:/i.test(path) ||
      path.split(/[\\/]/).includes("..")) {
    throw new Error("windows.knownFolder path must be relative and cannot contain '..'");
  }
  return { kind: "knownFolder", folder, path };
}

function validFilePath(value: WinFilePath): boolean {
  if (typeof value === "string") return value.length > 0;
  if (!value || value.kind !== "knownFolder") return false;
  knownFolder(value.folder, value.path);
  return true;
}

export function filePathLabel(value: WinFilePath): string {
  return typeof value === "string" ? value : `${value.folder}\\${value.path}`;
}

export function filePathExpression(value: WinFilePath): string {
  if (typeof value === "string") return `Expand-WinixPath ${psSingleQuoted(value)}`;
  const folder = psSingleQuoted(KNOWN_FOLDERS[value.folder]);
  return `& { $root = [Environment]::GetFolderPath(${folder}); ` +
    `if ([string]::IsNullOrWhiteSpace($root)) { throw 'Windows known folder is unavailable: ${value.folder}' }; ` +
    (value.path ? `Join-Path $root ${psSingleQuoted(value.path)}` : "$root") + " }";
}

/** Scope for Windows environment and PATH writes. */
export type WinEnvScope = "user" | "machine";

/** Options shared by `windows.env.*` and `windows.path.*` methods. */
export interface WinEnvOpts {
  scope?: WinEnvScope;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export type WinFileEncoding = "utf8" | "utf8bom" | "ascii";

/** Options shared by `windows.file.*` methods. */
export interface WinFileOpts {
  force?: boolean;
  backup?: boolean;
  recursive?: boolean;
  elevate?: boolean;
  encoding?: WinFileEncoding;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

export interface WinLinkedFileOpts extends Pick<WinFileOpts, "force" | "backup" | "dependsOn"> {
  /** "symlink" (default) keeps the file live-linked to the checkout; "copy" writes a copy. */
  mode?: "symlink" | "copy";
}

export interface WinPowerShellProfileOpts extends WinLinkedFileOpts {
  /** "pwsh" (PowerShell 7, default) or "windowspowershell" (Windows PowerShell 5.1). */
  shell?: "pwsh" | "windowspowershell";
}

export interface WinTerminalSettingsOpts extends WinLinkedFileOpts {
  /** Windows Terminal channel. Defaults to "stable". */
  channel?: "stable" | "preview";
}

/**
 * Resolve `dependsOn` (a single handle or an array) into the stable resource
 * references the emitter wires up. Throws on a value that is not a Winix
 * resource handle (e.g. a plain fragment or a handle from a non-resource
 * helper), since only resources can be ordered.
 */
function resolveDependsOn(
  dependsOn: ResourceHandle | ResourceHandle[] | undefined
): ResourceRef[] | undefined {
  if (!dependsOn) return undefined;
  const handles = Array.isArray(dependsOn) ? dependsOn : [dependsOn];
  if (handles.length === 0) return undefined;
  const refs: ResourceRef[] = [];
  for (const handle of handles) {
    const ref = (handle as Partial<ResourceHandle>)?.__winixHandle;
    if (!ref) {
      throw new Error(
        "windows.*(dependsOn) expects resource handles returned by " +
        "resource-producing windows.* helpers. Got a value without a " +
        "resource identity."
      );
    }
    refs.push(ref);
  }
  return refs;
}

function normalizePackage(arg: WinPackageArg, opts?: WinPackageOpts): WinPackage {
  if (opts !== undefined) {
    if (typeof arg !== "string") {
      throw new Error("windows.package(id, opts) takes an id string; put options in the spec object instead");
    }
    if (!opts || typeof opts !== "object" || Array.isArray(opts) || "id" in opts) {
      throw new Error(`windows.package("${arg}", opts) requires an options object without id`);
    }
    return normalizePackage({ ...opts, id: arg });
  }
  if (typeof arg === "string") {
    if (arg.length === 0) {
      throw new Error("windows.package(id) requires a non-empty package id");
    }
    return { id: arg, source: "winget" };
  }

  if (!arg || typeof arg !== "object") {
    throw new Error("windows.package(...) requires an id string or a spec object");
  }
  if (!arg.id || typeof arg.id !== "string") {
    throw new Error("windows.package({ id }) requires a non-empty id");
  }

  const pkg: WinPackage = {
    id: arg.id,
    source: arg.source ?? "winget",
  };
  if (arg.version !== undefined) {
    if (typeof arg.version !== "string" || arg.version.length === 0) {
      throw new Error(`windows.package("${arg.id}") version must be a non-empty string`);
    }
    if (arg.version === "latest" || arg.version === "*") {
      throw new Error(`windows.package("${arg.id}") version "${arg.version}" is not supported; use "any" to accept any installed version, or an exact version`);
    }
    if (arg.version === "any") pkg.anyVersion = true;
    else pkg.version = arg.version;
  }
  if (arg.elevated !== undefined) {
    pkg.elevated = arg.elevated;
  }
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) pkg.dependsOn = deps;
  return pkg;
}

function normalizeRawCommand(arg: WinRawCommandArg): WinRawCommand {
  if (typeof arg === "string") {
    if (arg.length === 0) {
      throw new Error("windows.raw(command) requires a non-empty command string");
    }
    return withToken({
      executable: "pwsh",
      arguments: ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", arg],
    });
  }

  if (!arg || typeof arg !== "object") {
    throw new Error("windows.raw(...) requires a command string or a spec object");
  }
  if (!arg.executable || typeof arg.executable !== "string") {
    throw new Error("windows.raw({ executable }) requires a non-empty executable");
  }

  const command: WinRawCommand = {
    executable: arg.executable,
  };
  if (arg.name !== undefined) {
    if (typeof arg.name !== "string" || arg.name.length === 0) {
      throw new Error("windows.raw({ name }) must be a non-empty string");
    }
    command.name = arg.name;
  }
  if (arg.arguments !== undefined) {
    if (
      !Array.isArray(arg.arguments) ||
      arg.arguments.some((value) => typeof value !== "string")
    ) {
      throw new Error("windows.raw({ arguments }) must be an array of strings");
    }
    command.arguments = arg.arguments;
  }
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) command.dependsOn = deps;
  return withToken(command);
}

/**
 * Stamp a non-enumerable identity token onto a command so a handle can
 * reference it via `dependsOn`. Non-enumerable so it never shows up in deep
 * equality checks, JSON, or the emitted YAML; it is read only by the helper
 * (to build the handle ref) and the emitter (to resolve names).
 */
function withToken(command: WinRawCommand): WinRawCommand {
  Object.defineProperty(command, "token", {
    value: Symbol("winix.command"),
    enumerable: false,
    configurable: true,
  });
  return command;
}

/** Stamp a non-enumerable identity token onto a generic DSC resource. */
function withDscToken(resource: WinDscResource): WinDscResource {
  Object.defineProperty(resource, "token", {
    value: Symbol("winix.dsc"),
    enumerable: false,
    configurable: true,
  });
  return resource;
}

/** Stamp internal typed-helper metadata without affecting public equality/YAML. */
function withDscMetadata(
  resource: WinDscResource,
  metadata: WinDscMetadata
): WinDscResource {
  Object.defineProperty(resource, "winix", {
    value: metadata,
    enumerable: false,
    configurable: true,
  });
  return resource;
}

const REGISTRY_RESOURCE = "Microsoft.Windows/Registry";
const POWERSHELL_SCRIPT_RESOURCE =
  "Microsoft.DSC.Transitional/PowerShellScript";
const WINDOWS_SETTINGS_RESOURCE = "Microsoft.Windows.Settings/WindowsSettings";
const USER_ENV_KEY_PATH = "HKCU\\Environment";
const MACHINE_ENV_KEY_PATH =
  "HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";
const USER_ENV_REGISTRY_PATH = "HKCU:\\Environment";
const MACHINE_ENV_REGISTRY_PATH =
  "HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment";

function normalizeDsc(arg: WinDscSpec): WinDscResource {
  if (!arg || typeof arg !== "object") {
    throw new Error("windows.dsc(...) requires a spec object");
  }
  if (!arg.type || typeof arg.type !== "string") {
    throw new Error("windows.dsc({ type }) requires a non-empty resource type");
  }
  const resource: WinDscResource = { resourceType: arg.type };
  if (arg.name !== undefined) {
    if (typeof arg.name !== "string" || arg.name.length === 0) {
      throw new Error("windows.dsc({ name }) must be a non-empty string");
    }
    resource.name = arg.name;
  }
  if (arg.properties !== undefined) {
    if (arg.properties === null || typeof arg.properties !== "object" || Array.isArray(arg.properties)) {
      throw new Error("windows.dsc({ properties }) must be a plain object");
    }
    resource.properties = arg.properties;
  }
  const deps = resolveDependsOn(arg.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscToken(resource);
}

const BOOLEAN_WINDOWS_SETTINGS = new Set([
  "DeveloperMode",
  "SetTimeZoneAutomatically",
  "EnableTransparency",
  "ShowAccentColorOnStartAndTaskbar",
  "ShowAccentColorOnTitleBarsAndWindowBorders",
  "AutoColorization",
  "ShowRecentList",
  "ShowRecommendedList",
  "TaskbarBadges",
  "DesktopTaskbarBadges",
  "TaskbarMultiMon",
  "DesktopTaskbarMultiMon",
  "NotifyOnUsbErrors",
  "NotifyOnWeakCharger",
]);
const COLOR_MODE_VALUES = ["Light", "Dark"] as const;
const TASKBAR_ALIGNMENT_VALUES = ["Left", "Center"] as const;
const TASKBAR_GROUPING_VALUES = ["Always", "WhenFull", "Never"] as const;
const TASKBAR_MULTI_MON_MODE_VALUES = ["Duplicate", "PrimaryAndWindow", "WindowOnly"] as const;
const START_FOLDER_VALUES = [
  "Documents",
  "Downloads",
  "Music",
  "Pictures",
  "Videos",
  "Network",
  "UserProfile",
  "Explorer",
  "Settings",
] as const;
const WINDOWS_SETTING_VALIDATORS: Record<string, (value: unknown, key: string) => WinDscProperties[string]> = {
  TaskbarAlignment: enumSettingValidator(TASKBAR_ALIGNMENT_VALUES),
  AppColorMode: enumSettingValidator(COLOR_MODE_VALUES),
  SystemColorMode: enumSettingValidator(COLOR_MODE_VALUES),
  TimeZone: stringSettingValidator,
  StartFolders: startFoldersSettingValidator,
  TaskbarGroupingMode: enumSettingValidator(TASKBAR_GROUPING_VALUES),
  TaskbarMultiMonMode: enumSettingValidator(TASKBAR_MULTI_MON_MODE_VALUES),
  DesktopTaskbarMultiMonMode: enumSettingValidator(TASKBAR_MULTI_MON_MODE_VALUES),
};
for (const key of BOOLEAN_WINDOWS_SETTINGS) {
  WINDOWS_SETTING_VALIDATORS[key] = booleanSettingValidator;
}

function supportedWindowsSettings(): string[] {
  return Object.keys(WINDOWS_SETTING_VALIDATORS).sort();
}

function booleanSettingValidator(value: unknown, key: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`windows.setting({ ${key} }) must be a boolean`);
  }
  return value;
}

function stringSettingValidator(value: unknown, key: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`windows.setting({ ${key} }) must be a non-empty string`);
  }
  return value;
}

function enumSettingValidator<T extends readonly string[]>(
  allowed: T
): (value: unknown, key: string) => T[number] {
  return (value, key) => {
    if (typeof value !== "string" || !allowed.includes(value)) {
      throw new Error(
        `windows.setting({ ${key} }) must be one of: ${allowed.join(", ")}`
      );
    }
    return value as T[number];
  };
}

function startFoldersSettingValidator(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(
      `windows.setting({ ${key} }) must be an array of: ${START_FOLDER_VALUES.join(", ")}`
    );
  }
  const invalid = value.find((entry) => !START_FOLDER_VALUES.includes(entry));
  if (invalid) {
    throw new Error(
      `windows.setting({ ${key} }) contains unsupported folder "${invalid}". ` +
        `Supported folders: ${START_FOLDER_VALUES.join(", ")}.`
    );
  }
  return value;
}

function normalizeSetting(
  settings: WinSettings,
  opts: WinSettingOpts | undefined
): WinDscResource {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("windows.setting(settings) requires a settings object");
  }
  if (opts !== undefined && (opts === null || typeof opts !== "object" || Array.isArray(opts))) {
    throw new Error("windows.setting options must be an object when provided");
  }

  const properties: WinDscProperties = {};
  for (const [key, value] of Object.entries(settings)) {
    const validator = WINDOWS_SETTING_VALIDATORS[key];
    if (!validator) {
      throw new Error(
        `windows.setting(...) does not support setting "${key}". ` +
        `Supported settings: ${supportedWindowsSettings().join(", ")}.`
      );
    }
    properties[key] = validator(value, key);
  }

  if (Object.keys(properties).length === 0) {
    throw new Error("windows.setting(settings) requires at least one supported setting");
  }

  const resource: WinDscResource = {
    resourceType: WINDOWS_SETTINGS_RESOURCE,
    name: "Windows Settings",
    properties,
  };
  const deps = resolveDependsOn(opts?.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscMetadata(withDscToken(resource), { kind: "setting" });
}

function normalizeEnvOpts(opts: WinEnvOpts | undefined, helper: string): WinEnvOpts | undefined {
  if (opts === undefined) return undefined;
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error(`${helper} options must be an object when provided`);
  }
  if (
    opts.scope !== undefined &&
    opts.scope !== "user" &&
    opts.scope !== "machine"
  ) {
    throw new Error(
      `${helper} scope "${opts.scope}" is invalid; expected "user" or "machine"`
    );
  }
  return opts;
}

function envScope(opts: WinEnvOpts | undefined): WinEnvScope {
  return opts?.scope ?? "user";
}

function envKeyPath(scope: WinEnvScope): string {
  return scope === "machine" ? MACHINE_ENV_KEY_PATH : USER_ENV_KEY_PATH;
}

function envRegistryPath(scope: WinEnvScope): string {
  return scope === "machine" ? MACHINE_ENV_REGISTRY_PATH : USER_ENV_REGISTRY_PATH;
}

function envTarget(scope: WinEnvScope): "User" | "Machine" {
  return scope === "machine" ? "Machine" : "User";
}

function registryDsc(opts: {
  name: string;
  keyPath: string;
  valueName: string;
  value?: string;
  exists: boolean;
  scope: WinEnvScope;
  dependsOn?: ResourceRef[];
}): WinDscResource {
  const properties: WinDscProperties = {
    keyPath: opts.keyPath,
    valueName: opts.valueName,
    _exist: opts.exists,
  };
  if (opts.exists) {
    properties.valueData = { String: opts.value ?? "" };
  }
  const resource: WinDscResource = {
    resourceType: REGISTRY_RESOURCE,
    name: opts.name,
    properties,
  };
  if (opts.dependsOn) resource.dependsOn = opts.dependsOn;
  return withDscMetadata(withDscToken(resource), {
    kind: "env",
    action: opts.exists ? "set" : "remove",
    name: opts.valueName,
    value: opts.value,
    scope: opts.scope,
  });
}

function normalizeEnv(
  name: string,
  ensure: "Present" | "Absent",
  value: string | undefined,
  opts: WinEnvOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeEnvOpts(opts, "windows.env.*");
  if (!name || typeof name !== "string") {
    throw new Error("windows.env.*(name) requires a non-empty variable name");
  }
  if (ensure === "Present" && (value === undefined || typeof value !== "string")) {
    throw new Error(`windows.env.set("${name}", value) requires a string value`);
  }
  const scope = envScope(normalizedOpts);
  return registryDsc({
    name: ensure === "Present" ? `Set ${name}` : `Remove ${name}`,
    keyPath: envKeyPath(scope),
    valueName: name,
    value,
    exists: ensure === "Present",
    scope,
    dependsOn: resolveDependsOn(normalizedOpts?.dependsOn),
  });
}

function normalizePath(
  value: string,
  ensure: "Present" | "Absent",
  opts: WinEnvOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeEnvOpts(opts, "windows.path.*");
  if (!value || typeof value !== "string") {
    throw new Error("windows.path.*(value) requires a non-empty directory");
  }
  const scope = envScope(normalizedOpts);
  const resource: WinDscResource = {
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
    name: `${ensure === "Present" ? "Add" : "Remove"} ${value} ${
      ensure === "Present" ? "to" : "from"
    } PATH`,
    properties: buildPathScriptProperties({
      dir: value,
      scope,
      action: ensure === "Present" ? "add" : "remove",
    }),
  };
  const deps = resolveDependsOn(normalizedOpts?.dependsOn);
  if (deps) resource.dependsOn = deps;
  return withDscMetadata(withDscToken(resource), {
    kind: "path",
    action: ensure === "Present" ? "add" : "remove",
    value,
    scope,
  });
}

function normalizeFileOpts(opts: WinFileOpts | undefined, helper: string): WinFileOpts {
  if (opts === undefined) return { backup: true };
  if (opts === null || typeof opts !== "object" || Array.isArray(opts)) {
    throw new Error(`${helper} options must be an object when provided`);
  }
  for (const key of ["force", "backup", "recursive", "elevate"] as const) {
    if (opts[key] !== undefined && typeof opts[key] !== "boolean") {
      throw new Error(`${helper} option "${key}" must be a boolean`);
    }
  }
  if (
    opts.encoding !== undefined &&
    opts.encoding !== "utf8" &&
    opts.encoding !== "utf8bom" &&
    opts.encoding !== "ascii"
  ) {
    throw new Error(
      `${helper} encoding "${opts.encoding}" is invalid; expected "utf8", "utf8bom", or "ascii"`
    );
  }
  // An existing, different target is moved to <target>.bak unless the resource
  // opts out with backup: false (fail instead) or asks for force (delete it).
  return { ...opts, backup: opts.backup ?? opts.force !== true };
}

function scriptDsc(
  name: string,
  properties: WinDscProperties,
  opts: WinFileOpts
): WinDscResource {
  const resource: WinDscResource = {
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
    name,
    properties,
  };
  const deps = resolveDependsOn(opts.dependsOn);
  if (deps) resource.dependsOn = deps;
  if (opts.elevate) resource.elevated = true;
  return withDscToken(resource);
}

function normalizeFileText(
  target: WinFilePath,
  content: string,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.text");
  if (!validFilePath(target)) {
    throw new Error("windows.file.text(target) requires a non-empty target path");
  }
  if (typeof content !== "string") {
    throw new Error("windows.file.text(target, content) requires string content");
  }
  const encoding = normalizedOpts.encoding ?? "utf8";
  return withFileMetadata(scriptDsc(
    `Write file ${filePathLabel(target)}`,
    buildFileTextScriptProperties({
      target,
      content,
      encoding,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "text", target, normalizedOpts, undefined, content);
}

function normalizeFileSymlink(
  target: WinFilePath,
  source: string | URL,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.symlink");
  if (!validFilePath(target)) {
    throw new Error("windows.file.symlink(target) requires a non-empty target path");
  }
  source = source instanceof URL ? fileURLToPath(source) : source;
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.symlink(target, source) requires a non-empty source path");
  }
  return withFileMetadata(scriptDsc(
    `Link file ${filePathLabel(target)}`,
    buildFileSymlinkScriptProperties({
      target,
      source,
      recursive: normalizedOpts.recursive ?? false,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "symlink", target, normalizedOpts, source);
}

function normalizeFileCopy(
  target: WinFilePath,
  source: string | URL,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.copy");
  if (!validFilePath(target)) {
    throw new Error("windows.file.copy(target) requires a non-empty target path");
  }
  source = source instanceof URL ? fileURLToPath(source) : source;
  if (!source || typeof source !== "string") {
    throw new Error("windows.file.copy(target, source) requires a non-empty source path");
  }
  return withFileMetadata(scriptDsc(
    `Copy file ${filePathLabel(target)}`,
    buildFileCopyScriptProperties({
      target,
      source,
      force: normalizedOpts.force ?? false,
      backup: normalizedOpts.backup ?? false,
    }),
    normalizedOpts
  ), "copy", target, normalizedOpts, source);
}

function normalizeFileRemove(
  target: WinFilePath,
  opts: WinFileOpts | undefined
): WinDscResource {
  const normalizedOpts = normalizeFileOpts(opts, "windows.file.remove");
  if (!validFilePath(target)) {
    throw new Error("windows.file.remove(target) requires a non-empty target path");
  }
  return withFileMetadata(scriptDsc(
    `Remove file ${filePathLabel(target)}`,
    buildFileRemoveScriptProperties({ target }),
    normalizedOpts
  ), "remove", target, normalizedOpts);
}

function withFileMetadata(
  resource: WinDscResource,
  action: "text" | "symlink" | "copy" | "remove",
  target: WinFilePath,
  opts: WinFileOpts,
  source?: string,
  content?: string
): WinDscResource {
  return withDscMetadata(resource, {
    kind: "file", action, target, source, content,
    encoding: opts.encoding ?? "utf8",
    force: opts.force ?? false,
    backup: opts.backup ?? false,
    recursive: opts.recursive ?? false,
  });
}

/** Rebuild scripts after the emitter supplies the config directory. */
export function resolveWindowsFileProperties(
  resource: WinDscResource,
  configDir?: string,
  sourcePath: (path: string) => string = (path) => path
): WinDscProperties | undefined {
  const file = resource.winix;
  if (file?.kind !== "file") return resource.properties;
  const source = file.source === undefined ? undefined : resolveWindowsSource(file.source, configDir, sourcePath);
  switch (file.action) {
    case "text": return buildFileTextScriptProperties({ ...file, content: file.content! });
    case "remove": return buildFileRemoveScriptProperties(file);
    case "symlink": return buildFileSymlinkScriptProperties({ ...file, source: source! });
    case "copy": return buildFileCopyScriptProperties({ ...file, source: source! });
  }
}

export function resolveWindowsSource(
  original: string, configDir?: string, sourcePath: (path: string) => string = (path) => path
): string {
  let source = original;
  if (source !== undefined && !/%[^%]+%/.test(source) &&
      !win32.isAbsolute(source) && !posix.isAbsolute(source)) {
    if (!configDir) throw new Error("Relative Windows file sources require a configDir when calling generateWindows.");
    if (/^[a-z]:/i.test(source)) throw new Error(`Drive-relative Windows source is ambiguous: ${source}`);
    source = /^[a-z]:[\\/]|^[\\/]{2}/i.test(configDir)
      ? win32.resolve(configDir, source)
      : posix.isAbsolute(configDir)
        ? posix.resolve(configDir, source.replaceAll("\\", "/"))
        : resolve(configDir, source);
  }
  if (source !== undefined && !/%[^%]+%/.test(source)) source = sourcePath(source);
  return source;
}

function buildPathScriptProperties(opts: {
  dir: string;
  scope: WinEnvScope;
  action: "add" | "remove";
}): WinDscProperties {
  const registryPath = envRegistryPath(opts.scope);
  const target = envTarget(opts.scope);
  const quotedDir = psSingleQuoted(opts.dir);
  const quotedRegistryPath = psSingleQuoted(registryPath);
  const quotedTarget = psSingleQuoted(target);
  const presentCheck =
    opts.action === "add"
      ? "$entries -contains $dir"
      : "-not ($entries -contains $dir)";

  return {
    getScript: [
      `$registryPath = ${quotedRegistryPath}`,
      "Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
    ].join("\n"),
    testScript: [
      `$dir = ${quotedDir}`,
      `$registryPath = ${quotedRegistryPath}`,
      "$current = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "$entries = if ([string]::IsNullOrEmpty($current)) { @() } else { $current -split ';' }",
      presentCheck,
    ].join("\n"),
    setScript: [
      `$dir = ${quotedDir}`,
      `$registryPath = ${quotedRegistryPath}`,
      `$target = ${quotedTarget}`,
      "$key = Get-Item -Path $registryPath",
      "$originalKind = $null",
      "try { $originalKind = $key.GetValueKind('Path') } catch { $originalKind = $null }",
      "$current = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "$entries = if ([string]::IsNullOrEmpty($current)) { @() } else { $current -split ';' }",
      ...(opts.action === "add"
        ? [
            "if ($entries -notcontains $dir) {",
            "  $new = if ([string]::IsNullOrEmpty($current)) { $dir } else { \"$current;$dir\" }",
            "  [Environment]::SetEnvironmentVariable('Path', $new, $target)",
            "}",
          ]
        : [
            "if ($entries -contains $dir) {",
            "  $new = ($entries | Where-Object { $_ -ne $dir }) -join ';'",
            "  [Environment]::SetEnvironmentVariable('Path', $new, $target)",
            "}",
          ]),
      "$afterKey = Get-Item -Path $registryPath",
      "$afterValue = Get-ItemPropertyValue -Path $registryPath -Name 'Path' -ErrorAction SilentlyContinue",
      "if ($originalKind -eq [Microsoft.Win32.RegistryValueKind]::ExpandString -and $afterKey.GetValueKind('Path') -ne [Microsoft.Win32.RegistryValueKind]::ExpandString) {",
      "  Set-ItemProperty -Path $registryPath -Name 'Path' -Value $afterValue -Type ExpandString",
      "}",
    ].join("\n"),
  };
}

function buildFileTextScriptProperties(opts: {
  target: WinFilePath;
  content: string;
  encoding: WinFileEncoding;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = [
    `$target = ${filePathExpression(opts.target)}`,
    `$content = ${psSingleQuoted(opts.content)}`,
    `$encoding = ${psSingleQuoted(opts.encoding)}`,
    `$force = ${psBoolean(opts.force)}`,
    `$backup = ${psBoolean(opts.backup)}`,
  ];
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (Test-Path -LiteralPath $target -PathType Leaf) { [IO.File]::ReadAllText($target) } else { '' }",
    ].join("\n"),
    testScript: [
      ...winixFileModuleImport("test"),
      ...vars,
      "$desired = Get-WinixTextBytes $content $encoding",
      "if (-not (Test-Path -LiteralPath $target -PathType Leaf)) { return $false }",
      "$actual = [IO.File]::ReadAllBytes($target)",
      "Test-WinixBytesEqual $actual $desired",
    ].join("\n"),
    setScript: [
      ...winixFileModuleImport("set"),
      ...vars,
      "$desired = Get-WinixTextBytes $content $encoding",
      "if (Test-Path -LiteralPath $target -PathType Leaf) {",
      "  $actual = [IO.File]::ReadAllBytes($target)",
      "  if (Test-WinixBytesEqual $actual $desired) { return }",
      "}",
      "Move-WinixExistingTarget $target $force $backup",
      "Ensure-WinixParentDirectory $target",
      "[IO.File]::WriteAllBytes($target, $desired)",
    ].join("\n"),
  };
}

function buildFileSymlinkScriptProperties(opts: {
  target: WinFilePath;
  source: string;
  recursive: boolean;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = fileScriptVars({
    target: opts.target,
    source: opts.source,
    recursive: opts.recursive,
    force: opts.force,
    backup: opts.backup,
  });
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { (Get-Item -LiteralPath $target -Force).LinkType } else { '' }",
    ].join("\n"),
    testScript: [
      ...winixFileModuleImport("test"),
      ...vars,
      "if ($recursive) { Test-WinixRecursiveSymlink $source $target } else { Test-WinixSymlink $source $target }",
    ].join("\n"),
    setScript: [
      ...winixFileModuleImport("set"),
      ...vars,
      "Assert-WinixCanCreateSymlink",
      "if (-not (Test-Path -LiteralPath $source)) { throw \"Source path does not exist: $source\" }",
      "if ($recursive) {",
      "  Set-WinixRecursiveSymlink $source $target $force $backup",
      "} else {",
      "  Set-WinixSymlink $source $target $force $backup",
      "}",
    ].join("\n"),
  };
}

function buildFileCopyScriptProperties(opts: {
  target: WinFilePath;
  source: string;
  force: boolean;
  backup: boolean;
}): WinDscProperties {
  const vars = fileScriptVars({
    target: opts.target,
    source: opts.source,
    force: opts.force,
    backup: opts.backup,
  });
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { $target } else { '' }",
    ].join("\n"),
    testScript: [
      ...winixFileModuleImport("test"),
      ...vars,
      "Test-WinixCopy $source $target",
    ].join("\n"),
    setScript: [
      ...winixFileModuleImport("set"),
      ...vars,
      "if (-not (Test-Path -LiteralPath $source)) { throw \"Source path does not exist: $source\" }",
      "if (Test-WinixCopy $source $target) { return }",
      "Move-WinixExistingTarget $target $force $backup",
      "Ensure-WinixParentDirectory $target",
      "if (Test-Path -LiteralPath $source -PathType Container) {",
      "  New-Item -ItemType Directory -Force -Path $target | Out-Null",
      "  Copy-Item -Path (Join-Path $source '*') -Destination $target -Recurse -Force",
      "} else {",
      "  Copy-Item -LiteralPath $source -Destination $target -Force",
      "}",
    ].join("\n"),
  };
}

function buildFileRemoveScriptProperties(opts: { target: WinFilePath }): WinDscProperties {
  return {
    getScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (Test-Path -LiteralPath $target) { $target } else { '' }",
    ].join("\n"),
    testScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "-not (Test-Path -LiteralPath $target)",
    ].join("\n"),
    setScript: [
      ...filePathPrelude(),
      `$target = ${filePathExpression(opts.target)}`,
      "if (-not (Test-Path -LiteralPath $target)) { return }",
      "$item = Get-Item -LiteralPath $target -Force",
      "if ($item.PSIsContainer -and $null -eq $item.LinkType) {",
      "  throw \"Refusing to remove real directory: $target\"",
      "}",
      "Remove-Item -LiteralPath $target -Force",
    ].join("\n"),
  };
}

function fileScriptVars(values: Record<string, WinFilePath | boolean>): string[] {
  return Object.entries(values).map(([name, value]) =>
    typeof value === "boolean"
      ? `$${name} = ${psBoolean(value)}`
      : `$${name} = ${filePathExpression(value)}`
  );
}

export function filePathPrelude(): string[] {
  return [
    "function Expand-WinixPath([string]$Path) { [Environment]::ExpandEnvironmentVariables($Path) }",
  ];
}

function fileMoveTargetPrelude(): string[] {
  return [
    "function Move-WinixExistingTarget([string]$Path, [bool]$Force, [bool]$Backup) {",
    "  if (-not (Test-Path -LiteralPath $Path)) { return }",
    "  if ($Backup) {",
    "    $backupPath = \"$Path.bak\"",
    "    if (Test-Path -LiteralPath $backupPath) { throw \"Backup target already exists: $backupPath\" }",
    "    Move-Item -LiteralPath $Path -Destination $backupPath",
    "    return",
    "  }",
    "  if (-not $Force) { throw \"Target already exists and differs: $Path (declared with backup: false). Move it manually, drop backup: false, or pass force: true.\" }",
    "  $item = Get-Item -LiteralPath $Path -Force",
    "  if ($item.PSIsContainer -and $null -eq $item.LinkType) {",
    "    $children = @(Get-ChildItem -LiteralPath $Path -Force -ErrorAction SilentlyContinue)",
    "    if ($children.Count -gt 0) { throw \"Refusing to delete populated directory: $Path. Move it manually or use backup: true.\" }",
    "  }",
    "  Remove-Item -LiteralPath $Path -Force -Recurse",
    "}",
  ];
}

/**
 * Shared functions for file resources. Emitted once per configuration as a
 * content-addressed module (see `winixFileModuleProperties`) instead of being
 * repeated in every test/set script.
 */
const WINIX_FILE_FUNCTIONS: readonly string[] = [
  ...filePathPrelude(),
  "function Ensure-WinixParentDirectory([string]$Path) {",
  "  $parent = Split-Path -Parent $Path",
  "  if (-not [string]::IsNullOrEmpty($parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }",
  "}",
  "function Test-WinixBytesEqual([byte[]]$Actual, [byte[]]$Desired) {",
  "  if ($Actual.Length -ne $Desired.Length) { return $false }",
  "  for ($i = 0; $i -lt $Actual.Length; $i++) { if ($Actual[$i] -ne $Desired[$i]) { return $false } }",
  "  return $true",
  "}",
  "function Get-WinixTextBytes([string]$Content, [string]$EncodingName) {",
  "  if ($EncodingName -eq 'ascii') { return [byte[]][Text.Encoding]::ASCII.GetBytes($Content) }",
  "  $encoder = [Text.UTF8Encoding]::new($EncodingName -eq 'utf8bom')",
  "  return [byte[]]($encoder.GetPreamble() + $encoder.GetBytes($Content))",
  "}",
  ...fileMoveTargetPrelude(),
  "function Get-WinixRelativePath([string]$Root, [string]$Path) {",
  "  $prefix = $Root.TrimEnd('\\') + '\\'",
  "  $Path.Substring($prefix.Length)",
  "}",
  "function Test-WinixSymlink([string]$Source, [string]$Target) {",
  "  if (-not (Test-Path -LiteralPath $Target)) { return $false }",
  "  $item = Get-Item -LiteralPath $Target -Force",
  "  ($item.LinkType -eq 'SymbolicLink') -and [string]::Equals([string]$item.Target, $Source, [StringComparison]::OrdinalIgnoreCase)",
  "}",
  "function Invoke-WinixMklink([string]$Source, [string]$Target) {",
  "  Ensure-WinixParentDirectory $Target",
  "  $isDirectory = Test-Path -LiteralPath $Source -PathType Container",
  "  $flag = if ($isDirectory) { '/D ' } else { '' }",
  "  & $env:ComSpec /c \"mklink $flag`\"$Target`\" `\"$Source`\"\"",
  "  if ($LASTEXITCODE -ne 0) { throw \"mklink failed with exit code $LASTEXITCODE\" }",
  "}",
  "function Set-WinixSymlink([string]$Source, [string]$Target, [bool]$Force, [bool]$Backup) {",
  "  if (Test-WinixSymlink $Source $Target) { return }",
  "  Move-WinixExistingTarget $Target $Force $Backup",
  "  Invoke-WinixMklink $Source $Target",
  "}",
  "function Test-WinixRecursiveSymlink([string]$Source, [string]$Target) {",
  "  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { return $false }",
  "  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { return $false }",
  "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
  "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
  "    $relative = Get-WinixRelativePath $root $dir.FullName",
  "    if (-not (Test-Path -LiteralPath (Join-Path $Target $relative) -PathType Container)) { return $false }",
  "  }",
  "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
  "    $relative = Get-WinixRelativePath $root $file.FullName",
  "    if (-not (Test-WinixSymlink $file.FullName (Join-Path $Target $relative))) { return $false }",
  "  }",
  "  return $true",
  "}",
  "function Set-WinixRecursiveSymlink([string]$Source, [string]$Target, [bool]$Force, [bool]$Backup) {",
  "  if (-not (Test-Path -LiteralPath $Source -PathType Container)) { throw \"Recursive symlink source must be a directory: $Source\" }",
  "  if (Test-WinixRecursiveSymlink $Source $Target) { return }",
  "  Move-WinixExistingTarget $Target $Force $Backup",
  "  New-Item -ItemType Directory -Force -Path $Target | Out-Null",
  "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
  "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
  "    New-Item -ItemType Directory -Force -Path (Join-Path $Target (Get-WinixRelativePath $root $dir.FullName)) | Out-Null",
  "  }",
  "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
  "    Set-WinixSymlink $file.FullName (Join-Path $Target (Get-WinixRelativePath $root $file.FullName)) $Force $Backup",
  "  }",
  "}",
  "function Assert-WinixCanCreateSymlink {",
  "  $principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()",
  "  if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { return }",
  "  $devMode = Get-ItemPropertyValue -Path 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\AppModelUnlock' -Name AllowDevelopmentWithoutDevLicense -ErrorAction SilentlyContinue",
  "  if ($devMode -eq 1) { return }",
  "  throw 'Creating Windows symlinks requires elevation or Developer Mode. Enable Developer Mode in Windows Settings, or pass elevate: true.'",
  "}",
  "function Test-WinixCopy([string]$Source, [string]$Target) {",
  "  if (-not (Test-Path -LiteralPath $Source) -or -not (Test-Path -LiteralPath $Target)) { return $false }",
  "  if (Test-Path -LiteralPath $Source -PathType Leaf) {",
  "    if (-not (Test-Path -LiteralPath $Target -PathType Leaf)) { return $false }",
  "    return Test-WinixBytesEqual ([IO.File]::ReadAllBytes($Target)) ([IO.File]::ReadAllBytes($Source))",
  "  }",
  "  if (-not (Test-Path -LiteralPath $Target -PathType Container)) { return $false }",
  "  $root = (Resolve-Path -LiteralPath $Source).ProviderPath",
  "  foreach ($dir in Get-ChildItem -LiteralPath $root -Recurse -Force -Directory) {",
  "    if (-not (Test-Path -LiteralPath (Join-Path $Target (Get-WinixRelativePath $root $dir.FullName)) -PathType Container)) { return $false }",
  "  }",
  "  foreach ($file in Get-ChildItem -LiteralPath $root -Recurse -Force -File) {",
  "    $targetFile = Join-Path $Target (Get-WinixRelativePath $root $file.FullName)",
  "    if (-not (Test-Path -LiteralPath $targetFile -PathType Leaf)) { return $false }",
  "    if (-not (Test-WinixBytesEqual ([IO.File]::ReadAllBytes($targetFile)) ([IO.File]::ReadAllBytes($file.FullName)))) { return $false }",
  "  }",
  "  return $true",
  "}",
];

/** Module text; ASCII only, so every PowerShell edition reads it identically. */
export const WINIX_FILE_MODULE = [
  "# Generated by Winix. Shared functions for Winix file resources. Do not edit.",
  ...WINIX_FILE_FUNCTIONS,
  "Export-ModuleMember -Function *-Winix*",
  "",
].join("\n");
const WINIX_FILE_MODULE_SHA256 = createHash("sha256").update(WINIX_FILE_MODULE, "utf8").digest("hex");
/** Content-addressed, so workspaces on different Winix versions never overwrite each other's copy. */
export const WINIX_FILE_MODULE_RELATIVE_PATH = `Winix\\powershell\\WinixFiles-${WINIX_FILE_MODULE_SHA256.slice(0, 16)}.psm1`;
export const WINIX_FILE_MODULE_RESOURCE_NAME = "Winix PowerShell helpers";

function winixFileModulePathLine(): string {
  return `$winixModule = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) ${psSingleQuoted(WINIX_FILE_MODULE_RELATIVE_PATH)}`;
}

/**
 * Load the shared file functions. A missing module means the helpers resource
 * has not run yet: tests report "not in desired state" (so plans and drift checks
 * still work on a fresh machine) and sets fail with the fix.
 */
function winixFileModuleImport(mode: "test" | "set"): string[] {
  return [
    winixFileModulePathLine(),
    "if (-not (Test-Path -LiteralPath $winixModule -PathType Leaf)) {",
    mode === "test"
      ? "  return $false"
      : `  throw "Winix PowerShell helpers are missing: $winixModule. Run winix switch so the '${WINIX_FILE_MODULE_RESOURCE_NAME}' resource installs them first."`,
    "}",
    "Import-Module -Name $winixModule -Force -DisableNameChecking",
  ];
}

/** Properties of the resource that installs the shared module before any file resource runs. */
export function winixFileModuleProperties(): WinDscProperties {
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    winixFileModulePathLine(),
    `$expected = ${psSingleQuoted(WINIX_FILE_MODULE_SHA256)}`,
    "function Test-WinixFileModule {",
    "  if (-not (Test-Path -LiteralPath $winixModule -PathType Leaf)) { return $false }",
    "  return (Get-FileHash -LiteralPath $winixModule -Algorithm SHA256).Hash.ToLowerInvariant() -ceq $expected",
    "}",
  ];
  return {
    getScript: [...prelude, "@{ Path = $winixModule; InDesiredState = (Test-WinixFileModule) }"].join("\n"),
    testScript: [...prelude, "Test-WinixFileModule"].join("\n"),
    setScript: [
      ...prelude,
      "if (Test-WinixFileModule) { return }",
      `$content = ${psSingleQuoted(WINIX_FILE_MODULE)}`,
      "New-Item -ItemType Directory -Force -Path (Split-Path -Parent $winixModule) | Out-Null",
      "$staging = \"$winixModule.\" + [guid]::NewGuid().ToString('N')",
      "try {",
      "  [IO.File]::WriteAllText($staging, $content, [Text.UTF8Encoding]::new($false))",
      "  Move-Item -LiteralPath $staging -Destination $winixModule -Force",
      "} finally { Remove-Item -LiteralPath $staging -Force -ErrorAction SilentlyContinue }",
      "if (-not (Test-WinixFileModule)) { throw \"Winix PowerShell helpers verification failed: $winixModule\" }",
    ].join("\n"),
  };
}

function psBoolean(value: boolean): string {
  return value ? "$true" : "$false";
}

interface ResolvedStartupSpec {
  executable: WinFilePath;
  arguments?: WinFilePath[];
  workingDirectory?: WinFilePath;
  windowStyle?: WinStartupAppWindowStyle;
  backup?: boolean;
  force?: boolean;
  dependsOn?: ResourceHandle | ResourceHandle[];
}

/**
 * Validation and activation-time path resolution shared by startup apps and
 * shortcuts: the PowerShell prelude defines $executable (absolute, resolved
 * from PATH when given a bare name), $workingDirectory and $arguments (one
 * Windows command-line string).
 */
function startupCommon(
  helper: string, name: string, input: WinStartupAppSpec | WinStartupShortcutSpec,
  styles: readonly WinStartupAppWindowStyle[],
): { spec: ResolvedStartupSpec; style: WinStartupAppWindowStyle; prelude: string[] } {
  if (typeof name !== "string" || !name.trim() || /[<>:"/\\|?*\x00-\x1f]|[. ]$/.test(name) ||
      /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) || name.length > 200) {
    throw new Error(`${helper} requires a valid name without path separators or reserved Windows names`);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error(`${helper} requires a command specification`);
  }
  // A file handle used as a path means "this file's target", and implies the dependency.
  const implied: ResourceHandle[] = [];
  const pathOf = (value: WinFilePath | ResourceHandle): WinFilePath => {
    const target = fileHandleTarget(value);
    if (target === undefined) return value as WinFilePath;
    implied.push(value as ResourceHandle);
    return target;
  };
  const explicit = input.dependsOn === undefined ? [] : Array.isArray(input.dependsOn) ? input.dependsOn : [input.dependsOn];
  const spec: ResolvedStartupSpec = {
    ...input,
    executable: pathOf(input.executable),
    workingDirectory: input.workingDirectory === undefined ? undefined : pathOf(input.workingDirectory),
    arguments: Array.isArray(input.arguments) ? input.arguments.map(pathOf) : input.arguments as undefined,
  };
  if (implied.length > 0) spec.dependsOn = [...explicit, ...implied.filter((handle) => !explicit.includes(handle))];
  for (const [key, value] of [
    ["executable", spec.executable],
    ["workingDirectory", spec.workingDirectory ?? knownFolder("userProfile")],
  ] as const) {
    if (!validFilePath(value) || /\0/.test(filePathLabel(value))) {
      throw new Error(`${helper} ${key} requires a non-empty path or application name`);
    }
  }
  if (spec.arguments !== undefined && (!Array.isArray(spec.arguments) || spec.arguments.some(
    (value) => (typeof value !== "string" && !validFilePath(value)) || /\0/.test(filePathLabel(value))
  ))) {
    throw new Error(`${helper} arguments must be strings or known-folder paths without null characters`);
  }
  const style = spec.windowStyle ?? "normal";
  if (!styles.includes(style)) {
    throw new Error(`${helper} windowStyle must be ${styles.slice(0, -1).join(", ")}, or ${styles.at(-1)}`);
  }
  const args = (spec.arguments ?? []).map((value) =>
    typeof value === "string" ? psSingleQuoted(value) : `(${filePathExpression(value)})`
  );
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    ...filePathPrelude(),
    String.raw`function ConvertTo-WinixArgument([string]$Value) {
  if ($Value.Length -gt 0 -and $Value -notmatch '[\s"]') { return $Value }
  $escaped = [regex]::Replace($Value, '(\\*)"', '$1$1\"')
  $escaped = [regex]::Replace($escaped, '(\\+)$', '$1$1')
  return '"' + $escaped + '"'
}`,
    `$executable = ${filePathExpression(spec.executable)}`,
    String.raw`if ($executable -notmatch '[/\\:]') {`,
    "  $commands = @(Get-Command -Name $executable -CommandType Application -ErrorAction Stop)",
    "  if ($commands.Count -ne 1) { throw \"Startup application name is ambiguous: $executable\" }",
    "  $executable = $commands[0].Source",
    "}",
    "if (-not [IO.Path]::IsPathFullyQualified($executable)) { throw \"Startup executable must be an absolute path or application name: $executable\" }",
    "if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) { throw \"Startup executable is missing: $executable\" }",
    "$executable = (Resolve-Path -LiteralPath $executable).ProviderPath",
    `$workingDirectory = ${filePathExpression(spec.workingDirectory ?? knownFolder("userProfile"))}`,
    "if (-not [IO.Path]::IsPathFullyQualified($workingDirectory) -or -not (Test-Path -LiteralPath $workingDirectory -PathType Container)) { throw \"Startup working directory must be an existing absolute directory: $workingDirectory\" }",
    "$workingDirectory = (Resolve-Path -LiteralPath $workingDirectory).ProviderPath",
    `$arguments = (@(${args.join(", ")}) | ForEach-Object { ConvertTo-WinixArgument $_ }) -join ' '`,
  ];
  return { spec, style, prelude };
}

const SHORTCUT_STYLES = ["normal", "minimized", "maximized"] as const;

function normalizeStartupShortcut(name: string, input: WinStartupShortcutSpec): WinDscResource {
  const helper = "windows.startup.shortcut";
  const common = startupCommon(helper, name, input, SHORTCUT_STYLES);
  const spec = { ...common.spec, ...normalizeFileOpts(common.spec, helper) };
  const showCommand = { normal: 1, minimized: 7, maximized: 3 }[common.style as typeof SHORTCUT_STYLES[number]];
  const prelude = [
    ...common.prelude,
    ...fileMoveTargetPrelude(),
    "$startup = [Environment]::GetFolderPath('Startup')",
    "if ([string]::IsNullOrWhiteSpace($startup)) { throw 'Windows Startup folder is unavailable' }",
    `$target = Join-Path $startup ${psSingleQuoted(`${name}.lnk`)}`,
    `$windowStyle = ${showCommand}`,
    // WScript.Shell uses ANSI for shortcut arguments; Shell.Application preserves Unicode.
    "$shell = New-Object -ComObject Shell.Application",
    "function Get-WinixStartupLink([string]$Path) {",
    "  $folder = $shell.NameSpace((Split-Path -Parent $Path))",
    "  if ($null -eq $folder) { throw \"Unable to read shortcut directory: $Path\" }",
    "  $item = $folder.ParseName((Split-Path -Leaf $Path))",
    "  if ($null -eq $item) { throw \"Unable to read shortcut: $Path\" }",
    "  return $item.GetLink()",
    "}",
    "function Test-WinixStartup([string]$Path = $target) {",
    "  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $false }",
    "  $link = Get-WinixStartupLink $Path",
    "  return $link.Path -ieq $executable -and $link.Arguments -ceq $arguments -and $link.WorkingDirectory -ieq $workingDirectory -and $link.ShowCommand -eq $windowStyle",
    "}",
  ];
  return withDscMetadata(scriptDsc(`Startup ${name}`, {
    getScript: [...prelude, "@{ Path = $target; InDesiredState = (Test-WinixStartup) }"].join("\n"),
    testScript: [...prelude, "Test-WinixStartup"].join("\n"),
    setScript: [
      ...prelude,
      "if (Test-WinixStartup) { return }",
      "$stagingDirectory = Join-Path ([IO.Path]::GetTempPath()) ('winix-startup-' + [guid]::NewGuid().ToString('N'))",
      "[IO.Directory]::CreateDirectory($stagingDirectory) | Out-Null",
      "try {",
      "  $stagingPath = Join-Path $stagingDirectory 'shortcut.lnk'",
      "  $seed = (New-Object -ComObject WScript.Shell).CreateShortcut($stagingPath)",
      "  $seed.TargetPath = $env:ComSpec",
      "  $seed.Save()",
      "  $link = Get-WinixStartupLink $stagingPath",
      "  $link.Path = $executable",
      "  $link.Arguments = $arguments",
      "  $link.WorkingDirectory = $workingDirectory",
      "  $link.ShowCommand = $windowStyle",
      "  $link.Save()",
      "  if (-not (Test-WinixStartup $stagingPath)) { throw \"Startup shortcut verification failed: $stagingPath\" }",
      "  [IO.Directory]::CreateDirectory($startup) | Out-Null",
      // Sign-in opens everything in the Startup folder, so a <name>.lnk.bak next to
      // the shortcut would prompt "How do you want to open this file?" at every
      // sign-in. Back up outside it, keeping the .lnk extension so it can be restored.
      ...(spec.backup ? [
        "  if (Test-Path -LiteralPath $target) {",
        "    $backupDirectory = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Winix\\startup-backups'",
        "    [IO.Directory]::CreateDirectory($backupDirectory) | Out-Null",
        "    $backupPath = Join-Path $backupDirectory ((Get-Date -Format 'yyyyMMdd-HHmmss-fff') + '-' + (Split-Path -Leaf $target))",
        "    if (Test-Path -LiteralPath $backupPath) { throw \"Backup target already exists: $backupPath\" }",
        "    Move-Item -LiteralPath $target -Destination $backupPath",
        "    Write-Host \"Moved the existing Startup shortcut to $backupPath\"",
        "  }",
      ] : [
        `  Move-WinixExistingTarget $target ${psBoolean(spec.force ?? false)} $false`,
      ]),
      "  Move-Item -LiteralPath $stagingPath -Destination $target",
      "} finally { Remove-Item -LiteralPath $stagingDirectory -Recurse -Force }",
      "if (-not (Test-WinixStartup)) { throw \"Startup shortcut verification failed: $target\" }",
    ].join("\n"),
  }, spec), { kind: "startup", name });
}

/** Task Scheduler folder for Winix-managed sign-in tasks. */
export const STARTUP_TASK_PATH = "\\Winix\\";
const APP_STYLES = ["normal", "minimized", "maximized", "hidden"] as const;

/**
 * A per-user "At log on" scheduled task in \Winix\. Unlike the Startup folder,
 * which Explorer runs last and one entry at a time, logon tasks start right
 * after sign-in. Registering one for the current user needs no elevation. The
 * task runs as the user, not elevated, with no time limit, normal priority,
 * on battery, and never a second instance.
 *
 * Window styles: normal runs the executable directly; hidden runs it through
 * a headless console host (console programs get no window); minimized and
 * maximized start it through a headless PowerShell launcher, since a task has
 * no window-style setting of its own.
 */
function normalizeStartupApp(name: string, input: WinStartupAppSpec): WinDscResource {
  const helper = "windows.startup.app";
  for (const key of ["backup", "force"] as const) {
    if (input && typeof input === "object" && key in input) {
      throw new Error(`${helper} does not take "${key}": its task lives in Task Scheduler's \\Winix\\ folder, which Winix owns`);
    }
  }
  const common = startupCommon(helper, name, input, APP_STYLES);
  const delay = input.delay ?? 0;
  if (typeof delay !== "number" || !Number.isInteger(delay) || delay < 0 || delay > 3600) {
    throw new Error(`${helper} delay must be a whole number of seconds from 0 to 3600`);
  }
  const prelude = [
    ...common.prelude,
    `$taskPath = ${psSingleQuoted(STARTUP_TASK_PATH)}`,
    `$taskName = ${psSingleQuoted(name)}`,
    `$delay = ${delay}`,
    `$windowStyle = ${psSingleQuoted(common.style)}`,
    "$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name",
    "$conhost = Join-Path ([Environment]::SystemDirectory) 'conhost.exe'",
    "function ConvertTo-WinixLiteral([string]$Value) { return \"'\" + $Value.Replace(\"'\", \"''\") + \"'\" }",
    "switch ($windowStyle) {",
    "  'normal' { $execute = $executable; $actionArguments = $arguments }",
    "  'hidden' { $execute = $conhost; $actionArguments = ('--headless ' + (ConvertTo-WinixArgument $executable) + $(if ($arguments) { ' ' + $arguments } else { '' })) }",
    "  default {",
    "    $style = if ($windowStyle -eq 'minimized') { 'Minimized' } else { 'Maximized' }",
    "    $launch = '$i = [Diagnostics.ProcessStartInfo]::new(' + (ConvertTo-WinixLiteral $executable) + '); $i.Arguments = ' + (ConvertTo-WinixLiteral $arguments) +",
    "      '; $i.WorkingDirectory = ' + (ConvertTo-WinixLiteral $workingDirectory) + '; $i.UseShellExecute = $true; $i.WindowStyle = ' + (ConvertTo-WinixLiteral $style) + '; [void][Diagnostics.Process]::Start($i)'",
    "    $execute = $conhost",
    "    $actionArguments = '--headless ' + (ConvertTo-WinixArgument (Join-Path $PSHOME 'pwsh.exe')) + ' -NoLogo -NoProfile -NonInteractive -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($launch))",
    "  }",
    "}",
    "function Get-WinixStartupTask { Get-ScheduledTask -TaskPath $taskPath -TaskName $taskName -ErrorAction SilentlyContinue }",
    "function Test-WinixStartupApp {",
    "  $task = Get-WinixStartupTask",
    "  if ($null -eq $task -or \"$($task.State)\" -eq 'Disabled') { return $false }",
    "  $actions = @($task.Actions); $triggers = @($task.Triggers)",
    "  if ($actions.Count -ne 1 -or $triggers.Count -ne 1) { return $false }",
    "  $trigger = $triggers[0]; $action = $actions[0]; $settings = $task.Settings",
    "  $actualDelay = if ($trigger.Delay) { [int][Xml.XmlConvert]::ToTimeSpan($trigger.Delay).TotalSeconds } else { 0 }",
    "  return $trigger.CimClass.CimClassName -eq 'MSFT_TaskLogonTrigger' -and $trigger.Enabled -and $trigger.UserId -ieq $user -and $actualDelay -eq $delay -and",
    "    $action.Execute -ieq $execute -and \"$($action.Arguments)\" -ceq $actionArguments -and $action.WorkingDirectory -ieq $workingDirectory -and",
    "    \"$($task.Principal.RunLevel)\" -eq 'Limited' -and \"$($task.Principal.LogonType)\" -eq 'Interactive' -and",
    "    [Xml.XmlConvert]::ToTimeSpan($settings.ExecutionTimeLimit) -eq [TimeSpan]::Zero -and -not $settings.DisallowStartIfOnBatteries -and",
    "    -not $settings.StopIfGoingOnBatteries -and $settings.Priority -eq 4 -and \"$($settings.MultipleInstances)\" -eq 'IgnoreNew'",
    "}",
  ];
  return withDscMetadata(scriptDsc(`Startup app ${name}`, {
    getScript: [...prelude, "@{ Task = ($taskPath + $taskName); InDesiredState = (Test-WinixStartupApp) }"].join("\n"),
    testScript: [...prelude, "Test-WinixStartupApp"].join("\n"),
    setScript: [
      ...prelude,
      "if (Test-WinixStartupApp) { return }",
      "$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user",
      "if ($delay -gt 0) { $trigger.Delay = 'PT' + $delay + 'S' }",
      "$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited",
      "$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -Priority 4 -Compatibility Win8",
      "$action = if ($actionArguments) { New-ScheduledTaskAction -Execute $execute -Argument $actionArguments -WorkingDirectory $workingDirectory } else { New-ScheduledTaskAction -Execute $execute -WorkingDirectory $workingDirectory }",
      "Register-ScheduledTask -TaskPath $taskPath -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Started at sign-in by Winix (windows.startup.app).' -Force | Out-Null",
      "if (-not (Test-WinixStartupApp)) { throw \"Startup app verification failed: $taskPath$taskName\" }",
    ].join("\n"),
  }, common.spec), { kind: "startup-app", name });
}

/**
 * Explorer's own startup pacing (HKCU ...\Explorer\Serialize): a delay before
 * it starts Run entries and Startup-folder shortcuts, and waiting for the
 * desktop to go idle. `false` turns each off; `true` restores the Windows
 * default (removes the value).
 */
function normalizeStartupExplorer(options: WinStartupExplorerOptions, opts: WinSettingOpts | undefined): WinDscResource {
  const helper = "windows.startup.explorer";
  if (!options || typeof options !== "object" || Array.isArray(options)) throw new Error(`${helper} requires an options object`);
  const values: [string, boolean | undefined][] = [
    ["StartupDelayInMSec", options.delay], ["WaitForIdleState", options.waitForIdle],
  ];
  for (const [, value] of values) {
    if (value !== undefined && typeof value !== "boolean") throw new Error(`${helper} delay and waitForIdle must be booleans`);
  }
  const declared = values.filter(([, value]) => value !== undefined) as [string, boolean][];
  if (declared.length === 0) throw new Error(`${helper} needs delay and/or waitForIdle`);
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    "$key = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Serialize'",
    // name -> $true: Windows default (no value); $false: 0 (off).
    `$desired = [ordered]@{ ${declared.map(([name, value]) => `${psSingleQuoted(name)} = ${psBoolean(value)}`).join("; ")} }`,
    "function Test-WinixExplorerStartup {",
    "  $current = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue",
    "  foreach ($name in $desired.Keys) {",
    "    $value = if ($null -ne $current) { $current.PSObject.Properties[$name] } else { $null }",
    "    if ($desired[$name]) { if ($null -ne $value) { return $false } }",
    "    elseif ($null -eq $value -or $value.Value -ne 0) { return $false }",
    "  }",
    "  return $true",
    "}",
  ];
  const label = declared.map(([name, value]) =>
    `${name === "StartupDelayInMSec" ? "startup delay" : "wait for idle"} ${value ? "default" : "off"}`).join(", ");
  const resource = scriptDsc(`Explorer startup ${label}`, {
    getScript: [...prelude, "@{ InDesiredState = (Test-WinixExplorerStartup) }"].join("\n"),
    testScript: [...prelude, "Test-WinixExplorerStartup"].join("\n"),
    setScript: [
      ...prelude,
      "if (Test-WinixExplorerStartup) { return }",
      "New-Item -Path $key -Force | Out-Null",
      "foreach ($name in $desired.Keys) {",
      "  if ($desired[$name]) { Remove-ItemProperty -LiteralPath $key -Name $name -ErrorAction SilentlyContinue }",
      "  else { New-ItemProperty -LiteralPath $key -Name $name -PropertyType DWord -Value 0 -Force | Out-Null }",
      "}",
      "if (-not (Test-WinixExplorerStartup)) { throw 'Explorer startup settings verification failed' }",
    ].join("\n"),
  }, { dependsOn: opts?.dependsOn });
  return withDscMetadata(resource, { kind: "startup-explorer", label: `Explorer startup: ${label}` });
}

export interface WinEnvNamespace {
  set(name: string, value: string, opts?: WinEnvOpts): ResourceHandle;
  remove(name: string, opts?: WinEnvOpts): ResourceHandle;
}

export interface WinPathNamespace {
  add(value: string, opts?: WinEnvOpts): ResourceHandle;
  remove(value: string, opts?: WinEnvOpts): ResourceHandle;
}

export interface WinFileNamespace {
  text(target: WinFilePath, content: string, opts?: WinFileOpts): ResourceHandle;
  symlink(target: WinFilePath, source: string | URL, opts?: WinFileOpts): ResourceHandle;
  copy(target: WinFilePath, source: string | URL, opts?: WinFileOpts): ResourceHandle;
  remove(target: WinFilePath, opts?: WinFileOpts): ResourceHandle;
}

export interface WindowsHelper {
  npm: { registries(policy: WinNpmRegistryPolicy): Fragment };
  fonts(spec: { sources: WinFontSource[]; dependsOn?: ResourceHandle | ResourceHandle[] }): ResourceHandle;
  wallpaper(spec: WinWallpaper & { dependsOn?: ResourceHandle | ResourceHandle[] }): ResourceHandle;
  personalization(options: WinPersonalization, opts?: WinSettingOpts): ResourceHandle;
  optionalFeature(name: string, opts?: WinOptionalFeatureOpts): ResourceHandle;
  wsl: WinWslNamespace;
  /** Programs started at sign-in (logon tasks or Startup shortcuts), never run during apply. */
  startup: WinStartupNamespace;
  /** Resolve a user folder on the target machine during activation. */
  knownFolder: {
    [Folder in WinKnownFolderName]: (path?: string) => WinKnownFolder;
  };
  powershell: {
    /** Select and optionally restrict feeds for Winix-managed modules on this host. */
    repositories(policy: WinPowerShellRepositoryPolicy): Fragment;
    /** Install a current-user PowerShell 7 module using winix-windows.lock. */
    module(name: string, opts?: WinPowerShellModuleOpts): ResourceHandle;
    /**
     * Link (or copy) the current user's PowerShell profile from `source`.
     * The target is `$PROFILE.CurrentUserCurrentHost`, i.e. Documents (OneDrive
     * redirection included) \\PowerShell (or WindowsPowerShell for 5.1).
     */
    profile(source: string | URL, opts?: WinPowerShellProfileOpts): ResourceHandle;
  };
  terminal: {
    /** Link (or copy) Windows Terminal's settings.json from `source` for the selected channel. */
    settings(source: string | URL, opts?: WinTerminalSettingsOpts): ResourceHandle;
  };
  /**
   * Absolute path of `path` relative to the directory holding winix.config.ts,
   * resolved when the workspace is evaluated, e.g. `windows.configPath("..")`
   * for the repository root. For values such as environment variables;
   * file sources are already config-relative.
   */
  configPath(path?: string): string;
  /**
   * Declare a winget/msstore package.
   *
   * ```ts
   * windows.package("Git.Git")
   * windows.package({ source: "msstore", id: "9NKSQGP7F2NH" })
   * windows.package({ id: "Git.Git", version: "2.44.0" })
   * windows.package("Valve.Steam", { version: "any" }) // self-updating: any version
   * ```
   */
  package(arg: WinPackageArg, opts?: WinPackageOpts): ResourceHandle;

  /**
   * Run an arbitrary command on every Windows switch as a
   * command resource.
   *
   * This is an escape hatch, not a declarative/idempotent helper: a raw
   * command has no test phase, so it runs on every `winix switch`. Prefer
   * typed helpers when available.
   * Command strings run in PowerShell 7 (`pwsh`); explicit executables are preserved.
   *
   * ```ts
   * windows.raw("New-Item -ItemType Directory -Force -Path $env:USERPROFILE\\.local\\bin")
   * windows.raw({ executable: "pwsh", arguments: ["-Command", "Write-Host hi"] })
   * windows.raw({ name: "make-bin-dir", executable: "cmd", arguments: ["/c", "mkdir", "foo"] })
   * ```
   */
  raw(arg: WinRawCommandArg): ResourceHandle;

  /**
   * Declare an arbitrary DSC v3 resource (escape hatch). The `type` is a fully
   * qualified DSC resource type and `properties` is serialized verbatim to the
   * generated configuration. Use this for resources Winix has no typed helper
   * for.
   *
   * ```ts
   * windows.dsc({
   *   type: "Microsoft.Windows/Service",
   *   properties: { name: "spooler", startType: "automatic" },
   * });
   * ```
   */
  dsc(arg: WinDscSpec): ResourceHandle;

  /**
   * Manage Windows OS settings through the native
   * `Microsoft.Windows.Settings/WindowsSettings` DSC resource. The emitter
   * automatically ensures the required `Microsoft.Windows.Settings` module is
   * installed and wires settings resources to depend on it.
   *
   * ```ts
   * windows.setting({ DeveloperMode: true });
   * windows.setting({ SystemColorMode: "Dark", TaskbarAlignment: "Left" });
   * ```
   */
  setting(settings: WinSettings, opts?: WinSettingOpts): ResourceHandle;

  /**
   * Manage a user/machine environment variable declaratively via the native
   * `Microsoft.Windows/Registry` DSC resource.
   *
   * ```ts
   * windows.env.set("EDITOR", "nvim");
   * windows.env.remove("OLD_VAR");
   * ```
   */
  env: WinEnvNamespace;

  /**
   * Ensure a directory is on the PATH, appending/removing surgically via an
   * idempotent `Microsoft.DSC.Transitional/PowerShellScript` resource.
   *
   * ```ts
   * windows.path.add("%USERPROFILE%\\.local\\bin");
   * windows.path.remove("%USERPROFILE%\\.old-bin");
   * ```
   */
  path: WinPathNamespace;

  /**
   * Manage files, copies, and dotfile symlinks declaratively via an idempotent
   * `Microsoft.DSC.Transitional/PowerShellScript` resource.
   *
   * ```ts
   * windows.file.text("%USERPROFILE%\\.gitconfig", "[user]\n");
   * windows.file.symlink("%LOCALAPPDATA%\\nvim", "%USERPROFILE%\\dotfiles\\nvim");
   * windows.file.copy("%APPDATA%\\tool\\config.json", ".\\config.json");
   * windows.file.remove("%USERPROFILE%\\.oldrc");
   * ```
   */
  file: WinFileNamespace;
}

/**
 * Attach a resource identity to a fragment, turning it into a handle that can
 * be passed to another resource's `dependsOn`. The `__winixHandle` marker is
 * non-enumerable so it never leaks into the merged IR or emitted output.
 */
/** The target of a handle returned by windows.file.* (and the file helpers built on it). */
function fileHandleTarget(value: unknown): WinFilePath | undefined {
  if (!value || typeof value !== "object" || !("__winixHandle" in value)) return undefined;
  const dsc = (value as ResourceHandle).windows?.dsc;
  const resource = dsc?.[dsc.length - 1];
  return resource?.winix?.kind === "file" && resource.winix.action !== "remove" ? resource.winix.target : undefined;
}

function asHandle(fragment: Fragment, ref: ResourceRef): ResourceHandle {
  Object.defineProperty(fragment, "__winixHandle", {
    value: ref,
    enumerable: false,
    configurable: true,
  });
  return fragment as ResourceHandle;
}

function linkedFile(
  target: WinKnownFolder, source: string | URL, opts: WinLinkedFileOpts, helper: string,
): ResourceHandle {
  if (!opts || typeof opts !== "object" || Array.isArray(opts)) throw new Error(`${helper} options must be an object`);
  const { mode = "symlink", ...fileOpts } = opts;
  if (mode !== "symlink" && mode !== "copy") throw new Error(`${helper} mode must be "symlink" or "copy"`);
  return dscHandle(mode === "copy"
    ? normalizeFileCopy(target, source, fileOpts)
    : normalizeFileSymlink(target, source, fileOpts));
}

function dscHandle(resource: WinDscResource): ResourceHandle {
  const fragment: Fragment = { windows: { dsc: [resource] } };
  return asHandle(fragment, { kind: "dsc", token: resource.token! });
}

export const windows: WindowsHelper = {
  optionalFeature: (name, opts = {}) => optionalFeatures([name], opts),
  wsl: Object.assign(
    (opts: WinWslOpts = {}): ResourceHandle => {
      normalizeFileOpts(opts, "windows.wsl");
      const content = opts.config === undefined ? undefined : serializeWslConfig(opts.config);
      // Every Microsoft.WSL installer needs administrator rights (the MSI is
      // machine-wide and the MSIX requires elevation), and `winget show` can't tell.
      const runtime = windows.package({ id: "Microsoft.WSL", elevated: true });
      const dependencies = opts.dependsOn === undefined ? []
        : Array.isArray(opts.dependsOn) ? opts.dependsOn : [opts.dependsOn];
      const enabled = optionalFeatures(
        ["Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform"], { dependsOn: [runtime, ...dependencies] }
      );
      enabled.windows!.packages = runtime.windows!.packages;
      if (content === undefined) return enabled;
      const resource = normalizeFileText(knownFolder("userProfile", ".wslconfig"), content, {
        backup: opts.backup, force: opts.force, dependsOn: opts.dependsOn,
      });
      if (resource.winix?.kind === "file") resource.winix.wslConfig = true;
      resource.name = "WSL configuration";
      resource.dependsOn = [enabled.__winixHandle, ...(resource.dependsOn ?? [])];
      const configured = dscHandle(resource);
      configured.windows!.packages = enabled.windows!.packages;
      configured.windows!.dsc!.unshift(...enabled.windows!.dsc!);
      return configured;
    },
    {
      distro: (name: string, spec: WinWslDistroSpec): ResourceHandle => {
        if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]{0,63}$/i.test(name)) {
          throw new Error("windows.wsl.distro requires a distro name containing only letters, numbers, '.', '_' or '-'");
        }
        if (!spec || spec.source !== "nixos-wsl" || !validFilePath(spec.installLocation) ||
            (typeof spec.installLocation === "string" &&
              (!win32.isAbsolute(spec.installLocation) && !spec.installLocation.startsWith("%"))) ||
            (spec.default !== undefined && typeof spec.default !== "boolean")) {
          throw new Error("windows.wsl.distro requires source 'nixos-wsl', an absolute/environment/known-folder installLocation, and an optional boolean default");
        }
        const expectedHost = spec.host === undefined ? undefined : hostName(spec.host, "windows.wsl.distro host");
        if (expectedHost !== undefined && !/^[a-z0-9][a-z0-9._-]*$/i.test(expectedHost)) {
          throw new Error("windows.wsl.distro host must be a valid expected Linux hostname");
        }
        const setup = spec.setup === undefined ? undefined : resolveWslSetupSpec(spec.setup);
        return dscHandle(withDscMetadata(withDscToken({
          resourceType: POWERSHELL_SCRIPT_RESOURCE,
          name: `WSL distro ${name}`,
          dependsOn: resolveDependsOn(spec.dependsOn),
        }), { kind: "wsl-distro", distro: {
          name, source: spec.source, installLocation: spec.installLocation, default: spec.default ?? false,
          ...(expectedHost === undefined ? {} : { host: expectedHost }),
          ...(setup === undefined ? {} : { setup: setup.setup }),
          ...(setup?.refFromCheckout ? { setupRefFromCheckout: true } : {}),
        } }));
      },
    },
  ),
  startup: {
    app: (name, spec) => dscHandle(normalizeStartupApp(name, spec)),
    shortcut: (name, spec) => dscHandle(normalizeStartupShortcut(name, spec)),
    explorer: (options, opts) => dscHandle(normalizeStartupExplorer(options, opts)),
  },
  knownFolder: {
    documents: (path) => knownFolder("documents", path),
    desktop: (path) => knownFolder("desktop", path),
    localAppData: (path) => knownFolder("localAppData", path),
    appData: (path) => knownFolder("appData", path),
    userProfile: (path) => knownFolder("userProfile", path),
    programFiles: (path) => knownFolder("programFiles", path),
    programFilesX86: (path) => knownFolder("programFilesX86", path),
  },
  configPath: (path = ".") => {
    const configDir = getOptionalEvalContext()?.configDir;
    if (!configDir) {
      throw new Error("windows.configPath needs the config directory; evaluate the workspace through the Winix CLI");
    }
    if (typeof path !== "string") throw new Error("windows.configPath(path) requires a string");
    return win32.resolve(configDir, path);
  },
  terminal: {
    settings: (source, opts = {}) => {
      const { channel = "stable", ...rest } = opts;
      if (channel !== "stable" && channel !== "preview") {
        throw new Error('windows.terminal.settings channel must be "stable" or "preview"');
      }
      const packageName = channel === "preview" ? "Microsoft.WindowsTerminalPreview" : "Microsoft.WindowsTerminal";
      return linkedFile(knownFolder("localAppData", `Packages/${packageName}_8wekyb3d8bbwe/LocalState/settings.json`),
        source, rest, "windows.terminal.settings");
    },
  },
  powershell: {
    profile: (source, opts = {}) => {
      const { shell = "pwsh", ...rest } = opts;
      if (shell !== "pwsh" && shell !== "windowspowershell") {
        throw new Error('windows.powershell.profile shell must be "pwsh" or "windowspowershell"');
      }
      const directory = shell === "pwsh" ? "PowerShell" : "WindowsPowerShell";
      return linkedFile(knownFolder("documents", `${directory}/Microsoft.PowerShell_profile.ps1`),
        source, rest, "windows.powershell.profile");
    },
    repositories: (policy) => {
      validatePowerShellRepositoryPolicy(policy);
      return { windows: { powershell: { repositories: policy } } };
    },
    module: (name, opts = {}) => {
      if (typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name)) {
        throw new Error("windows.powershell.module requires a module name without wildcards or paths");
      }
      if (!opts || typeof opts !== "object" || Array.isArray(opts)) {
        throw new Error("windows.powershell.module options must be an object");
      }
      const repository = opts.repository;
      if (repository !== undefined && (typeof repository !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(repository))) {
        throw new Error("windows.powershell.module repository must be a registered repository name");
      }
      if (opts.prerelease !== undefined && typeof opts.prerelease !== "boolean") {
        throw new Error("windows.powershell.module prerelease must be a boolean");
      }
      const resource = withDscMetadata(withDscToken({
        resourceType: POWERSHELL_SCRIPT_RESOURCE,
        name: `PowerShell module ${name}`,
        dependsOn: resolveDependsOn(opts.dependsOn),
      }), { kind: "powershell-module", module: {
        name, repository, ...(opts.prerelease !== undefined ? { prerelease: opts.prerelease } : {}),
      } });
      return dscHandle(resource);
    },
  },
  npm: {
    registries: (policy) => {
      npmRegistryEntries(policy);
      return { windows: { npm: { registries: policy } } };
    },
  },
  package: (arg: WinPackageArg, opts?: WinPackageOpts): ResourceHandle => {
    const pkg = normalizePackage(arg, opts);
    const fragment: Fragment = { windows: { packages: { [pkg.id]: pkg } } };
    return asHandle(fragment, { kind: "package", id: pkg.id });
  },
  raw: (arg: WinRawCommandArg): ResourceHandle => {
    const command = normalizeRawCommand(arg);
    const fragment: Fragment = { windows: { commands: [command] } };
    return asHandle(fragment, { kind: "command", token: command.token! });
  },
  dsc: (arg: WinDscSpec): ResourceHandle => {
    const resource = normalizeDsc(arg);
    const fragment: Fragment = { windows: { dsc: [resource] } };
    return asHandle(fragment, { kind: "dsc", token: resource.token! });
  },
  setting: (settings: WinSettings, opts?: WinSettingOpts): ResourceHandle =>
    dscHandle(normalizeSetting(settings, opts)),
  fonts: (spec) => {
    validateFontSources(spec?.sources);
    return dscHandle(withDscMetadata(withDscToken({
      resourceType: POWERSHELL_SCRIPT_RESOURCE, name: "Windows fonts",
      dependsOn: resolveDependsOn(spec.dependsOn),
    }), { kind: "fonts", sources: spec.sources }));
  },
  wallpaper: (spec) => {
    validateWallpaper(spec);
    return dscHandle(withDscMetadata(withDscToken({
      resourceType: POWERSHELL_SCRIPT_RESOURCE, name: "Windows wallpaper",
      dependsOn: resolveDependsOn(spec.dependsOn),
    }), { kind: "wallpaper", wallpaper: { source: spec.source, style: spec.style } }));
  },
  personalization: (options, opts) => dscHandle(withDscToken({
    resourceType: POWERSHELL_SCRIPT_RESOURCE, name: "Windows personalization",
    properties: personalizationProperties(personalizationValues(options), options.taskbar?.autoHide),
    dependsOn: resolveDependsOn(opts?.dependsOn),
  })),
  env: {
    set: (name: string, value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizeEnv(name, "Present", value, opts)),
    remove: (name: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizeEnv(name, "Absent", undefined, opts)),
  },
  path: {
    add: (value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizePath(value, "Present", opts)),
    remove: (value: string, opts?: WinEnvOpts): ResourceHandle =>
      dscHandle(normalizePath(value, "Absent", opts)),
  },
  file: {
    text: (target, content, opts): ResourceHandle =>
      dscHandle(normalizeFileText(target, content, opts)),
    symlink: (target, source, opts): ResourceHandle =>
      dscHandle(normalizeFileSymlink(target, source, opts)),
    copy: (target, source, opts): ResourceHandle =>
      dscHandle(normalizeFileCopy(target, source, opts)),
    remove: (target, opts): ResourceHandle =>
      dscHandle(normalizeFileRemove(target, opts)),
  },
};

function hostName(value: string | HostDef, label: string): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.name === "string" && value.platform) return value.name;
  throw new Error(`${label} must be a host name or a host(...) value`);
}

/**
 * Resolve the authoring form of a WSL setup into its normalized, concrete
 * shape. `repository: "self"` reads the config checkout (local Git only).
 */
export function resolveWslSetupSpec(spec: WinWslSetupSpec): { setup: WinWslSetup; refFromCheckout: boolean } {
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) {
    throw new Error("windows.wsl.distro setup must be an object");
  }
  const host = hostName(spec.host, "WSL setup host");
  let user: string | undefined;
  if (spec.user === undefined || typeof spec.user === "string") user = spec.user;
  else if ((typeof spec.user === "object" || typeof spec.user === "function") &&
      spec.user.kind === "account.user" && typeof spec.user.name === "string") user = spec.user.name;
  else throw new Error("WSL setup user must be a Linux account name or an account.user(...) value");
  let { repository, ref, configDirectory } = spec;
  let refFromCheckout = false;
  if (repository === "self") {
    const configDir = getOptionalEvalContext()?.configDir;
    if (!configDir) {
      throw new Error('WSL setup repository "self" needs the config directory; evaluate the workspace through the Winix CLI');
    }
    const inferred = inferWslSetupRepository(configDir);
    repository = inferred.repository;
    refFromCheckout = ref === undefined;
    ref ??= inferred.ref;
    configDirectory ??= inferred.configDirectory;
  }
  if (configDirectory === undefined) {
    throw new Error('WSL setup configDirectory is required unless repository is "self"');
  }
  return {
    setup: normalizeWslSetup({
      ...spec, repository, ref, configDirectory, host, ...(user === undefined ? {} : { user }),
    } as WinWslSetup),
    refFromCheckout,
  };
}

export function normalizeWslSetup(setup: WinWslSetup): WinWslSetup {
  if (!setup || typeof setup !== "object" || Array.isArray(setup)) {
    throw new Error("windows.wsl.distro setup must be an object");
  }
  let url: URL;
  try { url = new URL(setup.repository); } catch { throw new Error("WSL setup repository must be an HTTPS Git URL"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new Error("WSL setup repository must be HTTPS without credentials, query, or fragment");
  }
  const ref = setup.ref ?? "HEAD";
  if (typeof ref !== "string" || !/^[a-z0-9][a-z0-9._/-]*$/i.test(ref) || ref.includes("..") ||
      ref.endsWith("/") || ref.includes("//")) throw new Error("Invalid WSL setup Git ref");
  if (typeof setup.configDirectory !== "string" || !setup.configDirectory ||
      setup.configDirectory.startsWith("/") || /^[a-z]:/i.test(setup.configDirectory) || /[\\\x00-\x1f\x7f]/.test(setup.configDirectory) ||
      setup.configDirectory.split("/").includes("..")) throw new Error("WSL setup configDirectory must stay inside the repository");
  if (typeof setup.host !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(setup.host)) throw new Error("Invalid WSL setup host");
  if (setup.user !== undefined && (typeof setup.user !== "string" ||
      !/^[a-z_][a-z0-9_-]*$/.test(setup.user) || setup.user === "root")) throw new Error("WSL setup user must be a non-root Linux account");
  if (setup.checkout !== undefined && (typeof setup.checkout !== "string" || !setup.checkout.startsWith("/") ||
      /^\/+$/.test(setup.checkout) || /[\\\x00-\x1f\x7f]/.test(setup.checkout) ||
      setup.checkout.split("/").some((part) => part === ".." || part === "."))) throw new Error("WSL setup checkout must be an absolute Linux directory");
  return {
    repository: url.href, ref, configDirectory: posix.normalize(setup.configDirectory), host: setup.host,
    ...(setup.checkout === undefined ? {} : { checkout: posix.normalize(setup.checkout).replace(/\/+$/, "") }),
    ...(setup.user === undefined ? {} : { user: setup.user }),
  };
}

function optionalFeatures(names: string[], opts: WinOptionalFeatureOpts): ResourceHandle {
  if (!opts || typeof opts !== "object" || Array.isArray(opts) ||
      (opts.enabled !== undefined && typeof opts.enabled !== "boolean") ||
      names.some((name) => typeof name !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(name))) {
    throw new Error("windows.optionalFeature requires a Windows feature name and boolean enabled option");
  }
  return dscHandle(withDscMetadata(withDscToken({
    resourceType: POWERSHELL_SCRIPT_RESOURCE,
    name: `Windows features ${names.join(" ")}`,
    elevated: true,
    dependsOn: resolveDependsOn(opts.dependsOn),
  }), { kind: "optional-features", names, enabled: opts.enabled ?? true }));
}

function serializeWslConfig(config: WinWslConfig): string {
  const allowed: Record<string, Record<string, string | readonly string[]>> = {
    wsl2: {
      memory: "positive-size", swap: "size", processors: "integer",
      localhostForwarding: "boolean", dnsTunneling: "boolean", firewall: "boolean",
      autoProxy: "boolean", guiApplications: "boolean",
      networkingMode: ["nat", "mirrored", "none", "virtioproxy"],
    },
    experimental: { autoMemoryReclaim: ["disabled", "gradual", "dropCache"], sparseVhd: "boolean" },
  };
  if (!config || typeof config !== "object" || Array.isArray(config) || !Object.keys(config).length) {
    throw new Error("windows.wsl config must be a non-empty configuration object");
  }
  const lines: string[] = [];
  for (const [section, entries] of Object.entries(config)) {
    if (!Object.hasOwn(allowed, section) || !entries || typeof entries !== "object" ||
        Array.isArray(entries) || !Object.keys(entries).length) throw new Error(`Invalid .wslconfig section: ${section}`);
    lines.push(`[${section}]`);
    for (const [key, value] of Object.entries(entries)) {
      const rule = allowed[section][key];
      const valid = Array.isArray(rule) ? rule.includes(value) :
        rule === "boolean" ? typeof value === "boolean" :
        rule === "integer" ? typeof value === "number" && Number.isSafeInteger(value) && value > 0 :
        rule === "positive-size" ? typeof value === "string" && /^[1-9]\d*(?:MB|GB)$/i.test(value) :
        rule === "size" ? typeof value === "string" && /^(?:0|(?:0|[1-9]\d*)(?:MB|GB))$/i.test(value) : false;
      if (!valid) throw new Error(`Invalid .wslconfig option: ${section}.${key}`);
      lines.push(`${key}=${String(value)}`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
