#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { nodeTypeArguments } from "../dist/cli/node.js";

try {
  const result = spawnSync(process.execPath, [
    ...nodeTypeArguments(process.version), "--no-warnings",
    fileURLToPath(new URL("../dist/cli/index.js", import.meta.url)), ...process.argv.slice(2),
  ], { stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exitCode = 1;
}
