import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { collectFontSources, validFontPin, type WindowsFontPin } from "./fonts.ts";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import type { WinPackage, WinPackageSource, WindowsOptions } from "../../types/index.ts";
import { validWslImage, type WslArchitecture, type WindowsWslImageResolver } from "./wsl.ts";
import {
  validWslRepository, wslRepositoryKey,
  type WindowsLockWslRepository, type WindowsWslRepositoryResolver,
} from "./wsl-setup.ts";
import {
  resolvePowerShellModule, powerShellRepositoryUri, powerShellModuleVersion, windowsSettingsModule,
  type ResolvedPowerShellModule,
} from "../../helpers/windows-repositories.ts";

export const WINDOWS_LOCKFILE_NAME = "winix-windows.lock";
export const WINDOWS_LOCK_VERSION = 1;

export interface WindowsLockPackage {
  source: WinPackageSource;
  version: string;
  resolvedAt: string;
}

export interface WindowsLock {
  version: typeof WINDOWS_LOCK_VERSION;
  /**
   * Legacy timestamp. No longer written: it changed on every resolution and
   * caused merge conflicts between machines. Older lock files may carry it.
   */
  generatedAt?: string;
  packages: Record<string, WindowsLockPackage>;
  fonts?: Record<string, WindowsFontPin>;
  /** Source-qualified lowercase keys; legacy name-only entries remain readable. */
  modules?: Record<string, WindowsLockModule>;
  wslImages?: Record<string, WindowsLockWslImage>;
  wslRepositories?: Record<string, WindowsLockWslRepository>;
}

export interface WindowsLockWslImage {
  source: "nixos-wsl";
  architecture: WslArchitecture;
  version: string;
  url: string;
  sha256: string;
  resolvedAt: string;
}

export interface WindowsLockModule {
  repository: string;
  repositoryUri?: string;
  version: string;
  resolvedAt: string;
}

export type WindowsModuleVersionResolver = (
  name: string, repository: string, repositoryUri?: string, prerelease?: boolean
) => string | Promise<string>;

export function windowsModuleKey(module: ResolvedPowerShellModule): string {
  const name = module.name.toLowerCase();
  if (!module.repositoryUri && module.repository.toLowerCase() === "psgallery") return name;
  const source = `${name}@${module.repository.toLowerCase()}`;
  return module.repositoryUri
    ? `${source}/${createHash("sha256").update(powerShellRepositoryUri(module.repositoryUri)).digest("hex")}`
    : source;
}

export function windowsModulePin(lock: WindowsLock, module: ResolvedPowerShellModule): WindowsLockModule | undefined {
  const pin = lock.modules?.[windowsModuleKey(module)] ??
    (!module.repositoryUri ? lock.modules?.[module.name.toLowerCase()] : undefined);
  if (pin?.repository.toLowerCase() !== module.repository.toLowerCase() ||
      pin?.repositoryUri !== module.repositoryUri ||
      (!module.prerelease && pin.version.includes("-"))) return undefined;
  return pin;
}

export type WindowsPackageVersionResolver = (
  id: string,
  source: WinPackageSource
) => string;

export interface WindowsLockResolution {
  id: string;
  source: WinPackageSource;
  version: string;
  previousVersion?: string;
  status: "new" | "updated" | "up-to-date";
}

export interface WindowsLockResolutionResult {
  lock: WindowsLock;
  resolutions: WindowsLockResolution[];
  changed: boolean;
}

export function readWindowsLock(configDir: string): WindowsLock | null {
  const path = windowsLockPath(configDir);
  if (!existsSync(path)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    throw new Error(
      `Malformed ${WINDOWS_LOCKFILE_NAME}: ${(err as Error).message}`
    );
  }

  return validateWindowsLock(parsed);
}

export function writeWindowsLock(configDir: string, lock: WindowsLock): void {
  writeFileSync(windowsLockPath(configDir), serializeWindowsLock(lock));
}

