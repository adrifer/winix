#!/usr/bin/env node
// Winix CLI entry point

import { parseArgs } from "node:util";
import { dirname } from "node:path";
import { apply } from "./commands/apply.ts";
import { check } from "./commands/check.ts";
import { init, resolveWinixVersionRange } from "./commands/init.ts";
import { installSkill } from "./commands/install.ts";
import { inspect } from "./commands/inspect.ts";
import { switchCommand } from "./commands/switch.ts";
import { update } from "./commands/update.ts";
import { renderSkill } from "../skill.ts";
import { bootstrapCheckout, runCheckout } from "./commands/bootstrap.ts";
import {
  forgetWindowsResource, windowsStatePath, listWindowsOwners, migrateWindowsOwner, windowsStateOwner,
  type ManagedResource,
} from "./windows-state.ts";
import { findConfig } from "./loader.ts";
import { nerdFontsCatalog } from "../backends/windows/fonts.ts";
import { packageSearch, windowsImport } from "./commands/windows-packages.ts";
import { scaffoldFeature, scaffoldNextSteps } from "./commands/scaffold.ts";

if (process.argv[2] === "run") {
  try { await runCheckout(process.cwd(), process.argv.slice(3)); }
  catch (error) { console.error(`Error: ${(error as Error).message}`); process.exit(1); }
  process.exit(0);
}

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    host: { type: "string" },
    provider: { type: "string" },
    dry: { type: "boolean", default: false },
    yes: { type: "boolean", short: "y", default: false },
    diff: { type: "boolean", default: false },
    offline: { type: "boolean", default: false },
    locked: { type: "boolean", default: false },
    windows: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    skill: { type: "boolean", default: false },
    "escape-report": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
    "prepare-only": { type: "boolean", default: false },
  },
});

const command = positionals[0];

if (values.version) {
  console.log((await resolveWinixVersionRange()).replace(/^\^/, ""));
  process.exit(0);
}

if (values.skill) {
  if (command) {
    console.error("The --skill option does not accept a command.");
    process.exit(2);
  }
  process.stdout.write(renderSkill());
  process.exit(0);
}

if (values.help || !command) {
  console.log(`
winix - TypeScript-first system configuration

Commands:
  bootstrap    Validate/preview a trusted checkout, then confirm activation
  run <args>   Prefer checkout-local SDK, enforcing the checkout's exact Winix pin
  init         Scaffold a Winix project
  install skill Install the agent skill wrapper
  scaffold feature <name>  Create features/<name>.ts with home.* and windows.* side by side
  apply        Generate backend output in .winix/out/
  check        Validate configuration
  plan         Show what switch would change on this machine (same as switch --dry)
  switch       Generate output and run the host activation command
  update       Update generated flake.lock and copy it to project root
  inspect      Print each host's features and what they declare (--host to pick one)
  fonts search [query] --provider nerd-fonts  Search official font release IDs
  package search <query>  Search winget and show how to declare a package
  windows import [--host <name>]  Print declarations for installed, undeclared packages
  state forget Release Windows removal ownership without deleting a resource
  state owners List Windows applied-state owners and their migration IDs
  state migrate-owner <id> Transfer an old owner's requirements to this checkout/--host

Options:
  --host <name>   Target a specific host
  --prepare-only Stop bootstrap after validation/preview; no activation
  --dry           Preview generation, activation/cleanup, or owner migration
  -y, --yes       Confirm bootstrap, managed removals, or explicit owner migration
  --diff          Show a unified diff against current output (apply)
  --offline       Never resolve winix-windows.lock online; fail on missing pins (apply, switch, plan)
  --locked        Fail if winix-windows.lock would change (apply, switch, plan)
  --windows       Resolve Windows package/module/WSL image lockfile (update)
  --strict        Treat conflicts as errors (check)
  --escape-report Show escape hatch usage (check)
  --force         Overwrite files (init, install skill, scaffold)
  --skill         Print version-matched agent instructions
  -h, --help      Show this help
  -v, --version   Show this binary/package version

Examples:
  winix init
  winix scaffold feature lazygit
  winix install skill
  winix --skill
  winix apply
  winix apply --dry
  winix apply --host wsl-work
  winix check --strict
  winix check --escape-report
  winix plan --host desktop
  winix switch --host wsl-work
  winix update
`);
  process.exit(0);
}

const cwd = process.cwd();
if (values["prepare-only"] && command !== "bootstrap") {
  console.error("--prepare-only is only supported by winix bootstrap.");
  process.exit(2);
}
if ((values.offline || values.locked) && !["apply", "switch", "plan"].includes(command)) {
  console.error("--offline and --locked are only supported by winix apply, switch and plan.");
  process.exit(2);
}
if (values.yes && command !== "switch" && command !== "bootstrap" &&
    !(command === "state" && positionals[1] === "migrate-owner")) {
  console.error("--yes is only supported by winix switch, bootstrap or state migrate-owner.");
  process.exit(2);
}

