import { readFile, readdir, mkdir, writeFile, lstat, rename, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { hostname } from "node:os";
import { standaloneRuntime } from "../../runtime.ts";
import { resolveWinixVersionRange } from "./init.ts";
import { runCommand } from "../run.ts";
import { nodeTypeArguments } from "../node.ts";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { platformForEvaluatedHost } from "../activation.ts";
import { readRememberedHost, rememberHost } from "../host-memory.ts";
import * as progress from "../progress.ts";
export { nodeTypeArguments } from "../node.ts";

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

/** Downloads the executable for a pinned version; returns its path. */
export type RuntimeFetcher = (version: string) => Promise<string>;

export async function localWinixCommand(
  directory: string,
  expected: string,
  runtimeVersion: string,
  executable: string,
  fetchRuntime?: RuntimeFetcher,
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
      throw new Error(`Local node_modules Winix is ${local.version}, expected ${expected}. Run npm ci using your approved repository (Winix never installs dependencies itself), or delete node_modules to use the downloaded release instead.`);
    }
    return {
      command: standaloneRuntime() ? "node" : process.execPath,
      args: ["--no-warnings", join(dirname(packagePath), "dist", "cli", "index.js")],
    };
  }
  if (runtimeVersion !== expected) {
    // The pin changed since bootstrap: fetch that exact, verified release.
    if (fetchRuntime) return { command: await fetchRuntime(expected), args: [] };
    throw new Error(`Checkout requires Winix ${expected}, but this executable is ${runtimeVersion}. Rerun the repository bootstrap to download the matching release.`);
  }
  return { command: executable, args: [] };
}

const RELEASES = "https://github.com/adrifer/winix/releases/download";

async function assertPlainDirectories(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      if (!(await lstat(path)).isDirectory()) throw new Error(`Refusing a linked/non-directory Winix path: ${path}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/**
 * The Windows executable for `version`, in the checkout's ignored
 * .winix\runtime\<version>\winix.exe: downloaded from the official release
 * and checked against its SHA256SUMS before it is ever run.
 */
export async function ensureWindowsRuntime(
  directory: string, version: string, request: typeof fetch = fetch, arch = process.arch,
  running = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath,
): Promise<string> {
  const asset = arch === "arm64" ? "winix-windows-arm64.exe" : "winix-windows-x64.exe";
  const winix = join(directory, ".winix");
  const runtime = join(winix, "runtime");
  const folder = join(runtime, version);
  const target = join(folder, "winix.exe");
  await assertPlainDirectories([winix, runtime, folder]);
  try {
    if ((await lstat(target)).isFile()) return target;
    throw new Error(`Refusing a linked/non-file Winix executable: ${target}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return progress.step(`Downloading Winix ${version}`, async () => {
    const get = async (url: string) => {
      const response = await request(url);
      if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
      return response;
    };
    const sums = await (await get(`${RELEASES}/v${version}/SHA256SUMS`)).text();
    const entries = sums.split(/\r?\n/).filter((line) => new RegExp(`^[a-fA-F0-9]{64}\\s+\\*?${asset.replaceAll(".", "\\.")}$`).test(line.trim()));
    if (entries.length !== 1) throw new Error(`Release checksum missing or duplicated for ${asset} ${version}`);
    const expected = entries[0].trim().split(/\s+/)[0].toLowerCase();
    const bytes = Buffer.from(await (await get(`${RELEASES}/v${version}/${asset}`)).arrayBuffer());
    if (createHash("sha256").update(bytes).digest("hex") !== expected) {
      throw new Error(`Release checksum mismatch for ${asset} ${version}; nothing was run`);
    }
    await mkdir(folder, { recursive: true });
    const temporary = `${target}.${process.pid}.download`;
    try {
      await writeFile(temporary, bytes);
      await rename(temporary, target);
    } finally {
      await rm(temporary, { force: true });
    }
    await pruneWindowsRuntimes(directory, [folder, dirname(running)]);
    return target;
  }, `Downloaded Winix ${version} (checksum verified)`);
}

/**
 * Best-effort cleanup after a download: removes older .winix\runtime\<version>
 * folders, keeping `keep` and the folder the launcher falls back to. Links and
 * anything still in use are left alone.
 */
export async function pruneWindowsRuntimes(directory: string, keep: string[]): Promise<void> {
  const runtime = join(directory, ".winix", "runtime");
  const key = (path: string) => resolve(path).replace(/[\\/]+$/, "").toLowerCase();
  const kept = new Set(keep.map(key));
  try {
    const launcher = await readFile(join(directory, ".winix", "bin", "winix.ps1"), "utf8");
    const baked = /^\$executable = '((?:[^']|'')*)'\r?$/m.exec(launcher);
    if (baked) kept.add(key(dirname(baked[1].replaceAll("''", "'"))));
  } catch { /* no launcher: nothing extra to keep */ }
  let entries: string[];
  try { entries = await readdir(runtime); } catch { return; }
  for (const name of entries) {
    if (!/^\d+\.\d+\.\d+(?:-preview\.\d+)?$/.test(name)) continue;
    const path = join(runtime, name);
    if (kept.has(key(path))) continue;
    try {
      if (!(await lstat(path)).isDirectory()) continue;
      await rm(path, { recursive: true, force: true });
    } catch { /* in use or protected: try again after the next download */ }
  }
}

