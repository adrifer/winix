#!/usr/bin/env node
// Winix CLI entry point

import { resolve, join } from "node:path";
import { parseArgs } from "node:util";
import { apply } from "./commands/apply.ts";
import { check } from "./commands/check.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string" },
    dry: { type: "boolean", default: false },
    diff: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(`
winix - TypeScript-first system configuration

Commands:
  apply        Generate Nix output in .winix/out/
  check        Validate configuration

Options:
  --host <name>   Target a specific host
  --dry           Show what would be generated (apply)
  --diff          Show diff against current output (apply)
  --strict        Treat conflicts as errors (check)
  -h, --help      Show this help

Examples:
  winix apply
  winix apply --dry
  winix apply --host wsl-work
  winix check --strict
`);
  process.exit(0);
}

const cwd = process.cwd();

switch (command) {
  case "apply":
    await apply(cwd, {
      host: values.host as string | undefined,
      dry: values.dry as boolean,
      diff: values.diff as boolean,
    });
    break;
  case "check":
    await check(cwd, { strict: values.strict as boolean });
    break;
  default:
    console.error(`Unknown command: ${command}`);
    process.exit(2);
}