export function reconcileInlinePins(
  lock: WindowsLock,
  evaluatedWindowsHosts: EvaluatedHost[],
  now = new Date()
): WindowsLock {
  let changed = false;
  const resolvedAt = now.toISOString();
  const packages: Record<string, WindowsLockPackage> = {};
  const inlinePins = new Map<string, { source: WinPackageSource; version: string }>();

  for (const [id, entry] of Object.entries(lock.packages)) {
    packages[id] = { ...entry };
  }

  for (const host of evaluatedWindowsHosts) {
    const win = host.windows as WindowsOptions;
    for (const pkg of Object.values(win.packages ?? {})) {
      if (pkg.anyVersion && pkg.version !== undefined) {
        throw new Error(
          `Windows package "${pkg.id}" is declared with both version "any" and version "${pkg.version}" in host "${host.name}". ` +
          "Declare one version policy per package."
        );
      }
      if (pkg.version === undefined) continue;

      const priorPin = inlinePins.get(pkg.id);
      if (
        priorPin !== undefined &&
        (priorPin.source !== pkg.source || priorPin.version !== pkg.version)
      ) {
        throw new Error(
          `Windows package "${pkg.id}" has conflicting inline version pins ` +
          `across Windows hosts. Use one source/version per package id.`
        );
      }
      inlinePins.set(pkg.id, { source: pkg.source, version: pkg.version });

      const existing = packages[pkg.id];
      if (existing?.version === pkg.version && existing.source === pkg.source) {
        continue;
      }

      packages[pkg.id] = {
        source: pkg.source,
        version: pkg.version,
        resolvedAt,
      };
      changed = true;
    }
  }

  return {
    ...lock,
    version: WINDOWS_LOCK_VERSION,
    packages,
  };
}

/**
 * Floating packages without a lock pin. Apply resolves them with winget (network),
 * which is also when a mistyped id first fails; check reports them offline.
 */
export function windowsLockGaps(
  lock: WindowsLock | null, evaluatedWindowsHosts: EvaluatedHost[],
): { host: string; id: string; source: WinPackageSource }[] {
  const gaps: { host: string; id: string; source: WinPackageSource }[] = [];
  for (const host of evaluatedWindowsHosts) {
    for (const pkg of Object.values((host.windows as WindowsOptions).packages ?? {})) {
      if (pkg.version !== undefined || pkg.anyVersion || lock?.packages[pkg.id]) continue;
      gaps.push({ host: host.name, id: pkg.id, source: pkg.source });
    }
  }
  return gaps;
}

export interface WindowsLockGap {
  host: string;
  kind: "package" | "module" | "wsl-image" | "wsl-repository" | "font";
  /** What is missing, for messages. */
  label: string;
  /** The `winix update --windows <selector>` argument that pins it. */
  selector: string;
}

/**
 * Every pin `apply` would have to resolve online: floating packages, PowerShell
 * modules (including the implicit Microsoft.Windows.Settings used by
 * `windows.setting`), NixOS-WSL images, WSL setup commits and remote fonts.
 */
export function windowsLockPinGaps(lock: WindowsLock | null, evaluatedWindowsHosts: EvaluatedHost[]): WindowsLockGap[] {
  const pins = lock ?? emptyWindowsLock();
  const gaps: WindowsLockGap[] = windowsLockGaps(lock, evaluatedWindowsHosts).map((gap) => ({
    host: gap.host, kind: "package", label: `package ${gap.id}`, selector: gap.id,
  }));
  for (const host of evaluatedWindowsHosts) {
    const win = host.windows as WindowsOptions;
    for (const module of collectWindowsModules([host]).values()) {
      if (windowsModulePin(pins, module)) continue;
      const implicit = module.name.toLowerCase() === "microsoft.windows.settings" &&
        !(win.dsc ?? []).some((resource) => resource.winix?.kind === "powershell-module" &&
          resource.winix.module.name.toLowerCase() === "microsoft.windows.settings");
      gaps.push({
        host: host.name, kind: "module", selector: module.name,
        label: `PowerShell module ${module.name}${implicit ? " (implicit, used by windows.setting)" : ""}`,
      });
    }
    if (hasWindowsWslDistros([host])) {
      for (const architecture of ["x64", "arm64"]) {
        if (!pins.wslImages?.[`nixos-wsl/${architecture}`]) {
          gaps.push({ host: host.name, kind: "wsl-image", label: `NixOS-WSL image (${architecture})`, selector: "nixos-wsl" });
        }
      }
    }
    for (const resource of win.dsc ?? []) {
      if (resource.winix?.kind !== "wsl-distro" || !resource.winix.distro.setup) continue;
      const setup = resource.winix.distro.setup;
      if (pins.wslRepositories?.[wslRepositoryKey(setup)]) continue;
      gaps.push({
        host: host.name, kind: "wsl-repository", selector: "wsl-setup",
        label: `WSL setup commit for ${setup.repository}#${setup.ref ?? "HEAD"}`,
      });
    }
    for (const [key, source] of collectFontSources([host])) {
      if (pins.fonts?.[key]) continue;
      gaps.push({
        host: host.name, kind: "font", selector: "fonts",
        label: `font ${"provider" in source ? `${source.provider} ${source.family}` : source.url}`,
      });
    }
  }
  return gaps;
}

