// Plan view for Windows hosts: what `winix switch` would change, checked
// against the current machine where possible.

import { spawn } from "node:child_process";
import type { WindowsResourceCategory, WindowsResourceSummary } from "../backends/windows/index.ts";
import { compareWindowsPackageVersions, isComparableWindowsPackageVersion } from "./windows-package-versions.ts";
import type { ResourceSnapshot } from "./windows-state.ts";
import { painter, plural, type Style } from "./style.ts";

export type PlanState = "ok" | "change" | "conflict" | "unknown";

export interface PlannedResource {
  resource: WindowsResourceSummary;
  state: PlanState;
  /** Short verb: install, upgrade, apply, run, keep, check... */
  action: string;
  detail?: string;
  /** Processes running from this package's portable install (upgrades only). */
  running?: RunningProcess[];
  /** Why installing or upgrading this package will ask for administrator approval (UAC). */
  elevation?: string;
}

export interface ElevationRequest {
  id: string;
  source: string;
  action: "install" | "upgrade";
  /** Version to install; omitted for presence-only packages. */
  version?: string;
}

export interface RunningProcess {
  name: string;
  pid: number;
}

export type ScriptCheck = { ok: boolean } | { error: string };

/** Live machine checks. Tests substitute their own. */
export interface WindowsPlanChecker {
  /** Run test scripts, keyed by resource name. Never applies anything. */
  scripts(resources: WindowsResourceSummary[]): Promise<Map<string, ScriptCheck>>;
  /** `dsc config test` for non-script resources, keyed by resource name. */
  dsc(resources: WindowsResourceSummary[]): Promise<Map<string, ScriptCheck>>;
  /**
   * Processes started from winget portable installs of these packages, keyed by
   * package id. winget replaces portable files in place, so upgrading a running
   * one fails and can leave its command link removed.
   */
  running?(packageIds: string[]): Promise<Map<string, RunningProcess[]>>;
  /**
   * Packages whose install or upgrade will ask for administrator approval
   * (UAC), with the reason, keyed by package id. Upgrades keep the installed
   * scope; installs use the installer winget picks.
   */
  elevation?(requests: ElevationRequest[]): Promise<Map<string, string>>;
}

/** Ask the checker which installs/upgrades will prompt for UAC; advisory, so failures report nothing. */
export async function elevationPrompts(
  checker: WindowsPlanChecker | undefined, requests: ElevationRequest[],
): Promise<Map<string, string>> {
  if (!checker?.elevation || requests.length === 0) return new Map();
  try {
    return await checker.elevation(requests);
  } catch {
    return new Map();
  }
}

/** Ask the checker which packages are running; advisory, so failures report nothing. */
export async function runningPackages(
  checker: WindowsPlanChecker | undefined, packageIds: string[],
): Promise<Map<string, RunningProcess[]>> {
  if (!checker?.running || packageIds.length === 0) return new Map();
  try {
    return await checker.running(packageIds);
  } catch {
    return new Map();
  }
}

export function describeRunning(processes: RunningProcess[]): string {
  return processes.map((process) => `${process.name}, pid ${process.pid}`).join("; ");
}

export function runningPackagesError(running: Map<string, RunningProcess[]>): string {
  return [
    "Close these programs before switching; winget cannot upgrade a portable app while it runs, and a failed upgrade can remove its command:",
    ...[...running].map(([id, processes]) => `  ${id}: ${describeRunning(processes)}`),
  ].join("\n");
}

/**
 * Decide each resource's planned action. `packages` holds installed package
 * snapshots by package id (from the batched inventory); without a checker the
 * plan is static and only describes the declaration.
 */
