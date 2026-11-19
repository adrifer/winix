// Applies a Windows plan: only the resources the plan found out of date, in
// dependency order, with everything that needs administrator rights collected
// into as few elevated steps as possible (one UAC prompt in the usual case).
//
// One PowerShell runner executes a batch of steps:
//   - packages:            winget install / upgrade
//   - PowerShell scripts:  test → set → test again (Windows PowerShell scripts in powershell.exe)
//   - other DSC resources: dsc config set (one resource per call)
//   - raw commands:        run as given
// A step whose dependency failed is skipped. User batches run as a normal
// child process; elevated batches run the same runner through one UAC prompt.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WindowsResourceSummary } from "../backends/windows/index.ts";
import type { PlannedResource } from "./windows-plan.ts";

export type ApplyStepKind = "package" | "script" | "dsc" | "command";

export interface ApplyStep {
  name: string;
  label: string;
  kind: ApplyStepKind;
  elevated: boolean;
  /** Pending steps this one must wait for (names). */
  dependsOn: string[];
  /** package */
  package?: { id: string; source: string; version?: string; action: "install" | "upgrade" };
  /** script */
  shell?: "pwsh" | "powershell";
  testScript?: string;
  setScript?: string;
  /** dsc */
  dsc?: { type: string; properties: unknown };
  /** command */
  command?: { executable: string; arguments: string[] };
}

export interface ApplyBatch {
  elevated: boolean;
  steps: ApplyStep[];
}

export type StepStatus = "applied" | "unchanged" | "failed" | "skipped";

export interface StepResult {
  name: string;
  status: StepStatus;
  error?: string;
}

/** Runs one batch; tests substitute their own. */
export interface WindowsBatchRunner {
  run(batch: ApplyBatch, log: (line: string) => void): Promise<StepResult[]>;
}

export interface ApplyResult {
  results: StepResult[];
  failed: StepResult[];
}

/**
 * Turn a plan into ordered batches. `elevation` holds the packages whose
 * install or upgrade asks for administrator approval (machine-wide scope, or no
 * per-user installer); they join the elevated batch so the user approves once.
 */
export function planApplyBatches(
  planned: PlannedResource[], elevation: ReadonlyMap<string, string> = new Map(),
): ApplyBatch[] {
  const conflicts = planned.filter((entry) => entry.state === "conflict");
  if (conflicts.length > 0) {
    throw new Error("Refusing to switch with conflicts:\n" +
      conflicts.map((entry) => `  ${entry.resource.package?.id ?? entry.resource.label}: ${entry.detail ?? "conflict"}`).join("\n"));
  }
  const pending = new Map<string, ApplyStep>();
  for (const entry of planned) {
    const step = stepFor(entry, elevation);
    if (step) pending.set(step.name, step);
  }
  // Wait only for dependencies that are themselves pending; the rest already hold.
  const byName = new Map(planned.map((entry) => [entry.resource.name, entry.resource]));
  for (const step of pending.values()) {
    step.dependsOn = pendingDependencies(step.name, byName, pending);
  }
  return orderBatches([...pending.values()]);
}

function stepFor(entry: PlannedResource, elevation: ReadonlyMap<string, string>): ApplyStep | undefined {
  const resource = entry.resource;
  const base = { name: resource.name, label: resource.package?.id ?? resource.label, dependsOn: [] as string[] };
  if (resource.package) {
    if (entry.state !== "change" || (entry.action !== "install" && entry.action !== "upgrade")) return undefined;
    const pkg = resource.package;
    return {
      ...base, kind: "package", elevated: resource.elevated || elevation.has(pkg.id),
      package: { id: pkg.id, source: pkg.source, version: pkg.version, action: entry.action },
    };
  }
  if (entry.state === "ok") return undefined;
  // Unknown (not checked, or needs elevation to check): the runner tests first.
  if (resource.command) return { ...base, kind: "command", elevated: resource.elevated, command: resource.command };
  if (resource.testScript !== undefined && resource.setScript !== undefined) {
    return {
      ...base, kind: "script", elevated: resource.elevated, shell: resource.shell ?? "pwsh",
      testScript: resource.testScript, setScript: resource.setScript,
    };
  }
  return { ...base, kind: "dsc", elevated: resource.elevated, dsc: { type: resource.type, properties: resource.properties ?? {} } };
}

