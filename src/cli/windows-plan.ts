// Plan view for Windows hosts: what `winix switch` would change, checked
// against the current machine where possible.

import { spawn } from "node:child_process";
import type { WindowsResourceCategory, WindowsResourceSummary } from "../backends/windows/index.ts";
import { compareWindowsPackageVersions, isComparableWindowsPackageVersion } from "./windows-package-versions.ts";
import type { ResourceSnapshot } from "./windows-state.ts";

export type PlanState = "ok" | "change" | "conflict" | "unknown";

export interface PlannedResource {
  resource: WindowsResourceSummary;
  state: PlanState;
  /** Short verb: install, upgrade, apply, run, keep, check... */
  action: string;
  detail?: string;
}

export type ScriptCheck = { ok: boolean } | { error: string };

/** Live machine checks. Tests substitute their own. */
export interface WindowsPlanChecker {
  /** Run test scripts, keyed by resource name. Never applies anything. */
  scripts(resources: WindowsResourceSummary[]): Promise<Map<string, ScriptCheck>>;
  /** `dsc config test` for non-script resources, keyed by resource name. */
  dsc(resources: WindowsResourceSummary[]): Promise<Map<string, ScriptCheck>>;
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
  return resources.map((resource): PlannedResource => {
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
  if (order < 0) return { resource, state: "change", action: "upgrade", detail: `${installed} -> ${pkg.version}` };
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

const CATEGORY_NAMES: Record<WindowsResourceCategory, string> = {
  package: "packages", file: "files", startup: "startup shortcuts", environment: "environment",
  settings: "settings", powershell: "PowerShell", features: "Windows features", wsl: "WSL",
  fonts: "fonts", command: "commands", winix: "Winix helpers", other: "other",
};

const MARKERS: Record<PlanState, string> = { ok: "=", change: "~", conflict: "!", unknown: "?" };

/** Render a plan. `live` is false when nothing was checked against the machine. */
export function formatWindowsPlan(
  host: string, planned: PlannedResource[], opts: { live: boolean; reason?: string },
): string[] {
  const lines = [opts.live
    ? `Plan for ${host} (checked against this machine):`
    : `Plan for ${host} (not checked against a machine${opts.reason ? `: ${opts.reason}` : ""}):`];
  if (!opts.live) {
    const counts = countByCategory(planned.map((entry) => entry.resource));
    lines.push(`  Declares ${counts || "nothing"}.`);
  } else {
    const changes = planned.filter((entry) => entry.state !== "ok");
    const width = Math.max(0, ...changes.map((entry) => entry.action.length));
    for (const entry of changes) {
      const marker = entry.action === "install" ? "+" : MARKERS[entry.state];
      const label = entry.resource.package ? entry.resource.package.id : entry.resource.label;
      lines.push(`  ${marker} ${entry.action.padEnd(width)}  ${label}${entry.detail ? `  (${entry.detail})` : ""}`);
    }
    const unchanged = planned.filter((entry) => entry.state === "ok");
    if (unchanged.length > 0) {
      lines.push(`  = ${unchanged.length} unchanged (${countByCategory(unchanged.map((entry) => entry.resource))})`);
    }
    const newer = unchanged.filter((entry) => entry.resource.package && entry.detail?.includes("switch offers"));
    if (newer.length > 0) {
      lines.push(`  i ${newer.length} package(s) newer than locked; switch keeps them and offers to update the lock: ` +
        newer.map((entry) => entry.resource.package!.id).join(", "));
    }
  }
  const pending = opts.live ? planned.filter((entry) => entry.state !== "ok") : planned;
  const elevated = pending.filter((entry) => entry.resource.elevated);
  if (elevated.length > 0) {
    lines.push(`  ! ${elevated.length} ${opts.live ? "change(s)" : "resource(s)"} run elevated; run switch from an elevated shell: ` +
      elevated.map((entry) => entry.resource.package?.id ?? entry.resource.label).join(", "));
  }
  const reboot = pending.filter((entry) => entry.resource.reboot);
  if (reboot.length > 0) {
    lines.push(`  ! ${reboot.map((entry) => entry.resource.label).join(", ")} can require a Windows restart; Winix never restarts Windows.`);
  }
  if (opts.live) {
    const count = (state: PlanState) => planned.filter((entry) => entry.state === state).length;
    const parts = [`${count("change")} to change`];
    if (count("conflict") > 0) parts.push(`${count("conflict")} conflict(s)`);
    if (count("unknown") > 0) parts.push(`${count("unknown")} not checked`);
    parts.push(`${count("ok")} unchanged`);
    lines.push(`  Summary: ${parts.join(", ")}.`);
  }
  return lines;
}

function countByCategory(resources: WindowsResourceSummary[]): string {
  const counts = new Map<WindowsResourceCategory, number>();
  for (const resource of resources) counts.set(resource.category, (counts.get(resource.category) ?? 0) + 1);
  return [...counts].map(([category, count]) => `${CATEGORY_NAMES[category]}: ${count}`).join(", ");
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
      const shell = resource.type === "Microsoft.DSC.Transitional/WindowsPowerShellScript" ? "powershell" : "pwsh";
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
};

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