export function emptyWindowsLock(_now = new Date()): WindowsLock {
  return { version: WINDOWS_LOCK_VERSION, packages: {} };
}

export function resolveMissingWindowsLockEntries(
  lock: WindowsLock,
  evaluatedWindowsHosts: EvaluatedHost[],
  resolveVersion: WindowsPackageVersionResolver,
  now = new Date()
): WindowsLockResolutionResult {
  const missing = new Map<string, WinPackage>();

  for (const host of evaluatedWindowsHosts) {
    const win = host.windows as WindowsOptions;
    for (const pkg of Object.values(win.packages ?? {})) {
      if (pkg.version !== undefined || pkg.anyVersion || lock.packages[pkg.id] !== undefined) continue;

      const existing = missing.get(pkg.id);
      if (existing && existing.source !== pkg.source) {
        throw new Error(
          `Windows package "${pkg.id}" is declared with multiple sources. ` +
          `Use one source per package id.`
        );
      }
      missing.set(pkg.id, pkg);
    }
  }

  return resolveWindowsLockEntries(lock, missing.values(), resolveVersion, now);
}

export function resolveWindowsLockEntries(
  lock: WindowsLock,
  packages: Iterable<WinPackage>,
  resolveVersion: WindowsPackageVersionResolver,
  now = new Date()
): WindowsLockResolutionResult {
  const resolvedAt = now.toISOString();
  const next: WindowsLock = {
    ...lock,
    version: WINDOWS_LOCK_VERSION,
    packages: cloneLockPackages(lock.packages),
  };
  const resolutions: WindowsLockResolution[] = [];
  let changed = false;

  for (const pkg of packages) {
    const previous = next.packages[pkg.id];
    const version = resolveVersion(pkg.id, pkg.source);
    if (previous?.source === pkg.source && previous.version === version) {
      resolutions.push({
        id: pkg.id,
        source: pkg.source,
        version,
        status: "up-to-date",
      });
      continue;
    }

    next.packages[pkg.id] = {
      source: pkg.source,
      version,
      resolvedAt,
    };
    changed = true;
    resolutions.push({
      id: pkg.id,
      source: pkg.source,
      version,
      previousVersion: previous?.version,
      status: previous ? "updated" : "new",
    });
  }

  return { lock: next, resolutions, changed };
}

export function windowsLockChanged(before: WindowsLock, after: WindowsLock): boolean {
  return serializeWindowsLock(before) !== serializeWindowsLock(after);
}

