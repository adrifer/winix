import { readFile, readdir, mkdir, writeFile, lstat, rename, rm } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { standaloneRuntime } from "../../runtime.ts";
import { resolveWinixVersionRange } from "./init.ts";
import { runCommand } from "../run.ts";
import { nodeTypeArguments } from "../node.ts";
import { findConfig, loadWorkspace } from "../loader.ts";
import {
  GENERATED, assertPlainDirectories, defaultExec, installWinixCommand, plainFile, rememberCheckout, rememberedCheckout,
  writeLinuxWrapper,
} from "../winix-home.ts";
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

/**
 * What `winix run` executes for a checkout: the Winix release the checkout
 * pins (this executable when it matches, else the fetched release). Nothing is
 * inferred from node_modules: another Winix (a source checkout, or an npm
 * install) runs only when WINIX_SDK names its package directory explicitly.
 */
export async function localWinixCommand(
  directory: string,
  expected: string,
  runtimeVersion: string,
  executable: string,
  fetchRuntime?: RuntimeFetcher,
  sdk = process.env.WINIX_SDK,
): Promise<{ command: string; args: string[] }> {
  if (sdk) {
    const root = resolve(directory, sdk);
    let local: unknown;
    try { local = JSON.parse(await readFile(join(root, "package.json"), "utf8")); }
    catch { throw new Error(`WINIX_SDK=${sdk} is not a Winix package directory (no readable package.json in ${root}).`); }
    if (!local || typeof local !== "object" || (local as { name?: unknown }).name !== "@adrifer/winix") {
      throw new Error(`WINIX_SDK=${sdk} is not the @adrifer/winix package (${root}).`);
    }
    // A source checkout runs its TypeScript directly (no build needed); a package runs its dist.
    const source = join(root, "src", "cli", "index.ts");
    const built = join(root, "dist", "cli", "index.js");
    const entry = existsSync(source) ? source : existsSync(built) ? built : undefined;
    if (!entry) throw new Error(`WINIX_SDK=${sdk} has neither src/cli/index.ts nor dist/cli/index.js.`);
    const version = String((local as { version?: unknown }).version ?? "unknown");
    console.error(`Using Winix from WINIX_SDK (${root}, ${version}); this checkout pins ${expected}.`);
    return { command: standaloneRuntime() ? "node" : process.execPath, args: ["--no-warnings", entry] };
  }
  if (runtimeVersion !== expected) {
    // The pin changed since bootstrap: fetch that exact, verified release.
    if (fetchRuntime) return { command: await fetchRuntime(expected), args: [] };
    throw new Error(`Checkout requires Winix ${expected}, but this executable is ${runtimeVersion}. Rerun the repository bootstrap to download the matching release.`);
  }
  return { command: executable, args: [] };
}

const RELEASES = "https://github.com/adrifer/winix/releases/download";

/** Downloads a release asset to `target` only when it matches the release's SHA256SUMS. */
async function downloadVerified(version: string, asset: string, target: string, request: typeof fetch, mode = 0o644): Promise<void> {
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
  await mkdir(dirname(target), { recursive: true });
  const temporary = `${target}.${process.pid}.download`;
  try {
    await writeFile(temporary, bytes, { mode });
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

function runtimeFolders(directory: string, version: string) {
  const winix = join(directory, ".winix");
  const runtime = join(winix, "runtime");
  return { winix, runtime, folder: join(runtime, version) };
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
  const { winix, runtime, folder } = runtimeFolders(directory, version);
  const target = join(folder, "winix.exe");
  await assertPlainDirectories([winix, runtime, folder]);
  if (await plainFile(target)) return target;
  return progress.step(`Downloading Winix ${version}`, async () => {
    await downloadVerified(version, asset, target, request);
    await pruneRuntimes(directory, [folder, dirname(running)]);
    return target;
  }, `Downloaded Winix ${version} (checksum verified)`);
}

/**
 * The Linux equivalent: .winix/runtime/<version>/winix.bin, verified the same
 * way, behind a generated `winix` wrapper. On NixOS the wrapper starts the
 * glibc binary through a pinned Nix loader and libraries (out-links next to
 * it, so they stay until the folder is removed); elsewhere it runs it directly.
 * The wrapper's `--version` must report `version` before it is used.
 */
export async function ensureLinuxRuntime(
  directory: string, version: string, request: typeof fetch = fetch, arch = process.arch,
  running = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath,
  nixos = existsSync("/etc/NIXOS"),
  exec: (command: string, args: string[]) => string = defaultExec,
): Promise<string> {
  if (arch !== "x64" && arch !== "arm64") throw new Error(`No standalone Winix release for Linux ${arch}`);
  const { winix, runtime, folder } = runtimeFolders(directory, version);
  const binary = join(folder, "winix.bin");
  const wrapper = join(folder, "winix");
  await assertPlainDirectories([winix, runtime, folder]);
  const ready = async () => await plainFile(wrapper) && await plainFile(binary) &&
    (await readFile(wrapper, "utf8")).startsWith(`#!/usr/bin/env bash\n${GENERATED}\n`);
  if (await ready()) return wrapper;
  return progress.step(`Downloading Winix ${version}`, async () => {
    if (!(await plainFile(binary))) await downloadVerified(version, `winix-linux-${arch}`, binary, request, 0o755);
    await writeLinuxWrapper(folder, arch, nixos, exec);
    const reported = exec(wrapper, ["--version"]).trim();
    if (reported !== version) throw new Error(`Downloaded Winix reports ${reported || "nothing"}, expected ${version}`);
    await pruneRuntimes(directory, [folder, dirname(running)]);
    return wrapper;
  }, `Downloaded Winix ${version} (checksum verified)`);
}

/** The executable a generated checkout launcher falls back to, if any. */
async function launcherFallback(directory: string): Promise<string | undefined> {
  const bin = join(directory, ".winix", "bin");
  for (const [file, pattern, unquote] of [
    ["winix.ps1", /^\$executable = '((?:[^']|'')*)'\r?$/m, (value: string) => value.replaceAll("''", "'")],
    ["winix", /^executable='((?:[^']|'\\'')*)'$/m, (value: string) => value.replaceAll("'\\''", "'")],
  ] as const) {
    try {
      const match = pattern.exec(await readFile(join(bin, file), "utf8"));
      if (match) return unquote(match[1]);
    } catch { /* no such launcher */ }
  }
  return undefined;
}