switch (command) {
  case "fonts":
    try {
      if (positionals[1] !== "search" || positionals.length > 3 || values.provider !== "nerd-fonts") {
        throw new Error("Usage: winix fonts search [query] --provider nerd-fonts");
      }
      const catalog = await nerdFontsCatalog();
      const query = positionals[2]?.toLowerCase() ?? "";
      const fonts = catalog.fonts.filter((font) => font.family.toLowerCase().includes(query));
      if (!fonts.length) throw new Error(`No Nerd Fonts IDs match "${query}"`);
      console.log(`Nerd Fonts ${catalog.version} (download IDs, not installed family names):`);
      for (const font of fonts) console.log(`  ${font.family}`);
    } catch (error) { console.error(`Error: ${(error as Error).message}`); process.exit(1); }
    break;
  case "package":
    try {
      if (positionals[1] !== "search" || positionals.length < 3) throw new Error("Usage: winix package search <query>");
      packageSearch(positionals.slice(2).join(" "));
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;

  case "windows":
    try {
      if (positionals[1] !== "import" || positionals.length !== 2) throw new Error("Usage: winix windows import [--host <name>]");
      await windowsImport(cwd, { host: values.host });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;

  case "scaffold":
    try {
      if (positionals[1] !== "feature" || positionals.length !== 3) throw new Error("Usage: winix scaffold feature <name> [--force]");
      const result = await scaffoldFeature(cwd, positionals[2], { force: values.force });
      const config = findConfig(cwd)!;
      for (const line of scaffoldNextSteps(dirname(config), result)) console.log(line);
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;

  case "bootstrap":
    try {
      await bootstrapCheckout(cwd, {
        host: values.host ?? "", yes: values.yes, prepareOnly: values["prepare-only"], dry: values.dry,
      });
    } catch (error) { console.error(`Error: ${(error as Error).message}`); process.exit(1); }
    break;
  case "init":
    try {
      await init(cwd, { force: values.force as boolean });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "install":
    if (positionals[1] !== "skill" || positionals.length !== 2) {
      console.error("Usage: winix install skill [--force]");
      process.exit(2);
    }
    try {
      const result = await installSkill(cwd, { force: values.force as boolean });
      console.log(
        result === "current"
          ? "✓ Winix skill wrapper is already current"
          : "✓ Installed Winix skill wrapper"
      );
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
        offline: values.offline,
        locked: values.locked,
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
  case "plan":
  case "switch":
    try {
      await switchCommand(cwd, {
        host: values.host as string | undefined,
        dry: command === "plan" || values.dry,
        yes: values.yes as boolean,
        offline: values.offline,
        locked: values.locked,
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
        windows: values.windows as boolean,
        inputs: positionals.slice(1),
      });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "inspect":
    try {
      await inspect(cwd, { host: values.host });
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;
  case "state":
    try {
      if (process.platform !== "win32") throw new Error("Windows applied state is only available on native Windows.");
      if (positionals[1] === "owners" && positionals.length === 2) {
        const owners = await listWindowsOwners(windowsStatePath());
        for (const entry of owners) console.log(`${entry.id}  ${entry.owner}  (${entry.resources} resource(s))`);
        if (!owners.length) console.log("No recorded Windows owners.");
        break;
      }
      if (positionals[1] === "migrate-owner" && positionals.length === 3) {
        if (!values.host) throw new Error("Owner migration requires --host <new-declared-host>");
        const config = findConfig(cwd);
        if (!config) throw new Error("Run owner migration from the new Winix config checkout.");
        await migrateWindowsOwner(
          windowsStatePath(), positionals[2], await windowsStateOwner(dirname(config), values.host),
          { dry: values.dry, yes: values.yes },
        );
        break;
      }
      let resource: ManagedResource;
      if (positionals[1] === "forget" && positionals[2] === "startup" && positionals.length === 4) {
        resource = { kind: "startup", name: positionals[3] };
      } else if (positionals[1] === "forget" && positionals[2] === "package" &&
                 positionals.length === 5 && ["winget", "msstore"].includes(positionals[3])) {
        resource = { kind: "package", source: positionals[3], id: positionals[4] };
      } else {
        throw new Error("Usage: winix state owners | state migrate-owner <id> --host <name> [--dry|--yes] | state forget startup <name> [--dry] | state forget package <winget|msstore> <id> [--dry]");
      }
      await forgetWindowsResource(windowsStatePath(), resource, values.dry);
    } catch (err) {
      console.error(`\u2717 Error: ${(err as Error).message}`);
      process.exit(1);
    }
    break;

  default:
    console.error(`Unknown command: ${command}`);
    process.exit(2);
}
