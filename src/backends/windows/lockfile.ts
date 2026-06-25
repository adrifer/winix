import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { EvaluatedHost } from "../../evaluator/index.ts";
import type { WinPackage, WinPackageSource, WindowsOptions } from "../../types/index.ts";

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
    if (!isWindowsHost(host)) continue;
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

  return JSON.stringify(sorted, null, 2) + "\n";
}

function windowsLockPath(configDir: string): string {
  return join(configDir, WINDOWS_LOCKFILE_NAME);
}

function isWindowsHost(host: { windows?: Record<string, unknown> }): boolean {
  return Boolean(host.windows && Object.keys(host.windows).length > 0);
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

  return {
    version: WINDOWS_LOCK_VERSION,
    generatedAt: value.generatedAt,
    packages,
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
