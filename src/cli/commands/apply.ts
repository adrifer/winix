// winix apply — generate .winix/out/ from config

import { isAbsolute, join, dirname, relative } from "node:path";
import { mkdir, writeFile, readFile, copyFile, cp, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix, type NixOutput, type RawModuleCopy } from "../../backends/nix/index.ts";
import { generateWindows, validateWindowsWslResources, type WindowsOutput } from "../../backends/windows/index.ts";
import {
  emptyWindowsLock,
  readWindowsLock,
  reconcileInlinePins,
  resolveMissingWindowsLockEntries,
  collectWindowsModules,
  resolveWindowsModuleLockEntries,
  hasWindowsWslDistros,
  resolveWindowsWslImages,
  resolveWindowsWslRepositories,
  windowsLockChanged,
  windowsLockPinGaps,
  writeWindowsLock,
  type WindowsLock,
  type WindowsPackageVersionResolver,
  type WindowsModuleVersionResolver,
} from "../../backends/windows/lockfile.ts";
import { resolveWingetVersion } from "../../backends/windows/resolver.ts";
import { resolvePowerShellModuleVersion } from "../../backends/windows/powershell.ts";
import { resolveNixosWslImage, type WindowsWslImageResolver } from "../../backends/windows/wsl.ts";
import { resolveWslRepository, type WindowsWslRepositoryResolver } from "../../backends/windows/wsl-setup.ts";
import { validateWindowsWslSetupTargets } from "../../backends/windows/wsl-setup-runtime.ts";
import { platformForEvaluatedHost, type ActivationPlatform } from "../activation.ts";
import { collectFontSources, resolveWindowsFonts, resolveFontSource, type WindowsFontResolver } from "../../backends/windows/fonts.ts";
import { unifiedDiff } from "../diff.ts";
import * as progress from "../progress.ts";
import type { WorkspaceDef } from "../../core/types.ts";

interface ApplyOptions {
  resolveWindowsFont?: WindowsFontResolver;
  /** Activation-only overrides; the committed lock and inline declarations remain unchanged. */
  /**
   * Activation-time package versions keyed by package id. `null` means the
   * package is installed with a non-comparable version (e.g. winget reports
   * "Unknown"): emit it presence-only so activation does not reinstall it.
   */
  windowsPackageVersions?: (hosts: ReturnType<typeof evaluate>, lock: WindowsLock) => Promise<Record<string, string | null>>;
  host?: string;
  dry: boolean;
  diff: boolean;
  /** Dry runs print the generated files unless false (switch --dry prints a plan instead). */
  print?: boolean;
  /** One "Generated" line and no next steps (switch prints its own progress). */
  compact?: boolean;
  /** An already loaded and evaluated workspace (switch evaluates it once). */
  loaded?: { workspace: WorkspaceDef; configDir: string; hosts: ReturnType<typeof evaluate> };
  /** Only generate Nix hosts (skip Windows lock resolution and bundles). */
  nixOnly?: boolean;
  offline?: boolean;
  locked?: boolean;
  windowsLockDry?: boolean;
  resolveWindowsPackageVersion?: WindowsPackageVersionResolver;
  resolveWindowsModuleVersion?: WindowsModuleVersionResolver;
  resolveWindowsWslImage?: WindowsWslImageResolver;
  resolveWindowsWslRepository?: WindowsWslRepositoryResolver;
}

export interface ApplyResult {
  configDir: string;
  outDir: string;
  hostNames: string[];
  hostPlatforms: Map<string, ActivationPlatform>;
  windowsLock?: WindowsLock;
  windowsOutput?: WindowsOutput;
}

/** Network policy for winix-windows.lock resolution. */
export interface LockPolicy {
  /** Never resolve online; fail when the lock lacks a pin. */
  offline?: boolean;
  /** Fail when the lock would change at all (CI, reproducible switches). */
  locked?: boolean;
}

