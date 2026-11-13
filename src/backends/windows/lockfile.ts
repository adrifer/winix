import { existsSync, readFileSync, writeFileSync } from "node:fs";
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
  resolvePowerShellModule, powerShellRepositoryUri, type ResolvedPowerShellModule,
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
  generatedAt: string;
  packages: Record<string, WindowsLockPackage>;
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

export type WindowsModuleVersionResolver = (name: string, repository: string, repositoryUri?: string) => string;

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
      pin?.repositoryUri !== module.repositoryUri) return undefined;
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
    generatedAt: changed ? resolvedAt : lock.generatedAt,
    packages,
  };
}

export function emptyWindowsLock(now = new Date()): WindowsLock {
  return {
    version: WINDOWS_LOCK_VERSION,
    generatedAt: now.toISOString(),
    packages: {},
  };
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
      if (pkg.version !== undefined || lock.packages[pkg.id] !== undefined) continue;

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
    generatedAt: lock.generatedAt,
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
    next.generatedAt = resolvedAt;
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
    generatedAt: lock.generatedAt,
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
    for (const resource of win.dsc ?? []) {
      if (resource.winix?.kind !== "powershell-module") continue;
      const module = resolvePowerShellModule(win, resource.winix.module);
      const key = windowsModuleKey(module);
      const existing = hostModules.get(module.name.toLowerCase());
      if (existing && existing !== key) {
        throw new Error(`PowerShell module "${module.name}" is declared with conflicting repositories.`);
      }
      hostModules.set(module.name.toLowerCase(), key);
      modules.set(key, module);
    }
  }
  return modules;
}

export function hasWindowsWslDistros(hosts: EvaluatedHost[]): boolean {
  return hosts.some((host) => (host.windows as WindowsOptions).dsc?.some(
    (resource) => resource.winix?.kind === "wsl-distro"
  ));
}

export function resolveWindowsWslImages(
  lock: WindowsLock, resolve: WindowsWslImageResolver, now = new Date(), missingOnly = false
): { lock: WindowsLock; changed: boolean } {
  const images = { ...lock.wslImages };
  let changed = false;
  for (const architecture of ["x64", "arm64"] as const) {
    const key = `nixos-wsl/${architecture}`;
    if (missingOnly && images[key]) continue;
    const image = { ...resolve(architecture), resolvedAt: now.toISOString() };
    if (!validWslImage(image) || image.architecture !== architecture) {
      throw new Error(`Invalid NixOS-WSL image resolution for ${architecture}`);
    }
    const previous = images[key];
    if (previous?.version === image.version && previous.url === image.url && previous.sha256 === image.sha256) continue;
    images[key] = image;
    changed = true;
  }
  return {
    lock: changed ? { ...lock, generatedAt: now.toISOString(), wslImages: images } : lock,
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
  return { lock: changed ? { ...lock, generatedAt: now.toISOString(), wslRepositories: repositories } : lock, changed };
}

export function resolveWindowsModuleLockEntries(
  lock: WindowsLock,
  modules: Iterable<ResolvedPowerShellModule>,
  resolveVersion: WindowsModuleVersionResolver,
  now = new Date(),
  missingOnly = false
): { lock: WindowsLock; resolutions: Omit<WindowsLockResolution, "source">[]; changed: boolean } {
  const next = { ...lock, modules: { ...lock.modules } };
  const resolutions: Omit<WindowsLockResolution, "source">[] = [];
  let changed = false;
  for (const module of modules) {
    const key = windowsModuleKey(module);
    const previous = windowsModulePin(next, module);
    if (missingOnly && previous) {
      continue;
    }
    const version = resolveVersion(module.name, module.repository, module.repositoryUri);
    if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
      throw new Error(`PowerShell module "${module.name}" resolver did not return a stable version: ${version}`);
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
    next.generatedAt = now.toISOString();
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

  if (typeof value.generatedAt !== "string") {
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
          typeof entry.version !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(entry.version) ||
          typeof entry.resolvedAt !== "string") {
        throw new Error(`${WINDOWS_LOCKFILE_NAME} module "${name}" has an invalid repository, stable version, or resolvedAt.`);
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
    generatedAt: value.generatedAt,
    packages,
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