export async function planWindowsResources(
  resources: WindowsResourceSummary[],
  packages: ReadonlyMap<string, ResourceSnapshot> | undefined,
  checker: WindowsPlanChecker | undefined,
): Promise<PlannedResource[]> {
  const scripts = resources.filter((resource) => resource.category !== "package" && resource.testScript !== undefined);
  const others = resources.filter((resource) => resource.category !== "package" && resource.testScript === undefined &&
    resource.category !== "command");
  // Independent processes; run them side by side.
  const [scriptChecks, dscChecks] = await Promise.all([
    checker && scripts.length > 0 ? checker.scripts(scripts) : new Map<string, ScriptCheck>(),
    checker && others.length > 0 ? checker.dsc(others) : new Map<string, ScriptCheck>(),
  ]);
  const planned = resources.map((resource): PlannedResource => {
    if (resource.package) {
      if (!packages) return { resource, state: "unknown", action: "check", detail: "not checked" };
      return packagePlan(resource, packages.has(resource.package.id) ? packages.get(resource.package.id)! : undefined);
    }
    if (resource.category === "command") {
      return { resource, state: "change", action: "run", detail: "raw commands run on every switch" };
    }
    const check = (resource.testScript !== undefined ? scriptChecks : dscChecks).get(resource.name);
    if (!check) return { resource, state: "unknown", action: "check", detail: "not checked" };
    if ("error" in check) {
      return {
        resource, state: "unknown", action: "check",
        detail: elevationError(check.error) || resource.needsElevationToCheck
          ? "needs an elevated shell to check" : `check failed: ${firstLine(check.error)}`,
      };
    }
    return check.ok ? { resource, state: "ok", action: "keep" } : { resource, state: "change", action: "apply" };
  });
  const upgrades = planned.filter((entry) => entry.resource.package && entry.action === "upgrade");
  const changing = planned.filter((entry) => entry.resource.package && (entry.action === "upgrade" || entry.action === "install"));
  const [running, prompts] = await Promise.all([
    runningPackages(checker, upgrades.map((entry) => entry.resource.package!.id)),
    elevationPrompts(checker, changing.map((entry) => {
      const pkg = entry.resource.package!;
      return { id: pkg.id, source: pkg.source, action: entry.action as "install" | "upgrade", version: pkg.version };
    })),
  ]);
  for (const entry of upgrades) {
    const processes = running.get(entry.resource.package!.id);
    if (processes?.length) entry.running = processes;
  }
  for (const entry of changing) {
    const reason = prompts.get(entry.resource.package!.id);
    if (reason) entry.elevation = reason;
  }
  return planned;
}

function packagePlan(resource: WindowsResourceSummary, snapshot: ResourceSnapshot | undefined): PlannedResource {
  const pkg = resource.package!;
  if (snapshot === undefined) return { resource, state: "unknown", action: "check", detail: "not in the inventory" };
  if (snapshot === null) {
    return { resource, state: "change", action: "install", detail: pkg.version ?? "latest available" };
  }
  if (!("version" in snapshot)) return { resource, state: "unknown", action: "check", detail: "invalid inventory" };
  const installed = snapshot.version;
  if (pkg.anyVersion) return { resource, state: "ok", action: "keep", detail: `${installed} (version: any)` };
  if (pkg.version === undefined) return { resource, state: "ok", action: "keep", detail: installed };
  if (!isComparableWindowsPackageVersion(installed)) {
    return pkg.exact
      ? { resource, state: "conflict", action: "conflict", detail: `installed version ${installed} cannot be compared with exact pin ${pkg.version}` }
      : { resource, state: "ok", action: "keep", detail: `installed version ${installed} cannot be compared; kept without enforcing ${pkg.version}` };
  }
  const order = compareWindowsPackageVersions(pkg.id, installed, pkg.version);
  if (order === 0) return { resource, state: "ok", action: "keep", detail: installed };
  if (order < 0) return { resource, state: "change", action: "upgrade", detail: `${installed} → ${pkg.version}` };
  return pkg.exact
    ? { resource, state: "conflict", action: "conflict", detail: `installed ${installed}, exact pin ${pkg.version}; switch fails rather than downgrade` }
    : { resource, state: "ok", action: "keep", detail: `${installed} (locked ${pkg.version}; switch offers to update the lock)` };
}

function elevationError(message: string): boolean {
  return /requires elevation|0x800702E4|access is denied|administrator/i.test(message);
}

function firstLine(message: string): string {
  return message.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? message;
}

