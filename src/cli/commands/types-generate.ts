import { loadWorkspace } from "../loader.ts";
import { generateTypes } from "../types-gen/index.ts";

export interface TypesGenerateOptions {
  channel?: string;
  force: boolean;
}

export async function typesGenerate(cwd: string, opts: TypesGenerateOptions): Promise<void> {
  const { workspace, configDir } = await loadWorkspace(cwd);
  const result = await generateTypes({
    workspace,
    configDir,
    channel: opts.channel,
    force: opts.force,
  });

  console.log(
    `✓ Generated ${result.options.toLocaleString()} NixOS option types across ${result.namespaces} namespaces`
  );
  console.log(`  → ${relativeToCwd(cwd, result.outputDir)}/nixos.d.ts`);
  console.log(`  → ${relativeToCwd(cwd, result.outputDir)}/index.d.ts`);
  console.log(`  Cache: ${result.fromCache ? "reused" : "updated"} (${relativeToCwd(cwd, result.cachePath)})`);
  console.log("");
  console.log("\nGenerated types override the bundled nixos-unstable snapshot.");
  console.log("Add `.winix/types/generated/index.d.ts` to your tsconfig include if not already present.");
}

function relativeToCwd(cwd: string, path: string): string {
  return path.startsWith(`${cwd}/`) ? path.slice(cwd.length + 1) : path;
}