export function serializeWindowsLock(lock: WindowsLock): string {
  const sorted: WindowsLock = {
    version: WINDOWS_LOCK_VERSION,
    packages: {},
  };

  for (const id of Object.keys(lock.packages).sort(comparePackageIds)) {
    const entry = lock.packages[id];
    sorted.packages[id] = {
      source: entry.source,
      version: entry.version,
      resolvedAt: entry.resolvedAt,
    };
  }

  if (lock.modules !== undefined) {
    sorted.modules = {};
    for (const name of Object.keys(lock.modules).sort(comparePackageIds)) {
      sorted.modules[name] = { ...lock.modules[name] };
    }
  }
  if (lock.fonts !== undefined) {
    sorted.fonts = {};
    for (const key of Object.keys(lock.fonts).sort(comparePackageIds)) sorted.fonts[key] = { ...lock.fonts[key] };
  }
  if (lock.wslImages !== undefined) {
    sorted.wslImages = {};
    for (const key of Object.keys(lock.wslImages).sort(comparePackageIds)) {
      sorted.wslImages[key] = { ...lock.wslImages[key] };
    }
  }
  if (lock.wslRepositories !== undefined) {
    sorted.wslRepositories = {};
    for (const key of Object.keys(lock.wslRepositories).sort(comparePackageIds)) {
      sorted.wslRepositories[key] = { ...lock.wslRepositories[key] };
    }
  }
  return JSON.stringify(sorted, null, 2) + "\n";
}

export function collectWindowsModules(hosts: EvaluatedHost[]): Map<string, ResolvedPowerShellModule> {
  const modules = new Map<string, ResolvedPowerShellModule>();
  for (const host of hosts) {
    const win = host.windows as WindowsOptions;
    const hostModules = new Map<string, string>();
    const declared = (win.dsc ?? []).flatMap((resource) =>
      resource.winix?.kind === "powershell-module" ? [resolvePowerShellModule(win, resource.winix.module)] : []);
    if (win.dsc?.some((resource) => resource.winix?.kind === "setting")) declared.push(windowsSettingsModule(win));
    for (const module of declared) {
      const key = windowsModuleKey(module);
      const existing = hostModules.get(module.name.toLowerCase());
      if (existing && existing !== key) {
        throw new Error(`PowerShell module "${module.name}" is declared with conflicting repositories.`);
      }
      hostModules.set(module.name.toLowerCase(), key);
      const previous = modules.get(key);
      modules.set(key, previous ? { ...module, prerelease: !!previous.prerelease && !!module.prerelease } : module);
    }
  }
  return modules;
}

export function hasWindowsWslDistros(hosts: EvaluatedHost[]): boolean {
  return hosts.some((host) => (host.windows as WindowsOptions).dsc?.some(
    (resource) => resource.winix?.kind === "wsl-distro"
  ));
}

export async function resolveWindowsWslImages(
  lock: WindowsLock, resolve: WindowsWslImageResolver, now = new Date(), missingOnly = false
): Promise<{ lock: WindowsLock; changed: boolean }> {
  const images = { ...lock.wslImages };
  let changed = false;
  for (const architecture of ["x64", "arm64"] as const) {
    const key = `nixos-wsl/${architecture}`;
    if (missingOnly && images[key]) continue;
    const image = { ...await resolve(architecture), resolvedAt: now.toISOString() };
    if (!validWslImage(image) || image.architecture !== architecture) {
      throw new Error(`Invalid NixOS-WSL image resolution for ${architecture}`);
    }
    const previous = images[key];
    if (previous?.version === image.version && previous.url === image.url && previous.sha256 === image.sha256) continue;
    images[key] = image;
    changed = true;
  }
  return {
    lock: changed ? { ...lock, wslImages: images } : lock,
    changed,
  };
}

export function resolveWindowsWslRepositories(
  lock: WindowsLock, hosts: EvaluatedHost[], resolve: WindowsWslRepositoryResolver, now = new Date(), missingOnly = false
): { lock: WindowsLock; changed: boolean } {
  const repositories = { ...lock.wslRepositories };
  const visited = new Set<string>();
  let changed = false;
  for (const host of hosts) {
    for (const resource of (host.windows as WindowsOptions).dsc ?? []) {
      if (resource.winix?.kind !== "wsl-distro" || !resource.winix.distro.setup) continue;
      const setup = resource.winix.distro.setup;
      const key = wslRepositoryKey(setup);
      if (visited.has(key)) continue;
      visited.add(key);
      if (missingOnly && repositories[key]) continue;
      const pin = {
        repository: setup.repository, ref: setup.ref ?? "HEAD",
        revision: resolve(setup.repository, setup.ref ?? "HEAD"), resolvedAt: now.toISOString(),
      };
      if (!validWslRepository(pin)) throw new Error("Invalid WSL setup repository revision");
      if (repositories[key]?.revision === pin.revision) continue;
      repositories[key] = pin;
      changed = true;
    }
  }
  return { lock: changed ? { ...lock, wslRepositories: repositories } : lock, changed };
}

