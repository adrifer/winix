// winix apply — generate .winix/out/ from config

import { resolve, join, dirname, relative } from "node:path";
import { mkdir, writeFile, readFile, symlink, unlink, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { loadWorkspace } from "../loader.ts";
import { evaluate } from "../../evaluator/index.ts";
import { generateNix } from "../../backends/nix/index.ts";

interface ApplyOptions {
  host?: string;
  dry: boolean;
  diff: boolean;
}

export async function apply(cwd: string, opts: ApplyOptions): Promise<void> {
  // 1. Load workspace config
  const { workspace, configDir } = await loadWorkspace(cwd);

  // 2. Evaluate
  let evaluated = evaluate(workspace);

  // Filter to single host if specified
  if (opts.host) {
    evaluated = evaluated.filter((h) => h.name === opts.host);
    if (evaluated.length === 0) {
      console.error(`Host "${opts.host}" not found. Available hosts:`);
      const all = evaluate(workspace);
      for (const h of all) {
        console.error(`  - ${h.name}`);
      }
      process.exit(1);
    }
  }

  // 3. Generate Nix output
  const output = generateNix(workspace, evaluated);

  // 4. Write or display
  const outDir = join(configDir, ".winix", "out");

  if (opts.dry) {
    console.log("=== .winix/out/flake.nix ===");
    console.log(output["flake.nix"]);
    for (const [name, content] of Object.entries(output.hosts)) {
      console.log(`\n=== .winix/out/hosts/${name} ===`);
      console.log(content);
    }
    return;
  }

  if (opts.diff) {
    await showDiff(outDir, output);
    return;
  }

  // Write files
  await mkdir(join(outDir, "hosts"), { recursive: true });
  await writeFile(join(outDir, "flake.nix"), output["flake.nix"]);

  for (const [name, content] of Object.entries(output.hosts)) {
    await writeFile(join(outDir, "hosts", name), content);
  }

  // Symlink flake.lock from project root if it exists
  const rootLock = join(cwd, "flake.lock");
  const outLock = join(outDir, "flake.lock");
  if (existsSync(rootLock)) {
    try {
      await unlink(outLock);
    } catch {}
    await symlink(rootLock, outLock);
  }

  console.log(`✓ Generated ${Object.keys(output.hosts).length} host(s) in .winix/out/`);
  for (const name of Object.keys(output.hosts)) {
    console.log(`  → hosts/${name}`);
  }
  console.log(`\nNext: nixos-rebuild switch --flake path:$(pwd)/${relative(cwd, outDir) || ".winix/out"}`);
}

async function showDiff(outDir: string, output: { "flake.nix": string; hosts: Record<string, string> }): Promise<void> {
  const files: [string, string][] = [
    [join(outDir, "flake.nix"), output["flake.nix"]],
    ...Object.entries(output.hosts).map(([name, content]) => [join(outDir, "hosts", name), content] as [string, string]),
  ];

  let hasDiff = false;
  for (const [path, newContent] of files) {
    try {
      const existing = await readFile(path, "utf-8");
      if (existing !== newContent) {
        hasDiff = true;
        console.log(`\n--- ${relative(process.cwd(), path)}`);
        console.log(`+++ ${relative(process.cwd(), path)} (new)`);
        console.log("(content differs)");
      }
    } catch {
      hasDiff = true;
      console.log(`\n+++ ${relative(process.cwd(), path)} (new file)`);
    }
  }

  if (!hasDiff) {
    console.log("No changes. Output is up to date.");
  }
}