/** Pending resources this one depends on, through dependencies that are already in place. */
function pendingDependencies(
  name: string, byName: ReadonlyMap<string, WindowsResourceSummary>, pending: ReadonlyMap<string, ApplyStep>,
): string[] {
  const found = new Set<string>();
  const seen = new Set<string>([name]);
  const visit = (current: string) => {
    for (const dependency of byName.get(current)?.dependsOn ?? []) {
      if (seen.has(dependency)) continue;
      seen.add(dependency);
      if (pending.has(dependency)) found.add(dependency);
      else visit(dependency);
    }
  };
  visit(name);
  return [...found];
}

/**
 * Topological order that keeps privilege changes rare: run every step that is
 * ready in the current context before switching to the other one. In practice
 * this yields at most one elevated batch.
 */
export function orderBatches(steps: ApplyStep[]): ApplyBatch[] {
  const remaining = new Map(steps.map((step) => [step.name, step]));
  const done = new Set<string>();
  const batches: ApplyBatch[] = [];
  let elevated = false;
  while (remaining.size > 0) {
    const ready = (wantElevated: boolean) => [...remaining.values()].filter((step) =>
      step.elevated === wantElevated && step.dependsOn.every((dependency) => done.has(dependency) || !remaining.has(dependency)));
    let next = ready(elevated);
    if (next.length === 0) {
      elevated = !elevated;
      next = ready(elevated);
    }
    if (next.length === 0) {
      throw new Error("Windows resources have a dependency cycle: " + [...remaining.keys()].join(", "));
    }
    // Drain the current context completely before switching.
    const batch: ApplyStep[] = [];
    while (next.length > 0) {
      for (const step of next) {
        batch.push(step);
        remaining.delete(step.name);
        done.add(step.name);
      }
      next = ready(elevated);
    }
    const last = batches.at(-1);
    if (last && last.elevated === elevated) last.steps.push(...batch);
    else batches.push({ elevated, steps: batch });
  }
  return batches;
}

/** Run the batches in order; a failure skips everything that depends on it, later batches included. */
export async function applyWindowsBatches(
  batches: ApplyBatch[], runner: WindowsBatchRunner, log: (line: string) => void = console.log,
): Promise<ApplyResult> {
  const results: StepResult[] = [];
  const failed = new Set<string>();
  for (const batch of batches) {
    const runnable: ApplyStep[] = [];
    for (const step of batch.steps) {
      if (step.dependsOn.some((dependency) => failed.has(dependency))) {
        failed.add(step.name);
        results.push({ name: step.name, status: "skipped", error: "a dependency failed" });
        log(`  - skipped  ${step.label} (a dependency failed)`);
      } else runnable.push(step);
    }
    if (runnable.length === 0) continue;
    if (batch.elevated) {
      log(`Applying ${runnable.length} change(s) that need administrator rights; approve the UAC prompt (it can open behind other windows).`);
    }
    let batchResults: StepResult[];
    try {
      batchResults = await runner.run({ elevated: batch.elevated, steps: runnable }, log);
    } catch (error) {
      batchResults = runnable.map((step) => ({ name: step.name, status: "failed" as const, error: (error as Error).message }));
    }
    for (const result of batchResults) {
      if (result.status === "failed" || result.status === "skipped") failed.add(result.name);
      results.push(result);
    }
  }
  return { results, failed: results.filter((result) => result.status === "failed" || result.status === "skipped") };
}

export function formatApplySummary(result: ApplyResult, labels: ReadonlyMap<string, string>): string[] {
  const count = (status: StepStatus) => result.results.filter((entry) => entry.status === status).length;
  const lines = [`Applied ${count("applied")}, already in place ${count("unchanged")}, failed ${count("failed")}, skipped ${count("skipped")}.`];
  for (const entry of result.failed) {
    lines.push(`  ✗ ${labels.get(entry.name) ?? entry.name}: ${entry.error ?? entry.status}`);
  }
  return lines;
}

const RESULT_MARKER = "WINIX-APPLY:";

/**
 * The PowerShell 7 runner. Arguments: steps JSON file, results JSON file, log
 * file. It logs progress lines to the log file (read live by Winix, also in
 * the elevated case where output cannot be piped) and writes one result per
 * step. Every step is isolated: an error marks that step failed and skips its
 * dependents.
 */
