// `winix plan` / `winix switch` for NixOS (and NixOS-WSL) hosts: build the new
// system without activating it, then compare it with the running one
// (/run/current-system) to show what a switch would change.
//
// Everything here reads store paths; nothing is activated. The one privileged
// call is `switch-to-configuration dry-activate` (NixOS's own dry run for
// services), made only when sudo works without a password; otherwise services
// are estimated from the unit files.

import { spawn } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { painter, plural, type Paint, type Style } from "./style.ts";

const NIX_FLAGS = ["--extra-experimental-features", "nix-command flakes"];

export interface CommandResult { code: number; stdout: string; stderr: string }

/** How the plan runs programs; replaced in tests. */
export interface NixPlanRunner {
  /** Run to completion and capture its output (never throws on a non-zero exit). */
  capture(command: string, args: string[]): Promise<CommandResult>;
  /** Run with the terminal attached (the build's own progress output). */
  run(command: string, args: string[]): Promise<void>;
}

export interface NixPlanPaths {
  /** The running system. */
  current: string;
  /** Where system generations are (system-<n>-link). */
  profiles: string;
}

export const DEFAULT_NIX_PLAN_PATHS: NixPlanPaths = {
  current: "/run/current-system",
  profiles: "/nix/var/nix/profiles",
};

export interface PackageChange {
  name: string;
  action: "install" | "upgrade" | "downgrade" | "change" | "remove";
  from?: string;
  to?: string;
}

export interface FileChange { path: string; action: "add" | "change" | "remove" }

export interface ServiceChanges {
  start: string[];
  stop: string[];
  restart: string[];
  reload: string[];
  /** Changed units NixOS leaves running (X-RestartIfChanged=false). */
  keep: string[];
  restartSystemd: boolean;
  /** From the unit files, because NixOS's dry run needs root. */
  estimated: boolean;
}

export interface NixPlan {
  host: string;
  built: string;
  /** The running system; undefined when this machine isn't running NixOS. */
  current?: string;
  same: boolean;
  version?: { from: string; to: string };
  packages: PackageChange[];
  /** Other store paths whose version changed (dependencies). */
  dependencies: number;
  home: { user: string; changes: FileChange[]; newUser: boolean }[];
  etc: FileChange[];
  services?: ServiceChanges;
  /** Kernel or initrd changed: fully applies after a restart. */
  reboot: boolean;
  /** The generation number a switch would create. */
  generation?: number;
}

export interface BuildSummary { build: number; fetch: number; download?: string }

// ---------------------------------------------------------------------------
// Parsing

