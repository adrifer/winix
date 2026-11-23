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
import { refreshEditorTypes, typesCommand } from "./editor-types.ts";
import { commandHelp, mainHelp } from "./help.ts";

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
    "update-versions": { type: "boolean", default: false },
    windows: { type: "boolean", default: false },
    strict: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
    skill: { type: "boolean", default: false },
    "escape-report": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
    version: { type: "boolean", short: "v", default: false },
    "prepare-only": { type: "boolean", default: false },
    // Internal: consent was already given by the repository bootstrap script.
    confirmed: { type: "boolean", default: false },
    "command-only": { type: "boolean", default: false },
    matrix: { type: "boolean", default: false },
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
  const help = command ? commandHelp(command) : mainHelp();
  if (help === undefined) {
    console.error(`Unknown command: ${command}`);
    process.exit(2);
  }
  console.log(help);
  process.exit(0);
}

const cwd = process.cwd();
if ((values["prepare-only"] || values.confirmed || values["command-only"]) && command !== "bootstrap") {
  console.error("--prepare-only, --confirmed and --command-only are only supported by winix bootstrap.");
  process.exit(2);
}
if (values.matrix && command !== "inspect") {
  console.error("--matrix is only supported by winix inspect.");
  process.exit(2);
}
if ((values.offline || values.locked) && !["apply", "switch", "plan"].includes(command)) {
  console.error("--offline and --locked are only supported by winix apply, switch and plan.");
  process.exit(2);
}
if (values["update-versions"] && (command !== "switch" || values.dry)) {
  console.error("--update-versions is only supported by winix switch (not --dry, which never writes the lock).");
  process.exit(2);
}
if (values["update-versions"] && values.locked) {
  console.error("--update-versions changes winix-windows.lock, so it cannot be combined with --locked.");
  process.exit(2);
}
if (values.yes && command !== "switch" && command !== "bootstrap" &&
    !(command === "state" && positionals[1] === "migrate-owner")) {
  console.error("--yes is only supported by winix switch, bootstrap or state migrate-owner.");
  process.exit(2);
}

// Keep the config's editor types (.winix/types) matching the Winix that runs it.
if (["check", "apply", "plan", "switch", "update", "inspect"].includes(command)) {
  const config = findConfig(cwd);
  if (config) await refreshEditorTypes(dirname(config));
}

switch (command) {
  case "types":
    try {
      const config = findConfig(cwd);
      if (!config) throw new Error(`Could not find winix.config.ts in ${cwd} or parent directories.`);
      await typesCommand(dirname(config));
    } catch (error) {
      console.error(`✗ Error: ${(error as Error).message}`);
      process.exit(1);
    }
    break;
  // `package search` and `fonts search` are the older names of `windows search` and `windows fonts`.
  case "package":
  case "fonts":
  case "windows":
    try {
      const subcommand = command === "windows" ? positionals[1]
        : positionals[1] === "search" ? (command === "package" ? "search" : "fonts") : undefined;
      const rest = positionals.slice(2);
      if (subcommand === "search" && rest.length > 0) {
        packageSearch(rest.join(" "));
      } else if (subcommand === "import" && rest.length === 0) {
        await windowsImport(cwd, { host: values.host });
      } else if (subcommand === "fonts" && rest.length <= 1 && (values.provider ?? "nerd-fonts") === "nerd-fonts") {
        const catalog = await nerdFontsCatalog();
        const query = rest[0]?.toLowerCase() ?? "";
        const fonts = catalog.fonts.filter((font) => font.family.toLowerCase().includes(query));
        if (!fonts.length) throw new Error(`No Nerd Fonts IDs match "${query}"`);
        console.log(`Nerd Fonts ${catalog.version} (download IDs, not installed family names):`);
        for (const font of fonts) console.log(`  ${font.family}`);
      } else {
        throw new Error("Usage: winix windows search <query> | windows import [--host <name>] | windows fonts [query]");
      }
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
        host: values.host, yes: values.yes, prepareOnly: values["prepare-only"], dry: values.dry,
        confirmed: values.confirmed, commandOnly: values["command-only"],
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
        updateVersions: values["update-versions"],
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
      await inspect(cwd, { host: values.host, matrix: values.matrix });
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
      } else if (positionals[1] === "forget" && positionals[2] === "startup-app" && positionals.length === 4) {
        resource = { kind: "startup-app", name: positionals[3] };
      } else if (positionals[1] === "forget" && positionals[2] === "package" &&
                 positionals.length === 5 && ["winget", "msstore"].includes(positionals[3])) {
        resource = { kind: "package", source: positionals[3], id: positionals[4] };
      } else {
        throw new Error("Usage: winix state owners | state migrate-owner <id> --host <name> [--dry|--yes] | state forget startup <name> [--dry] | state forget startup-app <name> [--dry] | state forget package <winget|msstore> <id> [--dry]");
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