export const WINDOWS_APPLY_RUNNER = String.raw`param([string]$StepsFile, [string]$ResultsFile, [string]$LogFile)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$utf8 = [Text.UTF8Encoding]::new($false)
function Write-WinixLog([string]$Line) { [IO.File]::AppendAllText($LogFile, $Line + [Environment]::NewLine, $utf8) }
function Test-WinixScript([scriptblock]$Test) {
  $output = @(& $Test 2>$null 3>$null 4>$null 5>$null 6>$null)
  return $output.Count -gt 0 -and $output[-1] -eq $true
}
function Invoke-WinixNative([string]$Executable, [string[]]$Arguments) {
  $lines = @(& $Executable @Arguments 2>&1 | ForEach-Object { "$_" })
  return [pscustomobject]@{ Code = $LASTEXITCODE; Lines = $lines }
}
function Get-WinixTail([string[]]$Lines) {
  $useful = @($Lines | ForEach-Object { $_.Trim() } | Where-Object { $_ -and $_ -notmatch '^[\s\-\\|/]+$' -and $_ -notmatch '^[█▒\s]+' })
  return ($useful | Select-Object -Last 3) -join ' | '
}
function Invoke-WinixWindowsPowerShell([string]$Directory, [string]$Name, [string]$Script, [bool]$IsTest) {
  $file = Join-Path $Directory ($Name + '.ps1')
  [IO.File]::WriteAllText($file, $Script, [Text.UTF8Encoding]::new($true))
  if ($IsTest) {
    $command = '$o = @(& ''' + $file.Replace("'", "''") + ''' 2>$null); if ($o.Count -gt 0 -and $o[-1] -eq $true) { exit 0 } else { exit 3 }'
    & powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command $command *> $null
    return $LASTEXITCODE -eq 0
  }
  $lines = @(& powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $file *>&1 | ForEach-Object { "$_" })
  foreach ($line in $lines) { Write-WinixLog ('      ' + $line) }
  if ($LASTEXITCODE -ne 0) { throw "Windows PowerShell exited with code $LASTEXITCODE" }
}

$steps = @([IO.File]::ReadAllText($StepsFile) | ConvertFrom-Json)
$scratch = Join-Path ([IO.Path]::GetTempPath()) ('winix-apply-' + [guid]::NewGuid().ToString('N'))
[IO.Directory]::CreateDirectory($scratch) | Out-Null
$failed = [Collections.Generic.HashSet[string]]::new()
$results = [Collections.Generic.List[object]]::new()
try {
  foreach ($step in $steps) {
    $blocked = @($step.dependsOn | Where-Object { $failed.Contains($_) })
    if ($blocked.Count -gt 0) {
      [void]$failed.Add($step.name)
      $results.Add([pscustomobject]@{ name = $step.name; status = 'skipped'; error = 'a dependency failed' })
      Write-WinixLog ("  - skipped  " + $step.label + " (a dependency failed)")
      continue
    }
    $started = Get-Date
    $status = 'applied'
    try {
      switch ($step.kind) {
        'package' {
          $verb = if ($step.package.action -eq 'upgrade') { 'upgrade' } else { 'install' }
          Write-WinixLog ("  ~ " + $verb + "  " + $step.package.id + $(if ($step.package.version) { ' ' + $step.package.version } else { '' }))
          $arguments = @($verb, '--id', $step.package.id, '--exact', '--source', $step.package.source,
            '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity')
          if ($step.package.version) { $arguments += @('--version', $step.package.version) }
          $run = Invoke-WinixNative 'winget' $arguments
          if ($run.Code -ne 0) { throw ("winget " + $verb + " exited with code " + $run.Code + ": " + (Get-WinixTail $run.Lines)) }
        }
        'script' {
          if ($step.shell -eq 'powershell') {
            if (Invoke-WinixWindowsPowerShell $scratch ($step.name + '-test') $step.testScript $true) { $status = 'unchanged'; break }
            Write-WinixLog ("  ~ apply  " + $step.label)
            Invoke-WinixWindowsPowerShell $scratch ($step.name + '-set') $step.setScript $false
            if (-not (Invoke-WinixWindowsPowerShell $scratch ($step.name + '-test') $step.testScript $true)) { throw 'still not in the desired state after applying' }
          } else {
            $test = [scriptblock]::Create($step.testScript)
            if (Test-WinixScript $test) { $status = 'unchanged'; break }
            Write-WinixLog ("  ~ apply  " + $step.label)
            & ([scriptblock]::Create($step.setScript)) *>&1 | ForEach-Object { Write-WinixLog ('      ' + "$_") }
            if (-not (Test-WinixScript $test)) { throw 'still not in the desired state after applying' }
          }
        }
        'dsc' {
          Write-WinixLog ("  ~ apply  " + $step.label)
          $document = @{
            '$schema' = 'https://aka.ms/dsc/schemas/v3/bundled/config/document.json'
            resources = @(@{ name = $step.name; type = $step.dsc.type; properties = $step.dsc.properties })
          } | ConvertTo-Json -Depth 32 -Compress
          $run = $document | & dsc --trace-level error config set --file - 2>&1 | ForEach-Object { "$_" }
          if ($LASTEXITCODE -ne 0) { throw ("dsc config set exited with code " + $LASTEXITCODE + ": " + (Get-WinixTail @($run))) }
        }
        'command' {
          Write-WinixLog ("  ~ run    " + $step.label)
          $run = Invoke-WinixNative $step.command.executable @($step.command.arguments)
          foreach ($line in $run.Lines) { Write-WinixLog ('      ' + $line) }
          if ($run.Code -ne 0) { throw ("exited with code " + $run.Code) }
        }
        default { throw ("unknown step kind: " + $step.kind) }
      }
      $results.Add([pscustomobject]@{ name = $step.name; status = $status })
      if ($status -eq 'applied') { Write-WinixLog ("    ✓ " + $step.label + " (" + [int]((Get-Date) - $started).TotalSeconds + "s)") }
    } catch {
      [void]$failed.Add($step.name)
      $message = $_.Exception.Message
      $results.Add([pscustomobject]@{ name = $step.name; status = 'failed'; error = $message })
      Write-WinixLog ("    ✗ " + $step.label + ": " + $message)
    }
  }
} finally {
  [IO.File]::WriteAllText($ResultsFile, ('${RESULT_MARKER}' + (ConvertTo-Json -InputObject @($results) -Depth 4 -Compress)), $utf8)
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
`;