export async function applyWorkspace(
  cwd: string,
  opts: ApplyOptions
): Promise<ApplyResult> {
  const { workspace, configDir } = opts.loaded ?? await loadWorkspace(cwd);
  const allHosts = opts.loaded?.hosts ?? evaluate(workspace, { configDir });
  let evaluated = allHosts;

  if (opts.host) {
    evaluated = evaluated.filter((h) => h.name === opts.host);
    if (evaluated.length === 0) {
      throw new Error(
        `Host "${opts.host}" not found. Available hosts:\n` +
        allHosts.map((h) => `  - ${h.name}`).join("\n")
      );
    }
  }

  if (opts.nixOnly) {
    evaluated = evaluated.filter((h) => platformForEvaluatedHost(h) !== "windows");
  }

  const hostPlatforms = platformsForHosts(evaluated);
  const nixHosts = evaluated.filter((host) => hostPlatforms.get(host.name) !== "windows");
  const windowsHosts = evaluated.filter((host) => hostPlatforms.get(host.name) === "windows");
  for (const host of windowsHosts) validateWindowsWslResources(host.windows);
  validateWindowsWslSetupTargets(workspace, allHosts, windowsHosts);
  if (opts.compact && windowsHosts.length > 0) progress.spin("Checking winix-windows.lock");
  const windowsLock = windowsHosts.length > 0
    ? await prepareWindowsLock(
      configDir,
      windowsHosts,
      opts.dry || opts.windowsLockDry === true,
      opts.resolveWindowsPackageVersion ?? resolveWingetVersion,
      opts.resolveWindowsModuleVersion ?? resolvePowerShellModuleVersion,
      opts.resolveWindowsWslImage ?? resolveNixosWslImage,
      opts.resolveWindowsWslRepository ?? resolveWslRepository,
      opts.resolveWindowsFont ?? resolveFontSource,
      { offline: opts.offline, locked: opts.locked },
    )
    : undefined;
  const nixOutput = nixHosts.length > 0 ? generateNix(workspace, nixHosts) : undefined;
  const runtimeVersions = windowsLock && opts.windowsPackageVersions
    ? await opts.windowsPackageVersions(windowsHosts, windowsLock) : {};
  const presenceOnlyPackages = new Set(
    Object.entries(runtimeVersions).filter(([, version]) => version === null).map(([id]) => id),
  );
  const activationLock = windowsLock ? {
    ...windowsLock,
    packages: Object.fromEntries(Object.entries(windowsLock.packages).map(([id, pin]) => {
      const version = runtimeVersions[id];
      return [id, typeof version === "string" ? { ...pin, version } : pin];
    })),
  } : undefined;
  const windowsOutput = windowsHosts.length > 0
    ? generateWindows(windowsHosts, activationLock, configDir, { presenceOnlyPackages })
    : undefined;
  printWarnings(nixOutput?.warnings ?? []);
  printWarnings(windowsOutput?.warnings ?? []);
  const outDir = join(configDir, ".winix", "out");

  if (opts.dry) {
    if (opts.print !== false) {
      printDryOutput(nixOutput, windowsOutput);
      if (windowsOutput) console.warn("\nTip: winix switch --dry --host <name> shows what would change on this machine instead of the generated files.");
    }
    return { ...resultFor(configDir, outDir, evaluated), windowsLock, windowsOutput };
  }

  if (opts.diff) {
    await showDiff(configDir, outDir, nixOutput, windowsOutput);
    return { ...resultFor(configDir, outDir, evaluated), windowsLock, windowsOutput };
  }

  if (nixOutput) {
    await mkdir(join(outDir, "hosts"), { recursive: true });
    await writeFile(join(outDir, "flake.nix"), nixOutput["flake.nix"]);

    for (const [name, content] of Object.entries(nixOutput.hosts)) {
      await writeFile(join(outDir, "hosts", name), content);
    }

    await copyRawModules(configDir, outDir, nixOutput.rawModules);

    // Copy flake.lock from project root if it exists.
    const rootLock = join(cwd, "flake.lock");
    const outLock = join(outDir, "flake.lock");
    if (existsSync(rootLock)) {
      await rm(outLock, { force: true });
      await copyFile(rootLock, outLock);
    }
  }

  if (windowsOutput) {
    for (const [hostName, bundle] of Object.entries(windowsOutput.hosts)) {
      const hostDir = join(outDir, hostName);
      await mkdir(hostDir, { recursive: true });
      for (const [fileName, content] of Object.entries(bundle)) {
        await writeFile(join(hostDir, fileName), content);
      }
    }
  }

  if (opts.compact) {
    const files = [
      ...Object.keys(nixOutput?.hosts ?? {}).map((name) => `hosts/${name}`),
      ...Object.entries(windowsOutput?.hosts ?? {}).flatMap(([hostName, bundle]) => Object.keys(bundle).map((file) => `${hostName}/${file}`)),
    ];
    console.log(files.length === 1 ? `✓ Generated .winix/out/${files[0]}` : `✓ Generated ${evaluated.length} host(s) in .winix/out/`);
    return { ...resultFor(configDir, outDir, evaluated), windowsLock, windowsOutput };
  }
  console.log(`✓ Generated ${evaluated.length} host(s) in .winix/out/`);
  for (const name of Object.keys(nixOutput?.hosts ?? {})) {
    console.log(`  → hosts/${name}`);
  }
  for (const [hostName, bundle] of Object.entries(windowsOutput?.hosts ?? {})) {
    for (const fileName of Object.keys(bundle)) {
      console.log(`  → ${hostName}/${fileName}`);
    }
  }
  printNextSteps(cwd, outDir, evaluated);
  return { ...resultFor(configDir, outDir, evaluated), windowsLock, windowsOutput };
}

