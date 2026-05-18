// winix check — validate configuration

import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";

interface CheckOptions {
  strict: boolean;
}

export async function check(cwd: string, opts: CheckOptions): Promise<void> {
  try {
    const { workspace } = await loadWorkspace(cwd);
    const evaluated = evaluate(workspace);

    console.log(`✓ Configuration valid`);
    console.log(`  Hosts: ${evaluated.map((h) => h.name).join(", ")}`);

    // TODO: conflict detection with --strict
    // TODO: escape report
  } catch (err) {
    console.error(`✗ Configuration error:`);
    console.error(`  ${(err as Error).message}`);
    process.exit(1);
  }
}