const CATEGORY_NAMES: Record<WindowsResourceCategory, [string, string]> = {
  package: ["package", "packages"], file: ["file", "files"], startup: ["startup entry", "startup entries"],
  environment: ["environment variable", "environment variables"], settings: ["setting", "settings"],
  powershell: ["PowerShell", "PowerShell"], features: ["Windows feature set", "Windows feature sets"], wsl: ["WSL", "WSL"],
  fonts: ["font", "fonts"], command: ["command", "commands"], winix: ["Winix helper", "Winix helpers"], other: ["other", "other"],
};

const MARKERS: Record<PlanState, string> = { ok: "=", change: "~", conflict: "!", unknown: "?" };
const MARKER_STYLES: Record<string, Style> = { "+": "green", "~": "yellow", "!": "red", "?": "cyan", "=": "dim" };
/** Longest label that still sets the column width; longer ones just overflow it. */
const LABEL_COLUMN = 44;
const DETAIL_COLUMN = 28;

/**
 * Render a plan. `live` is false when nothing was checked against the machine.
 * `color` adds ANSI styling (interactive terminals only).
 */
export function formatWindowsPlan(
  host: string, planned: PlannedResource[], opts: { live: boolean; reason?: string; color?: boolean },
): string[] {
  const paint = painter(opts.color === true);
  if (!opts.live) {
    const lines = [paint("bold", `Plan for ${host}`) + ` (not checked against a machine${opts.reason ? `: ${opts.reason}` : ""})`];
    lines.push(`  Declares ${countByCategory(planned.map((entry) => entry.resource)) || "nothing"}.`);
    const elevated = planned.filter((entry) => entry.resource.elevated);
    if (elevated.length > 0) {
      lines.push("", `  ${paint("red", "!")} ${plural(elevated.length, "resource")} ${elevated.length === 1 ? "needs" : "need"} ` +
        "administrator rights; switch asks once (UAC).");
    }
    return lines;
  }

  const count = (state: PlanState) => planned.filter((entry) => entry.state === state).length;
  const changes = count("change");
  const parts = [changes === 0 ? "no changes" : plural(changes, "change")];
  if (count("conflict") > 0) parts.push(plural(count("conflict"), "conflict"));
  if (count("unknown") > 0) parts.push(`${count("unknown")} not checked`);
  parts.push(`${count("ok")} unchanged`);
  const lines = [`${paint("bold", `Plan for ${host}`)}: ${parts.join(", ")}`];

  const pending = planned.filter((entry) => entry.state !== "ok");
  const admin = (entry: PlannedResource) => entry.resource.elevated || entry.elevation !== undefined;
  const rows = pending.map((entry) => ({
    marker: entry.action === "install" ? "+" : MARKERS[entry.state],
    action: entry.action,
    label: entry.resource.package ? entry.resource.package.id : entry.resource.label,
    detail: entry.detail ?? "",
    tags: [
      ...(admin(entry) ? [paint("magenta", "[admin]")] : []),
      ...(entry.running?.length ? [paint("red", "[running]")] : []),
    ].join(" "),
  }));
  const width = (values: string[], cap: number) => Math.min(cap, Math.max(0, ...values.map((value) => value.length)));
  const actionWidth = width(rows.map((row) => row.action), Infinity);
  const labelWidth = width(rows.map((row) => row.label), LABEL_COLUMN);
  const detailWidth = rows.some((row) => row.tags) ? width(rows.map((row) => row.detail), DETAIL_COLUMN) : 0;
  for (const row of rows) {
    const cells = [
      `  ${paint(MARKER_STYLES[row.marker], row.marker)} ${paint(MARKER_STYLES[row.marker], row.action.padEnd(actionWidth))}`,
      row.label.padEnd(row.detail || row.tags ? labelWidth : 0),
      paint("dim", row.detail.padEnd(row.tags ? detailWidth : 0)),
      row.tags,
    ];
    lines.push(cells.filter((cell, index) => index < 2 || cell.length > 0).join("  ").trimEnd());
  }

  const unchanged = planned.filter((entry) => entry.state === "ok");
  if (unchanged.length > 0) {
    lines.push(paint("dim", `  = ${unchanged.length} unchanged (${countByCategory(unchanged.map((entry) => entry.resource))})`));
  }
  const newer = unchanged.filter((entry) => entry.resource.package && entry.detail?.includes("switch offers"));
  if (newer.length > 0) {
    lines.push(`  ${paint("cyan", "i")} ${plural(newer.length, "package")} newer than locked (kept; switch offers to update the lock): ` +
      newer.map((entry) => entry.resource.package!.id).join(", "));
  }

  const notes: string[] = [];
  const elevated = pending.filter(admin);
  if (elevated.length > 0) {
    const reasons = elevated.filter((entry) => entry.elevation)
      .map((entry) => `${entry.resource.package!.id}: ${entry.elevation}`);
    notes.push(`Switch asks once for administrator approval (UAC) for the ` +
      `${elevated.length === 1 ? "[admin] row" : `${elevated.length} [admin] rows`}` +
      `${reasons.length > 0 ? ` (${reasons.join("; ")})` : ""}.`);
  }
  for (const entry of pending.filter((candidate) => candidate.running?.length)) {
    const processes = entry.running!.map((process) => `${process.name} (pid ${process.pid})`).join(", ");
    notes.push(`Close ${processes} before switching: winget cannot upgrade a running portable app ` +
      `(${entry.resource.package!.id}), and a failed upgrade can remove its command.`);
  }
  const reboot = pending.filter((entry) => entry.resource.reboot);
  if (reboot.length > 0) {
    notes.push(`${reboot.map((entry) => entry.resource.label).join(", ")} can require a Windows restart; Winix never restarts Windows.`);
  }
  if (notes.length > 0) lines.push("", ...notes.map((note) => `  ${paint("red", "!")} ${note}`));
  return lines;
}

