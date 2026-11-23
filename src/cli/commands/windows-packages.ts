// winix windows search / winix windows import — read-only winget helpers for
// authoring Windows hosts. Neither command installs, removes or writes config.

import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { platformForEvaluatedHost } from "../activation.ts";
import { selectHost } from "./switch.ts";
import type { WindowsOptions, WinPackageSource } from "../../types/index.ts";

export type WingetRunner = (args: string[]) => string;

const runWinget: WingetRunner = (args) =>
  execFileSync("winget", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });

function assertWindows(command: string): void {
  if (process.platform !== "win32") {
    throw new Error(`winix ${command} uses winget and is only available on Windows.`);
  }
}

/** `winix windows search <query>`: winget search, plus how to declare a result. */
export function packageSearch(query: string, run: WingetRunner = runWinget, print = console.log): void {
  if (!query || !query.trim()) throw new Error("Usage: winix windows search <query>");
  if (run === runWinget) assertWindows("windows search");
  const output = run(["search", "--query", query, "--source", "winget", "--accept-source-agreements", "--disable-interactivity"]);
  print(output.trimEnd());
  print('\nDeclare a result with windows.package("<Id>"); add { version: "any" } for apps that update themselves.');
}

export interface InstalledPackage { id: string; source: WinPackageSource }

/** Parse `winget export` JSON into winget/msstore package ids. */
export function parseWingetExport(json: string): InstalledPackage[] {
  const data = JSON.parse(json) as { Sources?: { SourceDetails?: { Name?: string }; Packages?: { PackageIdentifier?: string }[] }[] };
  const packages: InstalledPackage[] = [];
  for (const source of data.Sources ?? []) {
    const name = source.SourceDetails?.Name?.toLowerCase();
    if (name !== "winget" && name !== "msstore") continue;
    for (const pkg of source.Packages ?? []) {
      if (typeof pkg.PackageIdentifier === "string" && pkg.PackageIdentifier) {
        packages.push({ id: pkg.PackageIdentifier, source: name });
      }
    }
  }
  return packages;
}

// Shared runtimes that other installers pull in; listing them as declarations is noise.
const RUNTIME_PACKAGE = /^Microsoft\.(?:VCRedist|VCLibs|UI\.Xaml|WindowsAppRuntime|DotNet\.(?:Runtime|DesktopRuntime|AspNetCore|HostingBundle)|DirectX|GameInput)(?:\.|$)/i;

export function isRuntimePackage(id: string): boolean {
  return RUNTIME_PACKAGE.test(id);
}

export function packageDeclaration(pkg: InstalledPackage): string {
  return pkg.source === "winget"
    ? `windows.package(${JSON.stringify(pkg.id)});`
    : `windows.package({ source: "msstore", id: ${JSON.stringify(pkg.id)} });`;
}

/**
 * `winix windows import [--host <name>]`: compare what winget reports as
 * installed with the host's declared packages and print ready-to-paste
 * declarations for the difference. Read-only.
 */
export async function windowsImport(
  cwd: string, opts: { host?: string; run?: WingetRunner; print?: (line: string) => void } = {},
): Promise<void> {
  const run = opts.run ?? runWinget;
  const print = opts.print ?? console.log;
  if (!opts.run) assertWindows("windows import");
  const { workspace, configDir } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace, { configDir }).filter((host) => platformForEvaluatedHost(host) === "windows");
  if (evaluated.length === 0) throw new Error("winix windows import found no Windows hosts in this workspace.");
  const hostName = selectHost(evaluated.map((host) => host.name), opts.host);
  const host = evaluated.find((entry) => entry.name === hostName)!;
  const declared = new Map(Object.values((host.windows as WindowsOptions).packages ?? {})
    .map((pkg) => [`${pkg.source}:${pkg.id.toLowerCase()}`, pkg]));

  const directory = await mkdtemp(join(tmpdir(), "winix-import-"));
  let installed: InstalledPackage[];
  try {
    const file = join(directory, "export.json");
    run(["export", "--output", file, "--accept-source-agreements", "--disable-interactivity"]);
    installed = parseWingetExport(await readFile(file, "utf8"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }

  const installedKeys = new Set(installed.map((pkg) => `${pkg.source}:${pkg.id.toLowerCase()}`));
  const undeclared = installed
    .filter((pkg) => !declared.has(`${pkg.source}:${pkg.id.toLowerCase()}`))
    .sort((a, b) => a.source.localeCompare(b.source) || a.id.localeCompare(b.id));
  const missing = [...declared.values()].filter((pkg) => !installedKeys.has(`${pkg.source}:${pkg.id.toLowerCase()}`));

  const runtimes = undeclared.filter((pkg) => isRuntimePackage(pkg.id));
  const apps = undeclared.filter((pkg) => !isRuntimePackage(pkg.id));
  print(`Host ${hostName}: ${installed.length} installed winget/msstore package(s), ${declared.size} declared.`);
  if (undeclared.length > 0) {
    print(`\nInstalled but not declared (${apps.length}). Paste the ones you want into a feature:`);
    for (const pkg of apps) print(`  ${packageDeclaration(pkg)}`);
    if (runtimes.length > 0) {
      print(`\nShared runtimes, usually installed as dependencies (${runtimes.length}); declare only if you rely on them directly:`);
      print(`  ${runtimes.map((pkg) => pkg.id).join(", ")}`);
    }
    print('\nAdd { version: "any" } for apps that update themselves. Packages Winix did not install');
    print("stay externally owned: removing their declaration later never uninstalls them.");
  } else {
    print("\nEvery installed winget/msstore package is declared.");
  }
  if (missing.length > 0) {
    print(`\nDeclared but not installed (${missing.length}); the next switch installs them:`);
    for (const pkg of missing) print(`  ${pkg.source} ${pkg.id}`);
  }
}
