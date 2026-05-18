import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { WorkspaceDef } from "../../core/types.ts";
import { detectNixpkgsChannel, downloadOptionsJson } from "./download.ts";
import { emitGeneratedTypes } from "./emitter.ts";
import { parseOptions, type OptionsJson } from "./parser.ts";

export interface GenerateTypesOptions {
  workspace: WorkspaceDef;
  configDir: string;
  channel?: string;
  force?: boolean;
  fetchImpl?: typeof fetch;
}

export interface GenerateTypesResult {
  channel: string;
  options: number;
  namespaces: number;
  outputDir: string;
  cachePath: string;
  fromCache: boolean;
}

export async function generateTypes(opts: GenerateTypesOptions): Promise<GenerateTypesResult> {
  const channel = opts.channel ?? detectNixpkgsChannel(opts.workspace.inputs);
  if (!channel) {
    throw new Error(
      "Could not detect a nixos-* channel from workspace.inputs.nixpkgs. " +
        "Run `winix types generate --channel nixos-unstable`."
    );
  }
  if (!channel.startsWith("nixos-")) {
    throw new Error(`NixOS options are published for nixos-* channels. Use --channel nixos-unstable, not ${channel}.`);
  }

  const winixDir = join(opts.configDir, ".winix");
  const outputDir = join(winixDir, "types", "generated");
  const cacheDir = join(winixDir, "cache");
  const download = await downloadOptionsJson({
    cacheDir,
    channel,
    force: opts.force,
    fetchImpl: opts.fetchImpl,
  });

  const rawOptions = JSON.parse(download.optionsJson) as OptionsJson;
  const parsed = parseOptions(rawOptions);
  const emitted = emitGeneratedTypes(parsed);

  await mkdir(outputDir, { recursive: true });
  await writeFile(join(outputDir, "nixos.d.ts"), emitted.nixos);
  await writeFile(join(outputDir, "index.d.ts"), emitted.index);

  return {
    channel,
    options: emitted.stats.options,
    namespaces: emitted.stats.namespaces,
    outputDir,
    cachePath: download.cachePath,
    fromCache: download.fromCache,
  };
}
