import { join } from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { evaluate } from "../../evaluator/index.ts";
import {
  emptyWindowsLock,
  readWindowsLock,
  reconcileInlinePins,
  resolveWindowsLockEntries,
  windowsLockChanged,
  writeWindowsLock,
  type WindowsLock,
  type WindowsPackageVersionResolver,
} from "../../backends/windows/lockfile.ts";
import { isWindowsHost } from "../../backends/windows/index.ts";
import {
  assertWingetResolutionSupported,
  resolveWingetVersion,
} from "../../backends/windows/resolver.ts";
import type { WinPackage, WindowsOptions } from "../../types/index.ts";
import { platformForEvaluatedHost } from "../activation.ts";
import { loadWorkspace } from "../loader.ts";
import { runCommand } from "../run.ts";
import { applyWorkspace } from "./apply.ts";

interface UpdateOptions {
  inputs: string[];
  dry: boolean;
  windows?: boolean;
  resolveWindowsPackageVersion?: WindowsPackageVersionResolver;
}

export async function update(cwd: string, opts: UpdateOptions): Promise<void> {
  if (opts.windows) {
    await updateWindowsLock(cwd, opts);
    return;
  }

  if (!opts.dry) {
    assertUpdateSupported();
  }

  // `winix update` resolves the Nix flake lock. A Windows-only workspace has
  // no flake.nix, so there is nothing to update; fail clearly instead of
  // letting `nix flake update` error out generically.
  const { workspace } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace);
  const hasNixHost = evaluated.some((host) => platformForEvaluatedHost(host) !== "windows");
  if (!hasNixHost) {
    throw new Error(
      "`winix update` updates the Nix flake lock, but this workspace has no " +
      "NixOS or nix-darwin hosts (Windows packages are pinned via " +
      "`winix-windows.lock`, resolved by a future `winix` milestone). " +
      "Nothing to update."
    );
  }

  const result = await applyWorkspace(cwd, { dry: false, diff: false });

  const updateDir = await mkdtemp(join(tmpdir(), "winix-update-"));
  await cp(result.outDir, updateDir, { recursive: true });

  const args = [
    "--extra-experimental-features",
    "nix-command",
    "--extra-experimental-features",
    "flakes",
    "flake",
    "update",
    ...opts.inputs,
  ];

  try {
    await runCommand("nix", args, { cwd: updateDir, dry: opts.dry });
    if (opts.dry) return;

    const outLock = join(updateDir, "flake.lock");
    const rootLock = join(result.configDir, "flake.lock");
    const tmpLock = join(result.configDir, ".flake.lock.tmp");
    await writeFile(tmpLock, await readFile(outLock));
    await rename(tmpLock, rootLock);
    console.log("✓ Updated flake.lock");
  } finally {
    await rm(updateDir, { recursive: true, force: true });
  }
}

async function updateWindowsLock(cwd: string, opts: UpdateOptions): Promise<void> {
  const { workspace, configDir } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace);
  const windowsHosts = evaluated.filter(isWindowsHost);
  if (windowsHosts.length === 0) {
    throw new Error("`winix update --windows` found no Windows hosts in this workspace.");
  }
  if (!opts.resolveWindowsPackageVersion) {
    assertWingetResolutionSupported();
  }

  const now = new Date();
  const originalLock = readWindowsLock(configDir) ?? emptyWindowsLock(now);
  const reconciled = reconcileInlinePins(originalLock, windowsHosts, now);
  let lock: WindowsLock = {
    ...reconciled,
    packages: { ...reconciled.packages },
  };
  const pinned = collectInlinePinnedPackages(windowsHosts);
  const floating = collectFloatingPackages(windowsHosts, pinned);
  const selected = selectPackagesForUpdate(floating, pinned, opts.inputs);
  const resolveVersion = opts.resolveWindowsPackageVersion ?? resolveWingetVersion;
  let changed = windowsLockChanged(originalLock, reconciled);

  console.log(`Updating winix-windows.lock for ${windowsHosts.length} Windows host(s).`);

  for (const [id, pkg] of pinned) {
    const entry = lock.packages[id];
    console.log(`  pinned  ${id} ${pkg.source} ${entry?.version ?? pkg.version}`);
  }

  if (selected.size === 0) {
    console.log("  no floating Windows packages to resolve");
  }

  const resolved = resolveWindowsLockEntries(lock, selected.values(), resolveVersion, now);
  lock = resolved.lock;
  changed = changed || resolved.changed;

  for (const resolution of resolved.resolutions) {
    if (resolution.status === "up-to-date") {
      console.log(`  up to date  ${resolution.id} ${resolution.source} ${resolution.version}`);
    } else if (resolution.status === "updated") {
      console.log(
        `  resolved  ${resolution.id} ${resolution.source} ` +
        `${resolution.previousVersion} -> ${resolution.version}`
      );
    } else {
      console.log(
        `  resolved  ${resolution.id} ${resolution.source} ${resolution.version} (new)`
      );
    }
  }

  if (!changed) {
    console.log("winix-windows.lock is already up to date.");
    return;
  }

  if (opts.dry) {
    console.log("Dry run: winix-windows.lock would be updated.");
    return;
  }

  writeWindowsLock(configDir, lock);
  console.log("✓ Updated winix-windows.lock");
}

function collectInlinePinnedPackages(
  windowsHosts: ReturnType<typeof evaluate>
): Map<string, WinPackage> {
  const pinned = new Map<string, WinPackage>();
  for (const host of windowsHosts) {
    const win = host.windows as WindowsOptions;
    for (const pkg of Object.values(win.packages ?? {})) {
      if (pkg.version !== undefined) {
        pinned.set(pkg.id, pkg);
      }
    }
  }
  return pinned;
}

function collectFloatingPackages(
  windowsHosts: ReturnType<typeof evaluate>,
  pinned: Map<string, WinPackage>
): Map<string, WinPackage> {
  const floating = new Map<string, WinPackage>();

  for (const host of windowsHosts) {
    const win = host.windows as WindowsOptions;
    for (const pkg of Object.values(win.packages ?? {})) {
      if (pkg.version !== undefined) continue;

      const pinnedPkg = pinned.get(pkg.id);
      if (pinnedPkg) {
        if (pinnedPkg.source !== pkg.source) {
          throw new Error(
            `Windows package "${pkg.id}" is pinned with source "${pinnedPkg.source}" ` +
            `but also declared floating with source "${pkg.source}". Use one source per package id.`
          );
        }
        continue;
      }

      const existing = floating.get(pkg.id);
      if (existing && existing.source !== pkg.source) {
        throw new Error(
          `Windows package "${pkg.id}" is declared with multiple sources. ` +
          `Use one source per package id.`
        );
      }
      floating.set(pkg.id, pkg);
    }
  }

  return floating;
}

function selectPackagesForUpdate(
  floating: Map<string, WinPackage>,
  pinned: Map<string, WinPackage>,
  inputs: string[]
): Map<string, WinPackage> {
  if (inputs.length === 0) return floating;

  const selected = new Map<string, WinPackage>();
  for (const id of inputs) {
    const pkg = floating.get(id);
    if (pkg) {
      selected.set(id, pkg);
      continue;
    }
    if (!pinned.has(id)) {
      throw new Error(`Windows package "${id}" is not declared in this workspace.`);
    }
  }
  return selected;
}

export function assertUpdateSupported(
  osPlatform: NodeJS.Platform = process.platform
): void {
  if (osPlatform !== "win32") return;

  throw new Error(
    "`winix update` is not supported from native Windows yet because it requires " +
    "the Nix CLI. Run it from WSL, Linux, or macOS."
  );
}
