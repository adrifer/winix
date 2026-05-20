#!/usr/bin/env -S node --experimental-transform-types --no-warnings
// Winix CLI entry point

import { parseArgs } from "node:util";
import { apply } from "./commands/apply.ts";
import { check } from "./commands/check.ts";
import { init } from "./commands/init.ts";
import { inspect } from "./commands/inspect.ts";
import { switchCommand } from "./commands/switch.ts";
import { update } from "./commands/update.ts";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string" },
    dry: { type: "boolean", default: false },
    diff: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    "escape-report": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

const command = positionals[0];

if (values.help || !command) {
  console.log(`
winix - TypeScript-first system configuration

Commands:
  init         Scaffold a Winix project
  apply        Generate Nix output in .winix/out/
  check        Validate configuration
  switch       Generate output and run nixos-rebuild/darwin-rebuild
  update       Update generated flake.lock and copy it to project root
  inspect      Print host composition and fragment graph

Options:
  --host <name>   Target a specific host
  --dry           Show what would be generated (apply)
  --diff          Show diff against current output (apply)
  --strict        Treat conflicts as errors (check)
  --escape-report Show escape hatch usage (check)
  --force         Overwrite files (init)
  -h, --help      Show this help

Examples:
  winix init
  winix apply
  winix apply --dry
  winix apply --host wsl-work
  winix check --strict
  winix check --escape-report
  winix switch --host wsl-work
  winix update
`);
  process.exit(0);
}

const cwd = process.cwd();

switch (command) {
  case "init":
    try {
      await init(cwd, { force: values.force as boolean });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "apply":
    try {
      await apply(cwd, {
        host: values.host as string | undefined,
        dry: values.dry as boolean,
        diff: values.diff as boolean,
      });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "check":
    await check(cwd, {
      strict: values.strict as boolean,
      escapeReport: values["escape-report"] as boolean,
    });
    break;
  case "switch":
    try {
      await switchCommand(cwd, {
        host: values.host as string | undefined,
        dry: values.dry as boolean,
      });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "update":
    try {
      await update(cwd, {
        dry: values.dry as boolean,
        inputs: positionals.slice(1),
      });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "inspect":
    try {
      await inspect(cwd);
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(2);
}