function countByCategory(resources: WindowsResourceSummary[]): string {
  const counts = new Map<WindowsResourceCategory, number>();
  for (const resource of resources) counts.set(resource.category, (counts.get(resource.category) ?? 0) + 1);
  return [...counts].sort(([, left], [, right]) => right - left)
    .map(([category, count]) => `${count} ${CATEGORY_NAMES[category][count === 1 ? 0 : 1]}`).join(", ");
}

const PROBE_MARKER = "WINIX-PLAN:";

/**
 * Runs every test script in one PowerShell process, each in its own scope, so
 * one failing check (e.g. Windows features without elevation) does not hide
 * the others the way a single `dsc config test` run would.
 */
const SCRIPT_PROBE = `$ErrorActionPreference = 'Stop'
$items = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json
$results = @(foreach ($item in $items) {
  try {
    $output = @(& ([scriptblock]::Create($item.script)) 2>$null 3>$null 4>$null 5>$null 6>$null)
    $last = if ($output.Count -gt 0) { $output[-1] } else { $null }
    [pscustomobject]@{ name = $item.name; ok = ($last -eq $true) }
  } catch {
    [pscustomobject]@{ name = $item.name; error = $_.Exception.Message }
  }
})
'${PROBE_MARKER}' + (ConvertTo-Json -InputObject $results -Compress -Depth 3)`;

