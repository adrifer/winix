import { join } from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { runCommand } from "../run.ts";
import { applyWorkspace } from "./apply.ts";

interface UpdateOptions {
  inputs: string[];
  dry: boolean;
}

export async function update(cwd: string, opts: UpdateOptions): Promise<void> {
  const result = await applyWorkspace(cwd, { dry: false, diff: false });
  const updateDir = await mkdtemp(join(tmpdir(), "winix-update-"));
  await cp(result.outDir, updateDir, { recursive: true });

  const args = [
    "--extra-experimental-features",
    "nix-command",
    "--extra-experimental-features",
    "flakes",
    "flake",
    "update",
    ...opts.inputs,
  ];

  try {
    await runCommand("nix", args, { cwd: updateDir, dry: opts.dry });
    if (opts.dry) return;

    const outLock = join(updateDir, "flake.lock");
    const rootLock = join(result.configDir, "flake.lock");
    const tmpLock = join(result.configDir, ".flake.lock.tmp");
    await writeFile(tmpLock, await readFile(outLock));
    await rename(tmpLock, rootLock);
    console.log("✓ Updated flake.lock");
  } finally {
    await rm(updateDir, { recursive: true, force: true });
  }
}