/**
 * Best-effort cleanup after a download: removes older .winix/runtime/<version>
 * folders, keeping `keep` and the folder the launcher falls back to. Links and
 * anything still in use are left alone.
 */
export async function pruneRuntimes(directory: string, keep: string[]): Promise<void> {
  const runtime = join(directory, ".winix", "runtime");
  const key = (path: string) => {
    const resolved = resolve(path).replace(/[\\/]+$/, "");
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  const kept = new Set(keep.map(key));
  const fallback = await launcherFallback(directory);
  if (fallback) kept.add(key(dirname(fallback)));
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

/** Fetches a changed pin's release on platforms with standalone executables. */
function defaultRuntimeFetcher(directory: string): RuntimeFetcher | undefined {
  if (!standaloneRuntime()) return undefined;
  if (process.platform === "win32") return (version) => ensureWindowsRuntime(directory, version);
  if (process.platform === "linux") return (version) => ensureLinuxRuntime(directory, version);
  return undefined;
}

export async function runCheckout(
  directory: string,
  args: string[],
  run = runCommand,
  fetchRuntime: RuntimeFetcher | undefined = defaultRuntimeFetcher(directory),
): Promise<void> {
  if (!args.length || args[0] === "run") {
    throw new Error("Usage: winix run <check|apply|switch|update|inspect|...> [options]; run cannot be nested");
  }
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  const executable = process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath;
  let command = await localWinixCommand(directory, await checkoutWinixVersion(directory), version, executable, fetchRuntime);
  if (command.args.length) {
    const nodeVersion = execFileSync(command.command, ["--version"], { encoding: "utf8" }).trim();
    command.args.unshift(...nodeTypeArguments(nodeVersion));
  }
  if (command.command === executable && command.args.length === 0) command = selfCommand();
  await run(command.command, [...command.args, ...args], { cwd: directory });
}

/** This Winix, as a command: the standalone executable, or Node running this CLI. */
function selfCommand(): { command: string; args: string[] } {
  if (standaloneRuntime()) return { command: process.env.WINIX_STANDALONE_EXECUTABLE ?? process.execPath, args: [] };
  return {
    command: process.execPath,
    args: [...nodeTypeArguments(process.version), "--no-warnings",
      fileURLToPath(new URL(`../index.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url))],
  };
}

/** Commands that work without a project, in the current folder. */
const PROJECT_FREE = new Set(["init", "install", "help", "--help", "-h", "--version", "-v", "--skill"]);

function needsProject(args: string[]): boolean {
  const [command, sub] = args;
  if (PROJECT_FREE.has(command)) return false;
  // Searching WinGet and Nerd Fonts reads nothing from a config.
  if ((command === "windows" || command === "package") && sub === "search") return false;
  if ((command === "windows" || command === "fonts") && (sub === "fonts" || sub === "search")) return false;
  return true;
}

export interface RouteDeps {
  runCheckout(directory: string, args: string[]): Promise<void>;
  run: typeof runCommand;
  remembered(): string | undefined;
}

const defaultRouteDeps: RouteDeps = {
  runCheckout: (directory, args) => runCheckout(directory, args),
  run: runCommand,
  remembered: () => rememberedCheckout(),
};

/**
 * `winix run <args>`, what the `winix` command runs. It picks the Winix and
 * the folder from where you are:
 *
 * 1. Inside a project (winix.config.ts here or above): the version it pins, there.
 * 2. Elsewhere, for commands that need a project: the checkout bootstrap set up,
 *    so `winix switch` from any folder applies this machine.
 * 3. Otherwise (`init`, `--version`, `windows search`...): this Winix, here.
 */
export async function routeRun(cwd: string, args: string[], deps: RouteDeps = defaultRouteDeps): Promise<void> {
  if (args[0] === "run") throw new Error("winix run cannot be nested");
  const self = async (directory: string) => {
    const command = selfCommand();
    await deps.run(command.command, [...command.args, ...args], { cwd: directory });
  };
  // A new project starts in this folder, even inside another one.
  if (args.length === 0 || args[0] === "init" || args[0] === "install") return self(cwd);
  const config = findConfig(cwd);
  if (config) {
    const directory = dirname(config);
    let pinned = true;
    try { await checkoutWinixVersion(directory); } catch { pinned = false; }
    return pinned ? deps.runCheckout(directory, args) : self(directory);
  }
  const checkout = needsProject(args) ? deps.remembered() : undefined;
  return checkout ? deps.runCheckout(checkout, args) : self(cwd);
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
  /** Install this Winix and the per-user `winix` command, and remember the checkout for `winix switch` anywhere. */
  installCommand(checkout: string): Promise<void>;
}

async function installCommandFor(checkout: string): Promise<void> {
  await installWinixCommand();
  await rememberCheckout(checkout);
  console.log(`Checkout: ${checkout} (winix switch outside a project applies it).`);
}

async function candidateHosts(directory: string): Promise<string[]> {
  const { workspace, configDir } = await loadWorkspace(directory);
  const windows = process.platform === "win32";
  return evaluate(workspace, { configDir })
    .filter((host) => (platformForEvaluatedHost(host) === "windows") === windows)
    .map((host) => host.name);
}

const defaultDeps: BootstrapDeps = { candidateHosts, askHost, installCommand: installCommandFor };

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
    /** Only remember the host (when given), install the `winix` command and remember the checkout; nothing is evaluated. */
    commandOnly?: boolean;
  },
  run = runCheckout,
  deps: BootstrapDeps = defaultDeps,
): Promise<void> {
  if (opts.host !== undefined && (!opts.host || opts.host.startsWith("-") || /[\0\r\n]/.test(opts.host))) {
    throw new Error("bootstrap --host requires a declared host name");
  }
  if (opts.commandOnly) {
    if (!standaloneRuntime()) throw new Error("bootstrap --command-only needs the standalone Winix executable");
    await checkoutWinixVersion(directory);
    if (opts.dry) {
      console.log(`Would install the winix command for ${directory}${opts.host ? ` and remember host "${opts.host}"` : ""}. No config was evaluated.`);
      return;
    }
    await assertPlainDirectories([join(directory, ".winix")]);
    if (opts.host) {
      await rememberHost(directory, opts.host);
      console.log(`Host: ${opts.host} (remembered for winix switch on this machine)`);
    }
    await deps.installCommand(directory);
    return;
  }
  const expected = await checkoutWinixVersion(directory);
  const version = (await resolveWinixVersionRange()).replace(/^\^/, "");
  if (expected !== version) throw new Error(`Checkout requires Winix ${expected}; run its matching bootstrap executable, not ${version}.`);
  if (opts.dry) {
    console.log(`Would prepare checkout ${directory} with Winix ${expected}, ${opts.host ? `validate host "${opts.host}"` : "select its host"}, preview, and ${opts.prepareOnly ? "stop before activation" : opts.confirmed ? "activate it" : "ask before activation"}. No config was evaluated.`);
    return;
  }
  if (!opts.confirmed) await confirm("Evaluate trusted TypeScript from this checkout? Config code can execute commands.", opts.yes);
  await assertPlainDirectories([join(directory, ".winix")]);
  const host = await bootstrapHost(directory, opts.host, deps);
  await rememberHost(directory, host);
  console.log(`Host: ${host} (remembered for winix switch on this machine)`);
  await run(directory, ["check"]);
  // With consent given up front, switch shows the plan itself; preview separately only when stopping there or asking.
  if (opts.prepareOnly || !opts.confirmed) await run(directory, ["switch", "--dry", "--host", host]);
  if (standaloneRuntime()) await deps.installCommand(directory);
  if (opts.prepareOnly) {
    console.log("Prepared and validated. No host activation performed.");
    return;
  }
  if (!opts.confirmed) await confirm(`Activate host "${host}"? Reboot and WSL shutdown are never automatic.`, opts.yes);
  await run(directory, ["switch", "--host", host, ...(opts.yes ? ["--yes"] : [])]);
}