export const nativeWindowsPlanChecker: WindowsPlanChecker = {
  async scripts(resources) {
    const results = new Map<string, ScriptCheck>();
    const groups = new Map<string, WindowsResourceSummary[]>();
    for (const resource of resources) {
      const shell = resource.shell ?? "pwsh";
      groups.set(shell, [...(groups.get(shell) ?? []), resource]);
    }
    await Promise.all([...groups].map(async ([shell, group]) => {
      try {
        const output = await capture(shell, [
          "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(SCRIPT_PROBE, "utf16le").toString("base64"),
        ], Buffer.from(JSON.stringify(group.map((resource) => ({
          name: resource.name, script: resource.testScript,
        })))).toString("base64"), 600000);
        for (const [name, check] of parseProbeOutput(output)) results.set(name, check);
      } catch (error) {
        for (const resource of group) results.set(resource.name, { error: (error as Error).message });
      }
    }));
    return results;
  },
  async dsc(resources) {
    const results = new Map<string, ScriptCheck>();
    try {
      for (const [name, check] of await dscTest(resources)) results.set(name, check);
    } catch (error) {
      // One failing resource aborts a whole DSC run; check the rest one by one.
      if (resources.length === 1) {
        results.set(resources[0].name, { error: (error as Error).message });
        return results;
      }
      await Promise.all(resources.map(async (resource) => {
        try {
          for (const [name, check] of await dscTest([resource])) results.set(name, check);
        } catch (single) {
          results.set(resource.name, { error: (single as Error).message });
        }
      }));
    }
    return results;
  },
  async running(packageIds) {
    const output = await capture("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(RUNNING_PROBE, "utf16le").toString("base64"),
    ], Buffer.from(JSON.stringify(packageIds)).toString("base64"), 60000);
    return parseRunningOutput(output);
  },
  async elevation(requests) {
    const prompts = new Map<string, string>();
    // winget serializes its own work; ask one package at a time.
    for (const request of requests) {
      const reason = request.action === "upgrade"
        ? upgradeElevation((await runWinget(["list", "--id", request.id, "--exact", "--details", "--source", request.source])).stdout)
        : installElevation(
          await runWinget(showArgs(request)),
          await runWinget([...showArgs(request), "--scope", "user"]),
        );
      if (reason) prompts.set(request.id, reason);
    }
    return prompts;
  },
};

function showArgs(request: ElevationRequest): string[] {
  return ["show", "--id", request.id, "--exact", "--source", request.source,
    ...(request.version ? ["--version", request.version] : [])];
}

async function runWinget(args: string[]): Promise<{ code: number | null; stdout: string }> {
  return run("winget", [...args, "--disable-interactivity", "--accept-source-agreements"], 120000);
}

/** Upgrades keep the installed scope, so a machine-wide install asks for UAC again. */
export function upgradeElevation(listDetails: string): string | undefined {
  const scope = /^\s*Installed Scope:\s*(\S+)/m.exec(listDetails)?.[1];
  return scope?.toLowerCase() === "machine" ? "installed machine-wide" : undefined;
}

/**
 * Installs use the installer winget picks; compare it with the per-user one.
 * `show` output without an installer line (another language, an error) reports nothing.
 */
export function installElevation(
  chosen: { code: number | null; stdout: string }, user: { code: number | null; stdout: string },
): string | undefined {
  const url = (output: string) => /^\s*Installer Url:\s*(\S+)/m.exec(output)?.[1];
  const chosenUrl = url(chosen.stdout);
  if (!chosenUrl) return undefined;
  const userUrl = url(user.stdout);
  if (!userUrl) return /No applicable installer/i.test(user.stdout) ? "no per-user installer" : undefined;
  return userUrl === chosenUrl ? undefined : "winget picks its machine-wide installer";
}

/** Run a command to completion, resolving its exit code and stdout. */
function run(command: string, args: string[], timeout: number): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.resume();
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout }); });
  });
}

const RUNNING_MARKER = "WINIX-RUNNING:";

/**
 * winget portable installs live in <root>\WinGet\Packages\<id>_<source>, and their
 * commands are symlinks in ...\WinGet\Links. Match running processes (through
 * those links) against each package's directories.
 */
