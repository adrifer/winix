// winix apply — generate .winix/out/ from config

import { isAbsolute, join, dirname, relative } from "node:path";
import { mkdir, writeFile, readFile, copyFile, cp, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix, type NixOutput, type RawModuleCopy } from "../../backends/nix/index.ts";
import { generateWindows, type WindowsOutput } from "../../backends/windows/index.ts";
import { platformForEvaluatedHost, type ActivationPlatform } from "../activation.ts";

interface ApplyOptions {
  host?: string;
  dry: boolean;
  diff: boolean;
}

export interface ApplyResult {
  configDir: string;
  outDir: string;
  hostNames: string[];
  hostPlatforms: Map<string, ActivationPlatform>;
}

export async function applyWorkspace(
  cwd: string,
  opts: ApplyOptions
): Promise<ApplyResult> {
  const { workspace, configDir } = await loadWorkspace(cwd);
  let evaluated = evaluate(workspace);

  if (opts.host) {
    evaluated = evaluated.filter((h) => h.name === opts.host);
    if (evaluated.length === 0) {
      const all = evaluate(workspace);
      throw new Error(
        `Host "${opts.host}" not found. Available hosts:\n` +
        all.map((h) => `  - ${h.name}`).join("\n")
      );
    }
  }

  const hostPlatforms = platformsForHosts(evaluated);
  const nixHosts = evaluated.filter((host) => hostPlatforms.get(host.name) !== "windows");
  const windowsHosts = evaluated.filter((host) => hostPlatforms.get(host.name) === "windows");
  const nixOutput = nixHosts.length > 0 ? generateNix(workspace, nixHosts) : undefined;
  const windowsOutput = windowsHosts.length > 0 ? generateWindows(windowsHosts) : undefined;
  printWarnings(nixOutput?.warnings ?? []);
  printWarnings(windowsOutput?.warnings ?? []);
  const outDir = join(configDir, ".winix", "out");

  if (opts.dry) {
    printDryOutput(nixOutput, windowsOutput);
    return resultFor(configDir, outDir, evaluated);
  }

  if (opts.diff) {
    await showDiff(configDir, outDir, nixOutput, windowsOutput);
    return resultFor(configDir, outDir, evaluated);
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
  return resultFor(configDir, outDir, evaluated);
}

export async function apply(cwd: string, opts: ApplyOptions): Promise<void> {
  await applyWorkspace(cwd, opts);
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
    try {
      const existing = await readFile(path, "utf-8");
      if (existing !== newContent) {
        hasDiff = true;
        console.log(`\n--- ${relative(process.cwd(), path)}`);
        console.log(`+++ ${relative(process.cwd(), path)} (new)`);
        console.log("(content differs)");
      }
    } catch {
      hasDiff = true;
      console.log(`\n+++ ${relative(process.cwd(), path)} (new file)`);
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
        console.log(`\n--- ${relative(process.cwd(), target)}`);
        console.log(`+++ ${relative(process.cwd(), target)} (new)`);
        console.log("(content differs)");
      }
    } catch {
      hasDiff = true;
      console.log(`\n+++ ${relative(process.cwd(), target)} (new file)`);
    }
  }

  if (!hasDiff) {
    console.log("No changes. Output is up to date.");
  }
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