export async function apply(cwd: string, opts: ApplyOptions): Promise<void> {
  await applyWorkspace(cwd, opts);
}

async function prepareWindowsLock(
  configDir: string,
  windowsHosts: ReturnType<typeof evaluate>,
  dry: boolean,
  resolveVersion: WindowsPackageVersionResolver,
  resolveModuleVersion: WindowsModuleVersionResolver,
  resolveWslImage: WindowsWslImageResolver,
  resolveRepository: WindowsWslRepositoryResolver,
  resolveFont: WindowsFontResolver,
  policy: LockPolicy = {},
): Promise<WindowsLock> {
  const now = new Date();
  const lock = readWindowsLock(configDir) ?? emptyWindowsLock(now);
  if (policy.offline || policy.locked) {
    const flag = policy.locked ? "--locked" : "--offline";
    const gaps = windowsLockPinGaps(lock, windowsHosts);
    if (gaps.length > 0) {
      const labels = [...new Set(gaps.map((gap) => gap.label))];
      const selectors = [...new Set(gaps.map((gap) => gap.selector))];
      throw new Error(`${flag}: winix-windows.lock is missing ${labels.length} pin(s): ${labels.join(", ")}. ` +
        `Resolve them with network access (winix update --windows ${selectors.join(" ")}), then commit winix-windows.lock.`);
    }
  }
  const reconciled = reconcileInlinePins(lock, windowsHosts, now);
  if (policy.locked && windowsLockChanged(lock, reconciled)) {
    throw new Error("--locked: inline Windows package versions differ from winix-windows.lock. " +
      "Run winix apply without --locked to record them, then commit winix-windows.lock.");
  }
  const resolved = resolveMissingWindowsLockEntries(
    reconciled,
    windowsHosts,
    resolveVersion,
    now
  );
  const modules = await resolveWindowsModuleLockEntries(
    resolved.lock, collectWindowsModules(windowsHosts).values(), resolveModuleVersion, now, true
  );
  const images = hasWindowsWslDistros(windowsHosts)
    ? await resolveWindowsWslImages(modules.lock, resolveWslImage, now, true)
    : { lock: modules.lock, changed: false };
  const repositories = resolveWindowsWslRepositories(images.lock, windowsHosts, resolveRepository, now, true);
  const fonts = await resolveWindowsFonts(repositories.lock, collectFontSources(windowsHosts).values(), resolveFont, now, true);
  const changed = windowsLockChanged(lock, fonts.lock);
  if (!changed) return fonts.lock;

  if (dry) {
    if (windowsLockChanged(lock, resolved.lock)) printWindowsLockDryRun(resolved.resolutions);
    for (const entry of modules.resolutions) console.warn(`Would pin PowerShell module ${entry.id} ${entry.version} in winix-windows.lock`);
    if (images.changed) console.warn("Would pin verified NixOS-WSL images for x64/arm64 in winix-windows.lock");
    if (repositories.changed) console.warn("Would pin WSL setup repository commits in winix-windows.lock");
    if (fonts.changed) console.warn("Would pin verified font sources in winix-windows.lock");
    return fonts.lock;
  }

  writeWindowsLock(configDir, fonts.lock);
  if (windowsLockChanged(lock, resolved.lock)) printWindowsLockUpdate(resolved.resolutions);
  for (const entry of modules.resolutions) console.log(`✓ Pinned PowerShell module ${entry.id} ${entry.version} in winix-windows.lock`);
  if (images.changed) console.log("✓ Pinned verified NixOS-WSL images for x64/arm64 in winix-windows.lock");
  if (repositories.changed) console.log("✓ Pinned WSL setup repository commits in winix-windows.lock");
  if (fonts.changed) console.log("✓ Pinned verified font sources in winix-windows.lock");
  return fonts.lock;
}

