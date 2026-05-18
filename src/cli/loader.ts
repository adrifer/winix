// Loader: finds and imports the user's winix.config.ts

import { resolve, dirname } from "node:path";
import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { WorkspaceDef } from "../core/types.ts";

const CONFIG_NAMES = ["winix.config.ts", "winix.config.js", "winix.config.mjs"];

export interface LoadResult {
  workspace: WorkspaceDef;
  configDir: string;
  configPath: string;
}

/**
 * Find and load the workspace config file.
 * Searches for winix.config.ts in cwd and parent dirs.
 */
export async function loadWorkspace(cwd: string): Promise<LoadResult> {
  const configPath = findConfig(cwd);
  if (!configPath) {
    throw new Error(
      `Could not find winix.config.ts in ${cwd} or parent directories.\n` +
      `Run \`winix init\` to create one.`
    );
  }

  const configDir = dirname(configPath);

  // Import the config file (requires Node --experimental-strip-types or pre-compiled)
  const fileUrl = pathToFileURL(configPath).href;
  const mod = await import(fileUrl);

  const workspace = mod.default as WorkspaceDef;
  if (!workspace || !workspace.hosts) {
    throw new Error(
      `${configPath} must export a default workspace() value.`
    );
  }

  return { workspace, configDir, configPath };
}

function findConfig(dir: string): string | null {
  let current = resolve(dir);

  for (let i = 0; i < 10; i++) {
    for (const name of CONFIG_NAMES) {
      const candidate = resolve(current, name);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }

  return null;
}
