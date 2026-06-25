import { join } from "node:path";
import { tmpdir } from "node:os";
import { cp, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { evaluate } from "../../evaluator/index.ts";
import { platformForEvaluatedHost } from "../activation.ts";
import { loadWorkspace } from "../loader.ts";
import { runCommand } from "../run.ts";
import { applyWorkspace } from "./apply.ts";

interface UpdateOptions {
  inputs: string[];
  dry: boolean;
  windows?: boolean;
}

export async function update(cwd: string, opts: UpdateOptions): Promise<void> {
  if (opts.windows) {
    // TODO(phase 2): resolve floating versions via winget show and write
    // `winix-windows.lock`.
    throw new Error(
      "`winix update --windows` is not implemented yet. For now, add an " +
      "inline `version` pin or a `winix-windows.lock` entry for each floating " +
      "Windows package."
    );
  }

  if (!opts.dry) {
    assertUpdateSupported();
  }

  // `winix update` resolves the Nix flake lock. A Windows-only workspace has
  // no flake.nix, so there is nothing to update; fail clearly instead of
  // letting `nix flake update` error out generically.
  const { workspace } = await loadWorkspace(cwd);
  const evaluated = evaluate(workspace);
  const hasNixHost = evaluated.some((host) => platformForEvaluatedHost(host) !== "windows");
  if (!hasNixHost) {
    throw new Error(
      "`winix update` updates the Nix flake lock, but this workspace has no " +
      "NixOS or nix-darwin hosts (Windows packages are pinned via " +
      "`winix-windows.lock`, resolved by a future `winix` milestone). " +
      "Nothing to update."
    );
  }

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

export function assertUpdateSupported(
  osPlatform: NodeJS.Platform = process.platform
): void {
  if (osPlatform !== "win32") return;

  throw new Error(
    "`winix update` is not supported from native Windows yet because it requires " +
    "the Nix CLI. Run it from WSL, Linux, or macOS."
  );
}
