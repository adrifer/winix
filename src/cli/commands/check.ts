// winix check — validate configuration

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix, type NixOutput } from "../../backends/nix/index.ts";
import { validateWindowsWslResources } from "../../backends/windows/index.ts";
import { validateWindowsWslSetupTargets } from "../../backends/windows/wsl-setup-runtime.ts";
import type { WindowsOptions } from "../../types/index.ts";
import { readWindowsLock, windowsLockGaps } from "../../backends/windows/lockfile.ts";
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
    const ignoredFragments = collectIgnoredFragments(analyses, evaluated);

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
    const gaps = windowsLockGaps(readWindowsLock(configDir), windowsHosts);
    if (gaps.length > 0) {
      const ids = [...new Set(gaps.map((gap) => gap.id))];
      console.warn(`Warning: ${ids.length} Windows package(s) not pinned in winix-windows.lock: ${ids.join(", ")}.`);
      console.warn(`  The next apply resolves them with winget (network); a mistyped id fails there. Pin now with winix update --windows ${ids.join(" ")}, or find ids with winix package search <query>.`);
    }

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