export function parseApplyResults(text: string): StepResult[] {
  const start = text.indexOf(RESULT_MARKER);
  if (start < 0) throw new Error("the apply runner wrote no results");
  const parsed = JSON.parse(text.slice(start + RESULT_MARKER.length)) as unknown;
  const items = Array.isArray(parsed) ? parsed : [parsed];
  return items.map((item) => {
    const { name, status, error } = item as { name?: unknown; status?: unknown; error?: unknown };
    if (typeof name !== "string" || !["applied", "unchanged", "failed", "skipped"].includes(status as string)) {
      throw new Error("the apply runner wrote an invalid result");
    }
    return { name, status: status as StepStatus, ...(typeof error === "string" ? { error } : {}) };
  });
}

/**
 * Runs batches with PowerShell 7. User batches are a normal child process;
 * elevated batches start the same runner with `Start-Process -Verb RunAs`
 * (one UAC prompt) and stream its log file.
 */
export const nativeWindowsBatchRunner: WindowsBatchRunner = {
  async run(batch, log) {
    const directory = await mkdtemp(join(tmpdir(), "winix-switch-"));
    const files = {
      runner: join(directory, "apply.ps1"),
      steps: join(directory, "steps.json"),
      results: join(directory, "results.json"),
      log: join(directory, "apply.log"),
    };
    try {
      await writeFile(files.runner, "﻿" + WINDOWS_APPLY_RUNNER, "utf8");
      await writeFile(files.steps, JSON.stringify(batch.steps), "utf8");
      await writeFile(files.log, "", "utf8");
      const runnerArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
        "-File", files.runner, files.steps, files.results, files.log];
      const tail = tailFile(files.log, log);
      try {
        if (batch.elevated) {
          const quoted = runnerArgs.map((arg) => `'${arg.replaceAll("'", "''")}'`).join(",");
          await exec("pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
            `$p = Start-Process -FilePath (Get-Command pwsh).Source -Verb RunAs -WindowStyle Hidden -Wait -PassThru -ArgumentList @(${quoted}); exit $p.ExitCode`]);
        } else {
          await exec("pwsh", runnerArgs);
        }
      } finally {
        await tail.stop();
      }
      if (!existsSync(files.results)) throw new Error("the apply runner did not finish");
      return parseApplyResults(await readFile(files.results, "utf8"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  },
};

function exec(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"], windowsHide: true });
    let stderr = "";
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else if (/canceled by the user|cancelled by the user/i.test(stderr)) {
        reject(new Error("the administrator approval (UAC) was declined"));
      } else reject(new Error(stderr.trim().split(/\r?\n/).at(-1) || `${command} exited with code ${code}`));
    });
  });
}

/** Print new lines of a file as they are written, until stopped. */
function tailFile(path: string, log: (line: string) => void): { stop(): Promise<void> } {
  let offset = 0;
  let pending = "";
  const read = async () => {
    let text: string;
    try { text = await readFile(path, "utf8"); } catch { return; }
    if (text.length <= offset) return;
    pending += text.slice(offset);
    offset = text.length;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line) log(line);
  };
  let reading = Promise.resolve();
  const timer = setInterval(() => { reading = reading.then(read); }, 250);
  return {
    async stop() {
      clearInterval(timer);
      await reading;
      await read();
      if (pending) log(pending);
    },
  };
}