export async function resolveWindowsModuleLockEntries(
  lock: WindowsLock,
  modules: Iterable<ResolvedPowerShellModule>,
  resolveVersion: WindowsModuleVersionResolver,
  now = new Date(),
  missingOnly = false
): Promise<{ lock: WindowsLock; resolutions: Omit<WindowsLockResolution, "source">[]; changed: boolean }> {
  const next = { ...lock, modules: { ...lock.modules } };
  const resolutions: Omit<WindowsLockResolution, "source">[] = [];
  let changed = false;
  for (const module of modules) {
    const key = windowsModuleKey(module);
    const previous = windowsModulePin(next, module);
    if (missingOnly && previous) {
      continue;
    }
    const version = await resolveVersion(module.name, module.repository, module.repositoryUri, !!module.prerelease);
    if (!powerShellModuleVersion.test(version) || (!module.prerelease && version.includes("-"))) {
      const source = module.repositoryUri ? ` (${module.repositoryUri})` : "";
      throw new Error(`PowerShell module "${module.name}" resolver for "${module.repository}"${source} did not return an allowed version: ${version}`);
    }
    const unchanged = previous?.version === version &&
      previous.repository.toLowerCase() === module.repository.toLowerCase();
    resolutions.push({
      id: module.name, version, previousVersion: previous?.version,
      status: unchanged ? "up-to-date" : previous ? "updated" : "new",
    });
    if (unchanged) continue;
    next.modules[key] = {
      repository: module.repository,
      ...(module.repositoryUri ? { repositoryUri: module.repositoryUri } : {}),
      version, resolvedAt: now.toISOString(),
    };
    changed = true;
  }
  return { lock: changed ? next : lock, resolutions, changed };
}

function cloneLockPackages(
  packages: Record<string, WindowsLockPackage>
): Record<string, WindowsLockPackage> {
  const out: Record<string, WindowsLockPackage> = {};
  for (const [id, entry] of Object.entries(packages)) {
    out[id] = { ...entry };
  }
  return out;
}

function windowsLockPath(configDir: string): string {
  return join(configDir, WINDOWS_LOCKFILE_NAME);
}

