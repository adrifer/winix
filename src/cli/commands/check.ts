// winix check — validate configuration

import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix } from "../../backends/nix/index.ts";
import {
  analyzeWorkspace,
  collectEscapeReport,
  detectConflicts,
  findDuplicateHosts,
} from "../analysis.ts";

interface CheckOptions {
  strict: boolean;
  escapeReport: boolean;
}

export async function check(cwd: string, opts: CheckOptions): Promise<void> {
  try {
    const { workspace } = await loadWorkspace(cwd);
    const duplicateHosts = findDuplicateHosts(workspace);
    const evaluated = evaluate(workspace);
    const output = generateNix(workspace, evaluated);
    const analyses = analyzeWorkspace(workspace);
    const conflicts = detectConflicts(analyses);

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

    if (opts.escapeReport) {
      const report = collectEscapeReport(analyses);
      console.log(`\nEscape hatch report: ${report.length} item(s)`);
      for (const item of report) {
        console.log(
          `  ${item.host} ${item.fragment} ${item.kind} ${item.scope}.${item.path}`
        );
      }
    }

    if (opts.strict && (duplicateHosts.length > 0 || conflicts.length > 0)) {
      throw new Error("Strict check failed");
    }
  } catch (err) {
    console.error(`✗ Configuration error:`);
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
}