export async function runCheckout(
  directory: string,
  args: string[],
  run = runCommand,
  fetchRuntime: RuntimeFetcher | undefined =
    standaloneRuntime() && process.platform === "win32" ? (version) => ensureWindowsRuntime(directory, version) : undefined,
): Promise<void> {
  if (!args.length || ["run", "bootstrap"].includes(args[0])) {
    throw new Error("Usage: winix run <check|apply|switch|update|inspect|...> [options]; run/bootstrap cannot be nested");
  }
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  const executable = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath;
  let command = await localWinixCommand(directory, await checkoutWinixVersion(directory), version, executable, fetchRuntime);
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

/** Ask which declared host this machine is; numbered choices. */
async function askHost(hosts: string[]): Promise<string> {
  if (!stdin.isTTY) throw new Error(`Which host is this machine? Rerun with --host <name> (${hosts.join(", ")}).`);
  console.log("\nWhich host is this machine?");
  hosts.forEach((host, index) => console.log(`  ${index + 1}) ${host}`));
  const reader = createInterface({ input: stdin, output: stdout });
  try {
    for (;;) {
      const answer = (await reader.question(`Choose [1-${hosts.length}]: `)).trim();
      const index = Number(answer);
      if (Number.isInteger(index) && index >= 1 && index <= hosts.length) return hosts[index - 1];
      if (hosts.includes(answer)) return answer;
      console.log(`Type a number from 1 to ${hosts.length}.`);
    }
  } finally { reader.close(); }
}

export interface BootstrapDeps {
  /** Hosts this machine could be (evaluates the trusted config). */
  candidateHosts(directory: string): Promise<string[]>;
  askHost(hosts: string[]): Promise<string>;
  /** Put a per-user `winix` command on PATH that runs this launcher. */
  installCommand(launcher: string): Promise<void>;
}

async function candidateHosts(directory: string): Promise<string[]> {
  const { workspace, configDir } = await loadWorkspace(directory);
  const windows = process.platform === "win32";
  return evaluate(workspace, { configDir })
    .filter((host) => (platformForEvaluatedHost(host) === "windows") === windows)
    .map((host) => host.name);
}

const defaultDeps: BootstrapDeps = { candidateHosts, askHost, installCommand: installUserCommand };

/**
 * The host to bootstrap: the requested one, the one remembered from an earlier
 * bootstrap, the only candidate, the one matching this machine's name, or the
 * user's choice.
 */
async function bootstrapHost(directory: string, requested: string | undefined, deps: BootstrapDeps): Promise<string> {
  if (requested) return requested;
  const hosts = await deps.candidateHosts(directory);
  if (hosts.length === 0) throw new Error(`The configuration declares no ${process.platform === "win32" ? "Windows" : "Linux/macOS"} host for this machine.`);
  const remembered = readRememberedHost(directory);
  if (remembered && hosts.includes(remembered)) return remembered;
  if (hosts.length === 1) return hosts[0];
  const machine = hostname();
  const match = hosts.find((host) => host.toLowerCase() === machine.toLowerCase());
  return match ?? deps.askHost(hosts);
}

export async function bootstrapCheckout(
  directory: string,
  opts: {
    host?: string; yes: boolean; prepareOnly: boolean; dry: boolean;
    /** Consent was already given by the repository bootstrap script: no further questions. */
    confirmed?: boolean;
  },
  run = runCheckout,
  deps: BootstrapDeps = defaultDeps,
): Promise<void> {
  if (opts.host !== undefined && (!opts.host || opts.host.startsWith("-") || /[\0\r\n]/.test(opts.host))) {
    throw new Error("bootstrap --host requires a declared host name");
  }
  const expected = await checkoutWinixVersion(directory);
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  if (expected !== version) throw new Error(`Checkout requires Winix ${expected}; run its matching bootstrap executable, not ${version}.`);
  if (opts.dry) {
    console.log(`Would prepare checkout ${directory} with Winix ${expected}, ${opts.host ? `validate host "${opts.host}"` : "select its host"}, preview, and ${opts.prepareOnly ? "stop before activation" : opts.confirmed ? "activate it" : "ask before activation"}. No config was evaluated.`);
    return;
  }
  if (!opts.confirmed) await confirm("Evaluate trusted TypeScript from this checkout? Config code can execute commands.", opts.yes);
  const bin = join(directory, ".winix", "bin");
  await assertPlainDirectories([join(directory, ".winix"), bin]);
  const host = await bootstrapHost(directory, opts.host, deps);
  await rememberHost(directory, host);
  console.log(`Host: ${host} (remembered for winix switch on this machine)`);
  await run(directory, ["check"]);
  // With consent given up front, switch shows the plan itself; preview separately only when stopping there or asking.
  if (opts.prepareOnly || !opts.confirmed) await run(directory, ["switch", "--dry", "--host", host]);
  if (standaloneRuntime()) {
    const executable = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath;
    await mkdir(bin, { recursive: true });
    const windows = process.platform === "win32";
    const launcher = join(bin, windows ? "winix.ps1" : "winix");
    const content = windows ? windowsLauncher(executable) : linuxLauncher(executable);
    await writeGenerated(launcher, content, "launcher");
    console.log(`Checkout launcher: ${launcher}. It prefers a matching node_modules SDK, never installs npm packages, and fetches the pinned Winix release when the pin changes.`);
    if (windows) await deps.installCommand(launcher);
  }
  if (opts.prepareOnly) {
    console.log("Prepared and validated. No host activation performed.");
    return;
  }
  if (!opts.confirmed) await confirm(`Activate host "${host}"? Reboot and WSL shutdown are never automatic.`, opts.yes);
  await run(directory, ["switch", "--host", host, ...(opts.yes ? ["--yes"] : [])]);
}

const GENERATED = "# Generated by Winix bootstrap";

async function writeGenerated(path: string, content: string, what: string): Promise<void> {
  try {
    const stat = await lstat(path);
    if (!stat.isFile() || !(await readFile(path, "utf8")).includes("Generated by Winix bootstrap")) {
      throw new Error(`Refusing to overwrite an unrecognized ${what}: ${path}`);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await writeFile(path, content, { mode: 0o755 });
}

/**
 * Runs `winix run` from the config directory with the executable for the
 * checkout's current pin when it has been downloaded, else the bootstrap one
 * (which downloads the pinned release itself).
 */
export function windowsLauncher(executable: string): string {
  return `${GENERATED}
$ErrorActionPreference = 'Stop'
$config = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $config
$executable = '${executable.replaceAll("'", "''")}'
try {
  $package = Get-Content -LiteralPath (Join-Path $config 'package.json') -Raw | ConvertFrom-Json
  $spec = $package.dependencies.'@adrifer/winix'
  if (-not $spec) { $spec = $package.devDependencies.'@adrifer/winix' }
  if ($spec -match '^(\\d+\\.\\d+\\.\\d+(?:-preview\\.\\d+)?)$' -or $spec -match '/download/v(\\d+\\.\\d+\\.\\d+(?:-preview\\.\\d+)?)/') {
    $pinned = Join-Path $config ('.winix\\runtime\\' + $Matches[1] + '\\winix.exe')
    if (Test-Path -LiteralPath $pinned -PathType Leaf) { $executable = $pinned }
  }
} catch { }
& $executable run @args
exit $LASTEXITCODE
`;
}

function linuxLauncher(executable: string): string {
  return `#!/usr/bin/env bash\n${GENERATED}\nset -euo pipefail\ncd -- "$(dirname -- "\${BASH_SOURCE[0]}")/../.."\nexec '${executable.replaceAll("'", "'\\''")}' run "$@"\n`;
}

/** The per-user command: %LOCALAPPDATA%\Winix\bin\winix.cmd, on the user PATH (no elevation). */
export function windowsCommandShim(launcher: string): string {
  return [
    "@echo off",
    "rem Generated by Winix bootstrap",
    `"%SystemRoot%\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoLogo -NoProfile -ExecutionPolicy Bypass -File "${launcher}" %*`,
    "exit /b %ERRORLEVEL%",
    "",
  ].join("\r\n");
}

/** Adds a directory to the user PATH, keeping %VARIABLE% entries unexpanded, and notifies running apps. */
export function userPathScript(directory: string): string {
  return `$ErrorActionPreference = 'Stop'
$dir = '${directory.replaceAll("'", "''")}'
$key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Environment', $true)
$changed = $false
try {
  $current = [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = if ($null -ne $key.GetValue('Path')) { $key.GetValueKind('Path') } else { [Microsoft.Win32.RegistryValueKind]::ExpandString }
  $entries = @($current -split ';' | Where-Object { $_ })
  if (-not ($entries | Where-Object { $_.TrimEnd('\\') -ieq $dir.TrimEnd('\\') })) {
    $key.SetValue('Path', (@($entries) + $dir) -join ';', $kind)
    $changed = $true
  }
} finally { $key.Dispose() }
# Setting a user variable broadcasts WM_SETTINGCHANGE, so new terminals see the PATH.
if ($changed) { [Environment]::SetEnvironmentVariable('WINIX_PATH_REFRESH', $null, 'User') }
`;
}

async function installUserCommand(launcher: string): Promise<void> {
  const localAppData = process.env.LOCALAPPDATA;
  if (!localAppData) throw new Error("LOCALAPPDATA is not set; cannot install the winix command");
  const bin = join(localAppData, "Winix", "bin");
  await assertPlainDirectories([join(localAppData, "Winix"), bin]);
  await mkdir(bin, { recursive: true });
  const shim = join(bin, "winix.cmd");
  await writeGenerated(shim, windowsCommandShim(launcher), "winix command");
  execFileSync("powershell.exe", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(userPathScript(bin), "utf16le").toString("base64"),
  ], { stdio: ["ignore", "ignore", "pipe"], timeout: 60000 });
  console.log(`Command: winix (${shim}, on your user PATH; open a new terminal to use it).`);
}
