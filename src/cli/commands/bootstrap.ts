import { readFile, mkdir, writeFile, lstat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { standaloneRuntime } from "../../runtime.ts";
import { resolveWinixVersionRange } from "./init.ts";
import { runCommand } from "../run.ts";

export function pinnedWinixVersion(spec: unknown): string {
  if (typeof spec !== "string") throw new Error("package.json must declare an exact @adrifer/winix dependency");
  if (/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(spec)) return spec;
  const match = /^https:\/\/github\.com\/adrifer\/winix\/releases\/download\/v(\d+\.\d+\.\d+(?:-preview\.\d+)?)\/adrifer-winix-\1\.tgz$/.exec(spec);
  if (!match) throw new Error("Winix bootstrap requires an exact version or matching official GitHub release SDK URL; floating versions are not supported");
  return match[1];
}

export async function checkoutWinixVersion(directory: string): Promise<string> {
  const pkg = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
  return pinnedWinixVersion(pkg.dependencies?.["@adrifer/winix"] ?? pkg.devDependencies?.["@adrifer/winix"]);
}

export async function localWinixCommand(
  directory: string,
  expected: string,
  runtimeVersion: string,
  executable: string,
): Promise<{ command: string; args: string[] }> {
  const packagePath = join(directory, "node_modules", "@adrifer", "winix", "package.json");
  let local: unknown;
  let installed = false;
  try { local = JSON.parse(await readFile(packagePath, "utf8")); installed = true; }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try {
      await lstat(dirname(packagePath));
      throw new Error("Local node_modules Winix is incomplete (missing package.json). Run npm ci or remove the optional SDK explicitly.");
    } catch (directoryError) {
      if ((directoryError as NodeJS.ErrnoException).code !== "ENOENT") throw directoryError;
    }
  }
  if (installed) {
    if (!local || typeof local !== "object" || !("version" in local)) throw new Error("Local node_modules Winix has invalid package metadata. Run npm ci.");
    if (local.version !== expected) {
      throw new Error(`Local node_modules Winix is ${local.version}, expected ${expected}. Run npm ci using your approved repository; bootstrap will not install dependencies automatically.`);
    }
    return {
      command: standaloneRuntime() ? "node" : process.execPath,
      args: ["--no-warnings", join(dirname(packagePath), "dist", "cli", "index.js")],
    };
  }
  if (runtimeVersion !== expected) {
    throw new Error(`Checkout requires Winix ${expected}, but this executable is ${runtimeVersion}. Rerun the repository bootstrap to download the matching release.`);
  }
  return { command: executable, args: [] };
}

export async function runCheckout(
  directory: string,
  args: string[],
  run = runCommand,
): Promise<void> {
  if (!args.length || ["run", "bootstrap"].includes(args[0])) {
    throw new Error("Usage: winix run <check|apply|switch|update|inspect|...> [options]; run/bootstrap cannot be nested");
  }
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  const executable = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath;
  let command = await localWinixCommand(directory, await checkoutWinixVersion(directory), version, executable);
  if (command.args.length) {
    const nodeVersion = execFileSync(command.command, ["--version"], { encoding: "utf8" }).trim();
    command.args.unshift(...nodeTypeArguments(nodeVersion));
  }
  if (!standaloneRuntime() && command.command === process.execPath && command.args.length === 0) {
    command = {
      command: process.execPath,
      args: [...nodeTypeArguments(process.version), "--no-warnings",
        fileURLToPath(new URL(`../index.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url))],
    };
  }
  await run(command.command, [...command.args, ...args], { cwd: directory });
}

export function nodeTypeArguments(version: string): string[] {
  const parsed = /^v?(\d+)\.(\d+)\.\d+$/.exec(version);
  if (!parsed || Number(parsed[1]) < 22 || Number(parsed[1]) === 22 && Number(parsed[2]) < 13) {
    throw new Error(`Local SDK requires stable Node >=22.13, found ${version}. Install it explicitly or remove the optional node_modules SDK to retain standalone mode.`);
  }
  return Number(parsed[1]) >= 26 ? [] : ["--experimental-transform-types"];
}

async function confirm(message: string, yes: boolean): Promise<void> {
  if (yes) return;
  if (!stdin.isTTY) throw new Error(`${message} Noninteractive bootstrap requires --yes.`);
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    if (!/^(y|yes)$/i.test((await reader.question(`${message} [y/N] `)).trim())) {
      throw new Error("Bootstrap cancelled.");
    }
  } finally { reader.close(); }
}

export async function bootstrapCheckout(
  directory: string,
  opts: { host: string; yes: boolean; prepareOnly: boolean; dry: boolean },
  run = runCheckout,
): Promise<void> {
  if (!opts.host || opts.host.startsWith("-") || /[\0\r\n]/.test(opts.host)) throw new Error("bootstrap requires --host <declared-host>");
  const expected = await checkoutWinixVersion(directory);
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  if (expected !== version) throw new Error(`Checkout requires Winix ${expected}; run its matching bootstrap executable, not ${version}.`);
  if (opts.dry) {
    console.log(`Would prepare checkout ${directory} with Winix ${expected}, validate host "${opts.host}", preview, and ${opts.prepareOnly ? "stop before activation" : "ask before activation"}. No config was evaluated.`);
    return;
  }
  await confirm("Evaluate trusted TypeScript from this checkout? Config code can execute commands.", opts.yes);
  const bin = join(directory, ".winix", "bin");
  for (const path of [join(directory, ".winix"), bin]) {
    try {
      if (!(await lstat(path)).isDirectory()) throw new Error(`Refusing a linked/non-directory bootstrap path: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  await run(directory, ["check"]);
  await run(directory, ["switch", "--dry", "--host", opts.host]);
  if (standaloneRuntime()) {
    const executable = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath;
    await mkdir(bin, { recursive: true });
    const windows = process.platform === "win32";
    const launcher = join(bin, windows ? "winix.ps1" : "winix");
    const content = windows
      ? `# Generated by Winix bootstrap\n$ErrorActionPreference = 'Stop'\nSet-Location -LiteralPath (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent)\n& '${executable.replaceAll("'", "''")}' run @args\nexit $LASTEXITCODE\n`
      : `#!/usr/bin/env bash\n# Generated by Winix bootstrap\nset -euo pipefail\ncd -- "$(dirname -- "\${BASH_SOURCE[0]}")/../.."\nexec '${executable.replaceAll("'", "'\\''")}' run "$@"\n`;
    try {
      const stat = await lstat(launcher);
      if (!stat.isFile() || !(await readFile(launcher, "utf8")).includes("# Generated by Winix bootstrap")) {
        throw new Error(`Refusing to overwrite an unrecognized launcher: ${launcher}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    await writeFile(launcher, content, { mode: 0o755 });
    console.log(`Checkout launcher: ${launcher}. It prefers a matching node_modules SDK, never installs npm packages, and rejects stale versions.`);
  }
  if (opts.prepareOnly) {
    console.log("Prepared and validated. No host activation performed.");
    return;
  }
  await confirm(`Activate host "${opts.host}"? Reboot and WSL shutdown are never automatic.`, opts.yes);
  await run(directory, ["switch", "--host", opts.host, ...(opts.yes ? ["--yes"] : [])]);
}