function printWindowsLockDryRun(resolutions: { id: string; source: string; version: string }[]): void {
  if (resolutions.length === 0) {
    console.warn("Would update winix-windows.lock with inline Windows package pins.");
    return;
  }

  console.warn("Would update winix-windows.lock with resolved Windows package versions:");
  for (const resolution of resolutions) {
    console.warn(`  ${resolution.id} ${resolution.source} ${resolution.version}`);
  }
}

function printWindowsLockUpdate(resolutions: { id: string; source: string; version: string }[]): void {
  if (resolutions.length === 0) {
    console.log("✓ Updated winix-windows.lock with inline Windows package pins");
    return;
  }

  console.log("✓ Updated winix-windows.lock with resolved Windows package versions");
  for (const resolution of resolutions) {
    console.log(`  → ${resolution.id} ${resolution.source} ${resolution.version}`);
  }
}

function resultFor(
  configDir: string,
  outDir: string,
  evaluated: ReturnType<typeof evaluate>
): ApplyResult {
  return {
    configDir,
    outDir,
    hostNames: evaluated.map((host) => host.name),
    hostPlatforms: platformsForHosts(evaluated),
  };
}

function printNextSteps(
  _cwd: string,
  _outDir: string,
  evaluated: ReturnType<typeof evaluate>
): void {
  if (evaluated.length === 1) {
    const [host] = evaluated;
    const suffix =
      platformForEvaluatedHost(host) === "windows" ? ` --host ${host.name}` : "";
    console.log(`\nNext: winix switch${suffix}`);
    return;
  }

  console.log("\nNext:");
  for (const host of evaluated) {
    console.log(`  winix switch --host ${host.name}`);
  }
}

function printWarnings(warnings: string[]): void {
  for (const warning of warnings) {
    console.warn(`Warning: ${warning}`);
  }
}

function platformsForHosts(
  evaluated: ReturnType<typeof evaluate>
): Map<string, ActivationPlatform> {
  return new Map(evaluated.map((host) => [host.name, platformForEvaluatedHost(host)]));
}

function printDryOutput(
  nixOutput: NixOutput | undefined,
  windowsOutput: WindowsOutput | undefined
): void {
  if (nixOutput) {
    console.log("=== .winix/out/flake.nix ===");
    console.log(nixOutput["flake.nix"]);
    for (const [name, content] of Object.entries(nixOutput.hosts)) {
      console.log(`\n=== .winix/out/hosts/${name} ===`);
      console.log(content);
    }
  }

  for (const [hostName, bundle] of Object.entries(windowsOutput?.hosts ?? {})) {
    for (const [fileName, content] of Object.entries(bundle)) {
      console.log(`\n=== .winix/out/${hostName}/${fileName} ===`);
      console.log(content);
    }
  }
}