function validateWindowsLock(value: unknown): WindowsLock {
  if (!isObject(value)) {
    throw new Error(`${WINDOWS_LOCKFILE_NAME} must be a JSON object.`);
  }

  if (value.version !== WINDOWS_LOCK_VERSION) {
    throw new Error(
      `Unsupported ${WINDOWS_LOCKFILE_NAME} version ${String(value.version)}. ` +
      `Expected version ${WINDOWS_LOCK_VERSION}.`
    );
  }

  if (value.generatedAt !== undefined && typeof value.generatedAt !== "string") {
    throw new Error(`${WINDOWS_LOCKFILE_NAME} generatedAt must be a string.`);
  }

  if (!isObject(value.packages)) {
    throw new Error(`${WINDOWS_LOCKFILE_NAME} packages must be an object.`);
  }

  const packages: Record<string, WindowsLockPackage> = {};
  for (const [id, entry] of Object.entries(value.packages)) {
    if (!isObject(entry)) {
      throw new Error(`${WINDOWS_LOCKFILE_NAME} package "${id}" must be an object.`);
    }
    if (!isWinPackageSource(entry.source)) {
      throw new Error(`${WINDOWS_LOCKFILE_NAME} package "${id}" has an invalid source.`);
    }
    if (typeof entry.version !== "string" || entry.version.length === 0) {
      throw new Error(`${WINDOWS_LOCKFILE_NAME} package "${id}" version must be a string.`);
    }
    if (typeof entry.resolvedAt !== "string") {
      throw new Error(`${WINDOWS_LOCKFILE_NAME} package "${id}" resolvedAt must be a string.`);
    }
    packages[id] = {
      source: entry.source,
      version: entry.version,
      resolvedAt: entry.resolvedAt,
    };
  }

  const modules: Record<string, WindowsLockModule> = {};
  if (value.modules !== undefined) {
    if (!isObject(value.modules)) throw new Error(`${WINDOWS_LOCKFILE_NAME} modules must be an object.`);
    for (const [name, entry] of Object.entries(value.modules)) {
      if (!/^[a-z0-9][a-z0-9._-]*(?:@[a-z0-9][a-z0-9._-]*(?:\/[a-f0-9]{64})?)?$/i.test(name) || !isObject(entry) ||
          typeof entry.repository !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.repository) ||
          typeof entry.version !== "string" || !powerShellModuleVersion.test(entry.version) ||
          typeof entry.resolvedAt !== "string") {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} module "${name}" has an invalid repository, version, or resolvedAt.`);
      }
      if (entry.repositoryUri !== undefined &&
          (typeof entry.repositoryUri !== "string" || powerShellRepositoryUri(entry.repositoryUri) !== entry.repositoryUri)) {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} module "${name}" has an invalid repository URI.`);
      }
      const key = name.toLowerCase();
      if ((key.includes("@") || entry.repositoryUri !== undefined) &&
          key !== windowsModuleKey({
            name: name.split("@")[0], repository: entry.repository,
            ...(typeof entry.repositoryUri === "string" ? { repositoryUri: entry.repositoryUri } : {}),
          })) {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} module "${name}" does not match its repository identity.`);
      }
      if (modules[key]) throw new Error(`${WINDOWS_LOCKFILE_NAME} has duplicate module "${name}".`);
      modules[key] = {
        repository: entry.repository,
        ...(typeof entry.repositoryUri === "string" ? { repositoryUri: entry.repositoryUri } : {}),
        version: entry.version, resolvedAt: entry.resolvedAt,
      };
    }
  }

  const wslImages: Record<string, WindowsLockWslImage> = {};
  const fonts: Record<string, WindowsFontPin> = {};
  if (value.fonts !== undefined) {
    if (!isObject(value.fonts)) throw new Error(`${WINDOWS_LOCKFILE_NAME} fonts must be an object`);
    for (const [key, pin] of Object.entries(value.fonts)) {
      if (!/^[a-f0-9]{64}$/.test(key) || !validFontPin(pin)) throw new Error(`${WINDOWS_LOCKFILE_NAME} font pin "${key}" is invalid`);
      fonts[key] = { ...pin };
    }
  }
  if (value.wslImages !== undefined) {
    if (!isObject(value.wslImages)) throw new Error(`${WINDOWS_LOCKFILE_NAME} wslImages must be an object.`);
    for (const [key, image] of Object.entries(value.wslImages)) {
      if (!validWslImage(image) || key !== `nixos-wsl/${image.architecture}`) {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} WSL image "${key}" is invalid or is not an immutable official release asset.`);
      }
      wslImages[key] = { ...image };
    }
  }
  const wslRepositories: Record<string, WindowsLockWslRepository> = {};
  if (value.wslRepositories !== undefined) {
    if (!isObject(value.wslRepositories)) throw new Error(`${WINDOWS_LOCKFILE_NAME} wslRepositories must be an object`);
    for (const [key, pin] of Object.entries(value.wslRepositories)) {
      if (!validWslRepository(pin) || key !== wslRepositoryKey({ repository: pin.repository, ref: pin.ref, host: "validate", configDirectory: "." })) {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} WSL repository pin "${key}" is invalid`);
      }
      wslRepositories[key] = { ...pin };
    }
  }
  return {
    version: WINDOWS_LOCK_VERSION,
    packages,
    ...(value.fonts === undefined ? {} : { fonts }),
    ...(value.modules === undefined ? {} : { modules }),
    ...(value.wslImages === undefined ? {} : { wslImages }),
    ...(value.wslRepositories === undefined ? {} : { wslRepositories }),
  };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isWinPackageSource(value: unknown): value is WinPackage["source"] {
  return value === "winget" || value === "msstore";
}

function comparePackageIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
