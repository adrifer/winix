// Generate configuration.winget for the Windows example.
//
// Usage (from the winix repo root, after `npm run build`):
//
//   node examples/windows/generate.mjs
//
// Writes the bundle to examples/windows/out/<host>/.
//
// This script imports the built package from ../../dist so it runs with plain
// `node` without a TypeScript loader. It mirrors examples/windows/winix.config.ts;
// keep the two in sync, or wire `winix apply` to consume the config directly
// (the proper long-term path).

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  host,
  platforms,
  windows,
  workspace,
  evaluate,
  generateWindows,
} from "../../dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "out");

const ws = workspace({
  inputs: { nixpkgs: "github:NixOS/nixpkgs/nixos-unstable" },
  hosts: [
    host("desktop", platforms.windows(), [
      windows.package("Fastfetch-cli.Fastfetch"),
      windows.package("7zip.7zip"),
      windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }),
      windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }),
      // windows.package({ id: "Some.Driver", elevated: true }),
    ]),
  ],
});

const result = generateWindows(evaluate(ws));

if (result.warnings.length > 0) {
  console.warn("Warnings:");
  for (const w of result.warnings) console.warn("  - " + w);
}

for (const [name, bundle] of Object.entries(result.hosts)) {
  const hostDir = join(outDir, name);
  mkdirSync(hostDir, { recursive: true });
  for (const [file, contents] of Object.entries(bundle)) {
    const dest = join(hostDir, file);
    writeFileSync(dest, contents);
    console.log("wrote " + dest);
  }
}

console.log("\nApply on Windows with:");
console.log(
  "  winget configure -f .\\out\\desktop\\configuration.winget --accept-configuration-agreements"
);