const RUNNING_PROBE = `$ErrorActionPreference = 'Stop'
$ids = @([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd())) | ConvertFrom-Json)
$roots = @(
  (Join-Path $env:LOCALAPPDATA 'Microsoft\\WinGet\\Packages'),
  (Join-Path $env:ProgramFiles 'WinGet\\Packages'),
  (Join-Path \${env:ProgramFiles(x86)} 'WinGet\\Packages')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_ -PathType Container) }
$directories = @(foreach ($id in $ids) {
  foreach ($root in $roots) {
    foreach ($entry in @(Get-ChildItem -LiteralPath $root -Directory -ErrorAction SilentlyContinue)) {
      if ($entry.Name.StartsWith($id + '_', [StringComparison]::OrdinalIgnoreCase)) {
        [pscustomobject]@{ id = $id; path = $entry.FullName.TrimEnd('\\') + '\\' }
      }
    }
  }
})
$found = @()
if ($directories.Count -gt 0) {
  $found = @(foreach ($process in @(Get-Process -ErrorAction SilentlyContinue)) {
    $path = $null
    try { $path = $process.Path } catch { }
    if (-not $path) { continue }
    try {
      $item = Get-Item -LiteralPath $path -Force -ErrorAction Stop
      if ($item.LinkType -eq 'SymbolicLink' -and $item.Target) {
        $target = @($item.Target)[0]
        $path = if ([IO.Path]::IsPathRooted($target)) { $target } else { Join-Path $item.DirectoryName $target }
      }
    } catch { }
    foreach ($directory in $directories) {
      if ($path.StartsWith($directory.path, [StringComparison]::OrdinalIgnoreCase)) {
        [pscustomobject]@{ id = $directory.id; name = [IO.Path]::GetFileName($path); pid = $process.Id }
      }
    }
  })
}
'${RUNNING_MARKER}' + (ConvertTo-Json -InputObject $found -Compress -Depth 3)`;

export function parseRunningOutput(output: string): Map<string, RunningProcess[]> {
  const line = output.split(/\r?\n/).map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(RUNNING_MARKER));
  if (!line) throw new Error("running-process probe printed no result");
  const parsed = JSON.parse(line.slice(RUNNING_MARKER.length)) as unknown;
  const items = Array.isArray(parsed) ? parsed : parsed === null ? [] : [parsed];
  const running = new Map<string, RunningProcess[]>();
  for (const item of items as { id?: unknown; name?: unknown; pid?: unknown }[]) {
    if (typeof item?.id !== "string" || typeof item.name !== "string" || typeof item.pid !== "number") continue;
    running.set(item.id, [...(running.get(item.id) ?? []), { name: item.name, pid: item.pid }]);
  }
  return running;
}

/** Run a command with stdin, resolving stdout; errors carry stderr. */
function capture(command: string, args: string[], input: string, timeout: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["pipe", "pipe", "pipe"], windowsHide: true });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`${command} timed out`)); }, timeout);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code}`));
    });
    child.stdin.end(input);
  });
}

export function parseProbeOutput(output: string): Map<string, ScriptCheck> {
  const line = output.split(/\r?\n/).find((entry) => entry.startsWith(PROBE_MARKER));
  if (!line) throw new Error("PowerShell plan probe returned no result");
  const parsed: unknown = JSON.parse(line.slice(PROBE_MARKER.length));
  const entries = Array.isArray(parsed) ? parsed : [parsed];
  const results = new Map<string, ScriptCheck>();
  for (const entry of entries) {
    if (!entry || typeof entry !== "object" || typeof (entry as { name?: unknown }).name !== "string") continue;
    const { name, ok, error } = entry as { name: string; ok?: unknown; error?: unknown };
    results.set(name, typeof error === "string" ? { error } : { ok: ok === true });
  }
  return results;
}

async function dscTest(resources: WindowsResourceSummary[]): Promise<Map<string, ScriptCheck>> {
  const document = {
    $schema: "https://aka.ms/dsc/schemas/v3/bundled/config/document.json",
    resources: resources.map((resource) => ({ name: resource.name, type: resource.type, properties: resource.properties ?? {} })),
  };
  const output = await capture("dsc", ["config", "test", "--file", "-"], JSON.stringify(document), 60000 + resources.length * 30000);
  return parseDscTestOutput(JSON.parse(output));
}

export function parseDscTestOutput(output: unknown): Map<string, ScriptCheck> {
  const results = new Map<string, ScriptCheck>();
  if (!output || typeof output !== "object" || !Array.isArray((output as { results?: unknown }).results)) {
    throw new Error("Invalid dsc config test response");
  }
  for (const entry of (output as { results: unknown[] }).results) {
    if (!entry || typeof entry !== "object") continue;
    const { name, result } = entry as { name?: unknown; result?: { inDesiredState?: unknown } };
    if (typeof name !== "string" || !result || typeof result !== "object") continue;
    results.set(name, { ok: result.inDesiredState === true });
  }
  return results;
}