const STORE_PATH = /^\/nix\/store\/[a-z0-9]{32}-/;
const ANSI = /\x1b\[[0-9;]*m/g;

/** Nix's name/version split: the version starts at the first "-" not followed by a letter. */
export function drvName(storeName: string): { name: string; version: string } {
  const base = storeName.replace(STORE_PATH, "").replace(/^.*\//, "");
  const match = /-[^a-zA-Z]/.exec(base);
  return match ? { name: base.slice(0, match.index), version: base.slice(match.index + 1) } : { name: base, version: "" };
}

/** `nix build --dry-run` (stderr): how much would be built and fetched. */
export function parseDryRun(output: string): BuildSummary {
  const build = /(?:these (\d+)|this) derivations? will be built/.exec(output);
  const fetch = /(?:these (\d+)|this) paths? will be fetched \(([\d.]+ \w+) download/.exec(output);
  return {
    build: build ? Number(build[1] ?? 1) : 0,
    fetch: fetch ? Number(fetch[1] ?? 1) : 0,
    ...(fetch && { download: fetch[2] }),
  };
}

export interface ClosureChange { name: string; from: string[]; to: string[] }

/** `nix store diff-closures` lines: `name: 1.0, 1.1 → 2.0, +12.3 KiB` (∅ absent, ε no version). */
export function parseDiffClosures(output: string): ClosureChange[] {
  const changes: ClosureChange[] = [];
  for (const raw of output.replace(ANSI, "").split(/\r?\n/)) {
    const line = /^(\S+): (.*)$/.exec(raw.trim());
    if (!line) continue;
    const arrow = line[2].indexOf("→");
    if (arrow === -1) continue; // size only: rebuilt, same version
    const side = (text: string) => text.split(",").map((part) => part.trim())
      .filter((part) => part && part !== "∅" && !/^[+-]?[\d.]+ [KMGT]?i?B$/.test(part))
      .map((part) => (part === "ε" ? "" : part));
    changes.push({ name: line[1], from: side(line[2].slice(0, arrow)), to: side(line[2].slice(arrow + 1)) });
  }
  return changes;
}

/** `switch-to-configuration dry-activate`: the "would ..." lines about units. */
export function parseDryActivate(output: string): ServiceChanges {
  const services: ServiceChanges = {
    start: [], stop: [], restart: [], reload: [], keep: [], restartSystemd: false, estimated: false,
  };
  for (const raw of output.replace(ANSI, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (/^would restart systemd/.test(line)) services.restartSystemd = true;
    const units = /^would (NOT stop|stop|restart|start|reload) the following (?:changed |user )?units: (.*)$/.exec(line);
    if (!units) continue;
    const list = units[2].split(",").map((unit) => unit.trim()).filter(Boolean);
    const key = units[1] === "NOT stop" ? "keep" : units[1] as "stop" | "restart" | "start" | "reload";
    services[key].push(...list);
  }
  return services;
}

/**
 * Store paths in file content, without hash and version: a dependency rebuilt
 * or bumped is the package section's news, not a changed config file.
 */
export function normalizeStorePaths(text: string): string {
  return text.replace(/\/nix\/store\/[a-z0-9]{32}-([^/\s"'`;:,)]+)/g, (_match, name: string) => `/nix/store/${drvName(name).name}`);
}

// ---------------------------------------------------------------------------
// Comparing trees (/etc, Home Manager files)

const FILE_COMPARE_LIMIT = 4 * 1024 * 1024;
const TREE_ENTRY_LIMIT = 20000;

/** Leaves of a tree: files, and links that point out of the store (to the checkout). */
interface Leaf { real: string; external: boolean }

function walk(root: string, prefix: string, out: Map<string, Leaf>, exclude: string[]): void {
  if (out.size > TREE_ENTRY_LIMIT) return;
  let names: string[];
  try { names = readdirSync(root); } catch { return; }
  for (const name of names) {
    const relative = prefix ? `${prefix}/${name}` : name;
    if (exclude.includes(relative)) continue;
    const path = join(root, name);
    let real: string;
    try {
      real = realpathSync(path);
    } catch {
      // A link to something that doesn't exist here (/run/..., a host path): compare where it points.
      let target = "";
      try { target = readlinkSync(path); } catch { /* not a link */ }
      out.set(relative, { real: `link:${target}`, external: true });
      continue;
    }
    // Links out of the store point at live files (Home Manager's out-of-store links into the checkout).
    const external = lstatSync(path).isSymbolicLink() && !real.startsWith("/nix/store/");
    let directory = false;
    try { directory = statSync(real).isDirectory(); } catch { /* dangling */ }
    if (directory && !external) walk(real, relative, out, exclude);
    else out.set(relative, { real, external });
  }
}

function sameContent(a: Leaf, b: Leaf, replace: [string, string][]): boolean {
  if (a.real === b.real) return true;
  if (a.external || b.external) return false;
  try {
    const [sa, sb] = [statSync(a.real).size, statSync(b.real).size];
    if (sa > FILE_COMPARE_LIMIT || sb > FILE_COMPARE_LIMIT) return false;
    const normalize = (path: string) => replace.reduce(
      (text, [from, to]) => text.split(from).join(to), normalizeStorePaths(readFileSync(path, "latin1")));
    return normalize(a.real) === normalize(b.real);
  } catch {
    return false;
  }
}

/**
 * Files added, removed or changed between two trees (either may be missing).
 * `replace` pairs are substituted in both sides' content before comparing.
 */
export function diffTrees(
  oldRoot: string | undefined, newRoot: string | undefined, exclude: string[] = [], replace: [string, string][] = [],
): FileChange[] {
  const before = new Map<string, Leaf>();
  const after = new Map<string, Leaf>();
  const resolve = (root: string | undefined) => {
    if (!root || !existsSync(root)) return undefined;
    try { return realpathSync(root); } catch { return undefined; }
  };
  const [oldReal, newReal] = [resolve(oldRoot), resolve(newRoot)];
  if (oldReal && oldReal === newReal) return [];
  if (oldReal) walk(oldReal, "", before, exclude);
  if (newReal) walk(newReal, "", after, exclude);
  const changes: FileChange[] = [];
  for (const [path, leaf] of after) {
    const previous = before.get(path);
    if (!previous) changes.push({ path, action: "add" });
    else if (!sameContent(previous, leaf, replace)) changes.push({ path, action: "change" });
  }
  for (const path of before.keys()) if (!after.has(path)) changes.push({ path, action: "remove" });
  return changes.sort((a, b) => a.path.localeCompare(b.path));
}

// ---------------------------------------------------------------------------
// Services, estimated from unit files

const UNIT_KINDS = /\.(service|socket|timer|path|mount)$/;
const WANTS_DIRS = ["multi-user.target.wants", "default.target.wants", "sockets.target.wants", "timers.target.wants"];

function readUnits(system: string | undefined): Map<string, string> {
  const units = new Map<string, string>();
  if (!system) return units;
  const dir = join(system, "etc", "systemd", "system");
  let names: string[];
  try { names = readdirSync(dir); } catch { return units; }
  for (const name of names) {
    if (!UNIT_KINDS.test(name)) continue;
    try {
      const path = join(dir, name);
      if (statSync(path).isFile()) units.set(name, readFileSync(path, "utf8"));
    } catch { /* unreadable: skip */ }
  }
  return units;
}

function wanted(system: string, unit: string): boolean {
  return WANTS_DIRS.some((dir) => existsSync(join(system, "etc", "systemd", "system", dir, unit)));
}

/** What switch-to-configuration would do with units, from the unit files alone. */
export async function estimateServices(
  current: string, built: string, runner: NixPlanRunner,
): Promise<ServiceChanges> {
  const before = readUnits(current);
  const after = readUnits(built);
  const services: ServiceChanges = {
    start: [], stop: [], restart: [], reload: [], keep: [], restartSystemd: false, estimated: true,
  };
  const changed: string[] = [];
  const removed: string[] = [];
  for (const [unit, text] of after) {
    const previous = before.get(unit);
    if (previous === undefined) {
      if (wanted(built, unit)) services.start.push(unit);
    } else if (previous !== text) {
      changed.push(unit);
    }
  }
  for (const unit of before.keys()) if (!after.has(unit)) removed.push(unit);
  // Only running units are stopped or restarted.
  const candidates = [...changed, ...removed];
  const active = new Set<string>();
  if (candidates.length > 0) {
    const result = await runner.capture("systemctl", ["is-active", ...candidates]);
    result.stdout.split(/\r?\n/).forEach((state, index) => {
      if (state.trim() === "active" && candidates[index]) active.add(candidates[index]);
    });
  }
  for (const unit of changed) {
    if (!active.has(unit)) continue;
    const text = after.get(unit)!;
    if (/^X-RestartIfChanged=false$/m.test(text)) services.keep.push(unit);
    else if (/^X-ReloadIfChanged=true$/m.test(text)) services.reload.push(unit);
    else services.restart.push(unit);
  }
  for (const unit of removed) if (active.has(unit)) services.stop.push(unit);
  services.restartSystemd = realOrUndefined(join(current, "systemd")) !== realOrUndefined(join(built, "systemd"));
  return services;
}

// ---------------------------------------------------------------------------
// The plan

function realOrUndefined(path: string): string | undefined {
  try { return realpathSync(path); } catch { return undefined; }
}

function readText(path: string): string | undefined {
  try { return readFileSync(path, "utf8").trim(); } catch { return undefined; }
}

/** Home Manager generations by user, from the home-manager-<user> units. */
export function homeGenerations(system: string | undefined): Map<string, string> {
  const generations = new Map<string, string>();
  if (!system) return generations;
  for (const [unit, text] of readUnits(system)) {
    const user = /^home-manager-(.+)\.service$/.exec(unit)?.[1];
    const generation = /\/nix\/store\/[a-z0-9]{32}-home-manager-generation/.exec(text)?.[0];
    if (user && generation) generations.set(user, generation);
  }
  return generations;
}

async function references(path: string, runner: NixPlanRunner): Promise<string[]> {
  // nix-store answers for the store path a path is inside of, so resolve links
  // first (<generation>/home-path is a link inside the generation).
  const real = realOrUndefined(path);
  if (!real) return [];
  const result = await runner.capture("nix-store", ["-q", "--references", real]);
  return result.code === 0 ? result.stdout.split(/\r?\n/).filter(Boolean) : [];
}

/** Package environments that only wrap another one (a user profile around home-manager-path). */
const ENVIRONMENTS = new Set(["system-path", "home-manager-path", "user-environment"]);

/** Per-user package profiles (users.users.<name>.packages, and Home Manager's with useUserPackages). */
function userProfiles(system: string): string[] {
  const dir = join(system, "etc", "profiles", "per-user");
  try { return readdirSync(dir).map((user) => join(dir, user)); } catch { return []; }
}

/** Names of the packages the config declares: what sw, the per-user profiles and each home-path link to. */
async function declaredPackages(systems: (string | undefined)[], runner: NixPlanRunner): Promise<Set<string>> {
  const names = new Set<string>();
  for (const system of systems) {
    if (!system) continue;
    const roots = [
      join(system, "sw"),
      ...userProfiles(system),
      ...[...homeGenerations(system).values()].map((generation) => join(generation, "home-path")),
    ];
    for (const root of roots) {
      for (const ref of await references(root, runner)) {
        const { name } = drvName(ref);
        if (!ENVIRONMENTS.has(name)) names.add(name);
        else for (const inner of await references(ref, runner)) names.add(drvName(inner).name);
      }
    }
  }
  return names;
}

function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/);
  const pb = b.split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const [x, y] = [pa[i] ?? "", pb[i] ?? ""];
    const [nx, ny] = [Number(x), Number(y)];
    const diff = !Number.isNaN(nx) && !Number.isNaN(ny) && x !== "" && y !== "" ? nx - ny : x.localeCompare(y);
    if (diff !== 0) return diff;
  }
  return 0;
}

function packageChange(change: ClosureChange): PackageChange | undefined {
  const from = change.from.join(", ");
  const to = change.to.join(", ");
  if (change.from.length === 0 && change.to.length === 0) return undefined;
  if (change.from.length === 0 && change.to.length > 0) return { name: change.name, action: "install", to };
  if (change.to.length === 0 && change.from.length > 0) return { name: change.name, action: "remove", from };
  // Present on both sides (∅ handled above); "ε" parses to "".
  const order = compareVersions(change.to.at(-1)!, change.from.at(-1)!);
  return { name: change.name, action: order > 0 ? "upgrade" : order < 0 ? "downgrade" : "change", from, to };
}

function nextGeneration(profiles: string): number | undefined {
  let highest = 0;
  try {
    for (const name of readdirSync(profiles)) {
      const match = /^system-(\d+)-link$/.exec(name);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  } catch {
    return undefined;
  }
  return highest > 0 ? highest + 1 : undefined;
}

/** Compare a built system with the running one. */
export async function compareNixosSystems(opts: {
  host: string; built: string; runner: NixPlanRunner; paths?: NixPlanPaths; isRoot?: boolean;
}): Promise<NixPlan> {
  const paths = opts.paths ?? DEFAULT_NIX_PLAN_PATHS;
  const built = realpathSync(opts.built);
  const current = realOrUndefined(paths.current);
  const plan: NixPlan = {
    host: opts.host, built, current, same: current === built,
    packages: [], dependencies: 0, home: [], etc: [], reboot: false,
  };
  if (!current || plan.same) return plan;

  const [from, to] = [readText(join(current, "nixos-version")), readText(join(built, "nixos-version"))];
  if (from && to && from !== to) plan.version = { from, to };
  plan.generation = nextGeneration(paths.profiles);

  const diff = await opts.runner.capture("nix", [...NIX_FLAGS, "store", "diff-closures", current, built]);
  const declared = await declaredPackages([current, built], opts.runner);
  for (const change of parseDiffClosures(diff.stdout)) {
    if (/^nixos-system-/.test(change.name)) continue;
    const row = declared.has(change.name) ? packageChange(change) : undefined;
    if (row && row.action !== "change") plan.packages.push(row);
    else plan.dependencies++;
  }
  const order = { install: 0, upgrade: 1, downgrade: 2, change: 3, remove: 4 };
  plan.packages.sort((a, b) => order[a.action] - order[b.action] || a.name.localeCompare(b.name));

  const before = homeGenerations(current);
  const after = homeGenerations(built);
  for (const user of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const [old, next] = [before.get(user), after.get(user)];
    const changes = diffTrees(old && join(old, "home-files"), next && join(next, "home-files"));
    if (changes.length > 0) plan.home.push({ user, changes, newUser: !old });
  }

  // Units are the Services section, package profiles the Packages section, and
  // the NixOS version (in issue, os-release...) has its own line.
  const versionLabel: [string, string][] = plan.version ? [[plan.version.from, "<version>"], [plan.version.to, "<version>"]] : [];
  plan.etc = diffTrees(join(current, "etc"), join(built, "etc"), ["systemd/system", "systemd/user", "profiles"], versionLabel);

  plan.services = await nixosServices(current, built, opts.runner, opts.isRoot ?? isRoot());

  plan.reboot = ["kernel", "initrd"].some((name) => {
    const [a, b] = [realOrUndefined(join(current, name)), realOrUndefined(join(built, name))];
    return a !== undefined && b !== undefined && a !== b;
  });
  return plan;
}

/** NixOS's own dry run when sudo works without asking; otherwise an estimate. */
async function nixosServices(current: string, built: string, runner: NixPlanRunner, root: boolean): Promise<ServiceChanges> {
  const tool = join(built, "bin", "switch-to-configuration");
  if (existsSync(tool)) {
    const canSudo = root || (await runner.capture("sudo", ["-n", "true"])).code === 0;
    if (canSudo) {
      const result = await runner.capture(root ? tool : "sudo", root ? ["dry-activate"] : ["-n", tool, "dry-activate"]);
      if (result.code === 0) return parseDryActivate(`${result.stdout}\n${result.stderr}`);
    }
  }
  return estimateServices(current, built, runner);
}

function isRoot(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

// ---------------------------------------------------------------------------
// Building

/** The flake attribute of a NixOS host's system. */
export function nixosToplevel(outDir: string, host: string): string {
  return `path:${outDir.replace(/\\/g, "/")}#nixosConfigurations.${JSON.stringify(host)}.config.system.build.toplevel`;
}

/** What the build will do, before doing it. */
export async function dryRunBuild(installable: string, runner: NixPlanRunner): Promise<BuildSummary | undefined> {
  const result = await runner.capture("nix", [...NIX_FLAGS, "build", "--dry-run", "--no-link", installable]);
  if (result.code === 127) {
    throw new Error("Building a NixOS host needs Nix, which isn't installed here. `winix plan --no-build` shows the command switch would run.");
  }
  // An evaluation error surfaces again, in full, from the build.
  return result.code === 0 ? parseDryRun(result.stderr) : undefined;
}

/** Build into an out-link (a GC root until the next build) and return its store path. */
export async function buildSystem(installable: string, outLink: string, runner: NixPlanRunner): Promise<string> {
  await runner.run("nix", [...NIX_FLAGS, "build", "--out-link", outLink, installable]);
  return realpathSync(outLink);
}

export function describeBuild(summary: BuildSummary | undefined): string {
  if (!summary || (summary.build === 0 && summary.fetch === 0)) return "already built";
  const parts: string[] = [];
  if (summary.build > 0) parts.push(`${summary.build} to build`);
  if (summary.fetch > 0) parts.push(`${summary.fetch} to download${summary.download ? ` (${summary.download})` : ""}`);
  return parts.join(", ");
}

export const nativeNixPlanRunner: NixPlanRunner = {
  capture: (command, args) => new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => resolve({ code: 127, stdout, stderr: String(error) }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  }),
  run: (command, args) => new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.slice(NIX_FLAGS.length).join(" ")} failed (exit code ${code})`))));
  }),
};

// ---------------------------------------------------------------------------
// Output

const SECTION_LIMIT = 25;
const MARK: Record<string, [string, Style]> = {
  install: ["+", "green"], add: ["+", "green"], start: ["+", "green"],
  upgrade: ["~", "yellow"], downgrade: ["~", "yellow"], change: ["~", "yellow"], restart: ["~", "yellow"], reload: ["~", "yellow"],
  remove: ["-", "red"], stop: ["-", "red"],
};

interface Row { action: string; label: string; detail?: string }

function section(title: string, rows: Row[], paint: Paint, extra: string[] = []): string[] {
  if (rows.length === 0 && extra.length === 0) return [];
  const shown = rows.slice(0, SECTION_LIMIT);
  const actionWidth = Math.max(...shown.map((row) => row.action.length), 0);
  const labelWidth = Math.min(44, Math.max(...shown.map((row) => row.label.length), 0));
  const lines = [`  ${paint("bold", title)}`];
  for (const row of shown) {
    const [marker, style] = MARK[row.action] ?? ["~", "yellow"];
    const cells = [`    ${paint(style, marker)} ${paint(style, row.action.padEnd(actionWidth))}`, row.detail ? row.label.padEnd(labelWidth) : row.label];
    if (row.detail) cells.push(paint("dim", row.detail));
    lines.push(cells.join("  "));
  }
  if (rows.length > shown.length) lines.push(paint("dim", `    … and ${rows.length - shown.length} more`));
  for (const line of extra) lines.push(paint("dim", `    ${line}`));
  return lines;
}

/** Changes counted in the header. */
export function nixPlanChangeCount(plan: NixPlan): number {
  const services = plan.services;
  return plan.packages.length + plan.home.reduce((count, user) => count + user.changes.length, 0) + plan.etc.length +
    (services ? services.start.length + services.stop.length + services.restart.length + services.reload.length : 0);
}

export function formatNixPlan(plan: NixPlan, opts: { color?: boolean } = {}): string[] {
  const paint = painter(opts.color === true);
  const title = paint("bold", `Plan for ${plan.host}`);
  if (!plan.current) {
    return [`${title} (built; not compared: this machine isn't running NixOS)`];
  }
  if (plan.same) return [`${title}: no changes`];

  const count = nixPlanChangeCount(plan);
  const lines = [`${title}: ${count === 0 ? "no visible changes (the system was rebuilt)" : plural(count, "change")}`];
  if (plan.version) lines.push(paint("dim", `  NixOS ${plan.version.from} → ${plan.version.to}`));

  lines.push(...section("Packages", plan.packages.map((change) => ({
    action: change.action, label: change.name,
    detail: change.action === "install" ? change.to : change.action === "remove" ? change.from : `${change.from} → ${change.to}`,
  })), paint, plan.dependencies > 0 ? [`= ${plural(plan.dependencies, "dependency", "dependencies")} changed version`] : []));

  for (const user of plan.home) {
    const rows = user.newUser
      ? [{ action: "add", label: `${plural(user.changes.length, "file")} (first Home Manager generation)` }]
      : user.changes.map((change) => ({ action: change.action, label: change.path }));
    lines.push(...section(`Home files (${user.user})`, rows, paint));
  }
  lines.push(...section("/etc", plan.etc.map((change) => ({ action: change.action, label: change.path })), paint));

  const services = plan.services;
  if (services) {
    const rows: Row[] = [
      ...services.stop.map((unit) => ({ action: "stop", label: unit })),
      ...services.restart.map((unit) => ({ action: "restart", label: unit })),
      ...services.reload.map((unit) => ({ action: "reload", label: unit })),
      ...services.start.map((unit) => ({ action: "start", label: unit })),
    ];
    const extra = [
      ...(services.restartSystemd ? ["systemd restarts itself"] : []),
      ...(services.keep.length > 0 ? [`${plural(services.keep.length, "changed unit")} left running: ${services.keep.join(", ")}`] : []),
    ];
    lines.push(...section(services.estimated ? "Services (estimated: sudo needs a password)" : "Services", rows, paint, extra));
  }
  if (plan.reboot) lines.push("", `  ${paint("red", "!")} The kernel or initrd changes: restart the machine to use them.`);
  return lines;
}

/** The last line of `winix plan` for a NixOS host. */
export function nixPlanSummary(plan: NixPlan): string {
  if (!plan.current) return "Not compared with this machine; winix switch on that machine would show the plan.";
  if (plan.same) return "winix switch would change nothing.";
  const generation = plan.generation ? ` as generation ${plan.generation}` : "";
  return `winix switch would activate this${generation} (undo with sudo nixos-rebuild switch --rollback).`;
}