async function showDiff(
  configDir: string,
  outDir: string,
  nixOutput: NixOutput | undefined,
  windowsOutput: WindowsOutput | undefined
): Promise<void> {
  const files: [string, string][] = [];
  if (nixOutput) {
    files.push(
      [join(outDir, "flake.nix"), nixOutput["flake.nix"]],
      ...Object.entries(nixOutput.hosts).map(([name, content]) => [join(outDir, "hosts", name), content] as [string, string])
    );
  }
  for (const [hostName, bundle] of Object.entries(windowsOutput?.hosts ?? {})) {
    for (const [fileName, content] of Object.entries(bundle)) {
      files.push([join(outDir, hostName, fileName), content]);
    }
  }

  let hasDiff = false;
  for (const [path, newContent] of files) {
    let existing: string;
    try {
      existing = await readFile(path, "utf-8");
    } catch {
      hasDiff = true;
      console.log(`\n+++ ${displayPath(path)} (new file, ${lineCount(newContent)} lines)`);
      continue;
    }
    const diff = unifiedDiff(existing, newContent, `${displayPath(path)} (current)`, `${displayPath(path)} (generated)`);
    if (diff) {
      hasDiff = true;
      console.log("");
      process.stdout.write(diff);
    }
  }

  for (const rawModule of nixOutput?.rawModules ?? []) {
    const source = await resolveRawModuleSource(configDir, rawModule.path);
    const target = rawModuleTarget(outDir, rawModule.path);
    const sourceContent = await readFile(source);

    try {
      const existing = await readFile(target);
      if (!sourceContent.equals(existing)) {
        hasDiff = true;
        console.log("");
        process.stdout.write(unifiedDiff(existing.toString("utf8"), sourceContent.toString("utf8"),
          `${displayPath(target)} (current)`, `${displayPath(target)} (generated)`));
      }
    } catch {
      hasDiff = true;
      console.log(`\n+++ ${displayPath(target)} (new file)`);
    }
  }

  if (!hasDiff) {
    console.log("No changes. Output is up to date.");
  }
}

function displayPath(path: string): string {
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

function lineCount(text: string): number {
  return text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);
}

async function copyRawModules(
  configDir: string,
  outDir: string,
  rawModules: RawModuleCopy[]
): Promise<void> {
  if (rawModules.length === 0) return;

  const rawModulesDir = join(outDir, "raw-modules");
  await rm(rawModulesDir, { recursive: true, force: true });
  const copiedRoots = new Set<string>();

  for (const rawModule of rawModules) {
    const source = await resolveRawModuleSource(configDir, rawModule.path);
    const segments = rawModule.path.split("/");
    if (segments.length > 1) {
      const root = segments[0];
      if (!copiedRoots.has(root)) {
        const sourceRoot = join(configDir, root);
        const realConfigDir = await realpath(configDir);
        const realSourceRoot = await realpath(sourceRoot);
        if (!isPathInside(realConfigDir, realSourceRoot)) {
          throw new Error(`rawModule("${rawModule.path}") resolves outside the workspace`);
        }
        await cp(sourceRoot, join(rawModulesDir, root), { recursive: true, force: true });
        copiedRoots.add(root);
      }
      continue;
    }

    const target = rawModuleTarget(outDir, rawModule.path);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(source, target);
  }
}

async function resolveRawModuleSource(
  configDir: string,
  rawModulePath: string
): Promise<string> {
  const realConfigDir = await realpath(configDir);
  const expectedPath = join(configDir, rawModulePath);
  let source: string;
  try {
    source = await realpath(expectedPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(
        `rawModule("${rawModulePath}") file not found. Expected at: ${expectedPath}`
      );
    }
    throw err;
  }

  if (!isPathInside(realConfigDir, source)) {
    throw new Error(`rawModule("${rawModulePath}") resolves outside the workspace`);
  }

  return source;
}

function rawModuleTarget(outDir: string, rawModulePath: string): string {
  return join(outDir, "raw-modules", ...rawModulePath.split("/"));
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}
