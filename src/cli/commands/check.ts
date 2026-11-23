// winix check — validate configuration

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix, type NixOutput } from "../../backends/nix/index.ts";
import { validateWindowsWslResources } from "../../backends/windows/index.ts";
import { validateWindowsWslSetupTargets } from "../../backends/windows/wsl-setup-runtime.ts";
import type { WindowsOptions } from "../../types/index.ts";
import { readWindowsLock, windowsLockPinGaps, type WindowsLockGap } from "../../backends/windows/lockfile.ts";
import { platformForEvaluatedHost } from "../activation.ts";
import {
  analyzeWorkspace,
  collectEscapeReport,
  collectIgnoredFragments,
  collectSuspiciousNixReferences,
  detectConflicts,
  findDuplicateHosts,
} from "../analysis.ts";

interface CheckOptions {
  strict: boolean;
  escapeReport: boolean;
}

export async function check(cwd: string, opts: CheckOptions): Promise<void> {
  try {
    const { workspace, configDir } = await loadWorkspace(cwd);
    const duplicateHosts = findDuplicateHosts(workspace);
    const evaluated = evaluate(workspace, { configDir });
    for (const host of evaluated) validateWindowsWslResources(host.windows as WindowsOptions);
    validateWindowsWslSetupTargets(workspace, evaluated, evaluated);
    const output = generateNix(workspace, evaluated);
    validateGeneratedNixSyntax(output);
    const analyses = analyzeWorkspace(workspace, { configDir });
    const conflicts = detectConflicts(analyses);
    const suspiciousReferences = collectSuspiciousNixReferences(analyses);
    // Features listed on a host that do nothing there are likely mistakes; shared
    // profiles are meant to span platforms (winix inspect lists their ignored parts).
    const ignoredFragments = collectIgnoredFragments(analyses, evaluated).filter((item) => !item.composed);

    console.log(`✓ Configuration valid`);
    console.log(`  Hosts: ${evaluated.map((h) => h.name).join(", ")}`);

    for (const warning of output.warnings) {
      console.warn(`Warning: ${warning}`);
    }

    if (duplicateHosts.length > 0) {
      console.warn(`Warning: duplicate host names: ${duplicateHosts.join(", ")}`);
    }

    if (conflicts.length > 0) {
      console.warn(`Warning: ${conflicts.length} possible scalar conflict(s):`);
      for (const conflict of conflicts) {
        console.warn(
          `  ${conflict.host}.${conflict.scope}.${conflict.path}: ` +
          `${conflict.firstFragment} (${conflict.firstValue}) -> ` +
          `${conflict.secondFragment} (${conflict.secondValue})`
        );
        if (conflict.hint) console.warn(`    ${conflict.hint}`);
      }
    }

    if (suspiciousReferences.length > 0) {
      console.warn(
        `Warning: ${suspiciousReferences.length} suspicious literal Nix reference(s):`
      );
      for (const item of suspiciousReferences) {
        console.warn(
          `  ${item.host} ${item.fragment} ${item.scope}.${item.path}: ` +
          `plain string contains \${${item.reference}}`
        );
        console.warn(`    ${item.recommendation}`);
      }
    }

    for (const item of ignoredFragments) {
      console.warn(`Warning: ${item.host} ${item.fragment}: no applicable configuration (ignored scopes: ${item.scopes.join(", ")}).`);
    }

    const windowsHosts = evaluated.filter((host) => platformForEvaluatedHost(host) === "windows");
    for (const line of lockGapWarnings(windowsLockPinGaps(readWindowsLock(configDir), windowsHosts))) console.warn(line);

    if (opts.escapeReport) {
      const report = collectEscapeReport(analyses);
      console.log(`\nEscape hatch report: ${report.length} item(s)`);
      for (const item of report) {
        console.log(
          `  ${item.host} ${item.fragment} ${item.kind} ${item.scope}.${item.path}`
        );
      }
    }

    if (opts.strict && (duplicateHosts.length > 0 || conflicts.length > 0 || ignoredFragments.length > 0)) {
      throw new Error("Strict check failed");
    }
  } catch (err) {
    console.error(`✗ Configuration error:`);
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
}

/**
 * Missing pins make every apply/switch --dry resolve online and print
 * "Would pin…" until someone commits the lock; say exactly that.
 */
export function lockGapWarnings(gaps: WindowsLockGap[]): string[] {
  if (gaps.length === 0) return [];
  const labels = [...new Set(gaps.map((gap) => gap.label))];
  const selectors = [...new Set(gaps.map((gap) => gap.selector))];
  const lines = [
    `Warning: winix-windows.lock is missing ${labels.length} pin(s): ${labels.join(", ")}.`,
    "  Until the lock contains them, every apply and switch resolves them online (\"Would pin…\" in dry runs), and --offline/--locked fail.",
    `  Pin them now with winix update --windows ${selectors.join(" ")}, then commit winix-windows.lock.`,
  ];
  if (gaps.some((gap) => gap.kind === "package")) {
    lines.push("  A mistyped package id fails at that point; find ids with winix windows search <query>.");
  }
  return lines;
}

interface NixParseResult {
  error?: NodeJS.ErrnoException;
  status: number | null;
  stderr: string;
}

type NixParser = (source: string) => NixParseResult;

export function validateGeneratedNixSyntax(
  output: NixOutput,
  parse: NixParser = parseNixSource
): void {
  const sources = [
    ["flake.nix", output["flake.nix"]],
    ...Object.entries(output.hosts).map(([name, source]) => [`hosts/${name}`, source]),
  ] as const;

  for (const [name, source] of sources) {
    const result = parse(source);
    if (result.error?.code === "ENOENT") return;
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const detail = result.stderr.trim() || `nix-instantiate exited with status ${result.status}`;
      throw new Error(`Generated Nix syntax is invalid in ${name}:\n${detail}`);
    }
  }
}

function parseNixSource(source: string): NixParseResult {
  return spawnSync("nix-instantiate", ["--parse", "-"], {
    input: source,
    encoding: "utf8",
  }) as SpawnSyncReturns<string>;
}
