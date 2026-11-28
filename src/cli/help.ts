// `winix --help` and `winix <command> --help`.
//
// Accepted but not listed: `winix run <args>` (what the `winix` command runs),
// `switch --dry` (= plan), `bootstrap --command-only` (used by WSL setup), and the older names
// `package search` and `fonts search` (now `windows search` and `windows fonts`).

type Row = [string, string];

/** Titled sections of rows, aligned on one column across all of them. */
function sections(list: [string, Row[]][]): string {
  const width = Math.max(...list.flatMap(([, rows]) => rows.map(([name]) => name.length))) + 2;
  return list.map(([title, rows]) =>
    `${title}:\n${rows.map(([name, description]) => `  ${name.padEnd(width)}${description}`).join("\n")}`
  ).join("\n\n");
}

export function mainHelp(): string {
  return `winix - TypeScript configuration for Windows, NixOS, WSL and macOS

Usage: winix <command> [options]

${sections([
  ["Day to day", [
    ["plan", "Show what switch would change on this machine"],
    ["switch", "Apply this machine's host"],
    ["update", "Update the locks to the latest versions"],
    ["upgrade", "Move the config to the latest Winix release"],
    ["check", "Validate the configuration"],
  ]],
  ["Writing configuration", [
    ["inspect", "Show each host's features and what they declare"],
    ["scaffold feature <name>", "Create features/<name>.ts for every OS"],
    ["windows search <query>", "Search WinGet and show how to declare a package"],
    ["windows import", "Print declarations for installed, undeclared packages"],
    ["windows fonts [query]", "Search Nerd Fonts release names"],
    ["apply", "Generate the output in .winix/out/ without applying it"],
    ["types", "Write editor types to .winix/types"],
  ]],
  ["Setup", [
    ["init", "Create a Winix project"],
    ["bootstrap", "Set up this machine from a checkout (first run)"],
    ["install command", "Put this winix on your PATH for this user"],
    ["install skill", "Install the agent skill for coding agents"],
    ["state <command>", "Change Winix's record of what it owns on Windows"],
  ]],
  ["Options", [
    ["--host <name>", "Host to use (default: the one bootstrap remembered)"],
    ["-h, --help", "Show help; winix <command> --help shows its options"],
    ["-v, --version", "Show the version"],
    ["--skill", "Print instructions for coding agents"],
  ]],
])}

WINIX_SDK=<dir> runs another Winix instead of the pinned one, such as a source checkout.`;
}

interface CommandHelp {
  usage: string;
  description: string;
  commands?: Row[];
  options?: Row[];
  examples?: string[];
}

const HOST: Row = ["--host <name>", "Host to use (default: the one bootstrap remembered)"];
const OFFLINE: Row = ["--offline", "Never look up versions online; fail when a pin is missing"];
const LOCKED: Row = ["--locked", "Fail instead of changing winix-windows.lock"];

const COMMANDS: Record<string, CommandHelp> = {
  plan: {
    usage: "winix plan [--host <name>]",
    description: "Show what `winix switch` would change on this machine, without changing anything.\n" +
      "On NixOS and WSL it builds the new system and compares it with the running one.",
    options: [HOST, ["--no-build", "NixOS: skip the build and only show the command switch would run"], OFFLINE, LOCKED],
  },
  switch: {
    usage: "winix switch [--host <name>]",
    description: "Generate the host's output and apply it. On Windows, Winix applies what differs (one UAC prompt);\n" +
      "on NixOS it builds, shows the plan and runs nixos-rebuild (nothing when the system is unchanged);\n" +
      "on macOS it runs darwin-rebuild. `winix plan` shows the changes without applying them.",
    options: [
      HOST,
      ["-y, --yes", "Confirm removing resources no longer declared"],
      ["--update-versions", "Raise winix-windows.lock to newer installed versions without asking"],
      OFFLINE,
      LOCKED,
    ],
  },
  update: {
    usage: "winix update [<name>...]",
    description: "Update the locks to the latest versions. On Windows: winix-windows.lock. Elsewhere: the Nix flake.lock,\n" +
      "copied back to the project. Names limit it to those packages, PowerShell modules or flake inputs,\n" +
      "or to fonts, nixos-wsl (WSL images) or wsl-setup. Winix itself moves with winix upgrade.",
    options: [
      ["--windows", "Update winix-windows.lock from WSL, Linux or macOS (fonts and WSL pins; packages need WinGet)"],
      ["--dry", "Only show what would be updated"],
    ],
    examples: ["winix update", "winix update JesseDuffield.lazygit", "winix update --windows wsl-setup", "winix update nixpkgs"],
  },
  upgrade: {
    usage: "winix upgrade [version]",
    description: "Move this config's Winix pin (package.json) to the latest release, or to the one named.\n" +
      "The next winix command downloads it. winix update never changes Winix; it says when a newer one exists.",
    options: [["--dry", "Only show the change"]],
    examples: ["winix upgrade", "winix upgrade --dry", "winix upgrade 0.3.5"],
  },
  check: {
    usage: "winix check",
    description: "Validate the configuration and report conflicts and missing pins.",
    options: [
      ["--strict", "Treat conflicts as errors"],
      ["--escape-report", "List where the configuration uses escape hatches"],
    ],
  },
  inspect: {
    usage: "winix inspect [--host <name>] [--matrix]",
    description: "Show each host's features and what they declare.",
    options: [
      ["--host <name>", "Only this host"],
      ["--matrix", "A features x hosts table, grouped by role"],
    ],
  },
  scaffold: {
    usage: "winix scaffold feature <name>",
    description: "Create features/<name>.ts with a Linux/macOS (home.*) part and a Windows (windows.*) part.",
    options: [["--force", "Overwrite an existing file"]],
  },
  windows: {
    usage: "winix windows <command>",
    description: "Helpers for writing Windows configuration. They only read; nothing on this machine changes.",
    commands: [
      ["search <query>", "Search WinGet and show how to declare each result"],
      ["import", "Print windows.package() declarations for installed packages the host doesn't declare"],
      ["fonts [query]", "Search Nerd Fonts release names for windows.fonts()"],
    ],
    options: [["--host <name>", "Host to compare with (import)"]],
    examples: ["winix windows search lazygit", "winix windows import", "winix windows fonts JetBrains"],
  },
  apply: {
    usage: "winix apply [--host <name>]",
    description: "Generate the output in .winix/out/ without applying it.",
    options: [
      ["--host <name>", "Only this host"],
      ["--dry", "Print the output instead of writing it"],
      ["--diff", "Show a diff against the current output"],
      OFFLINE,
      LOCKED,
    ],
  },
  types: {
    usage: "winix types",
    description: "Write editor types to .winix/types and check tsconfig.json (every config command also does this).",
  },
  init: {
    usage: "winix init",
    description: "Create a Winix project in this directory, including the agent skill (see winix install skill).",
    options: [["--force", "Overwrite existing files"]],
  },
  bootstrap: {
    usage: "winix bootstrap [--host <name>]",
    description: "Set up this machine from a trusted checkout: validate, preview, confirm once, then apply the host.\n" +
      "Remembers the host, so later commands need no --host.",
    options: [
      HOST,
      ["--prepare-only", "Validate and preview, without applying"],
      ["--dry", "Only show what would happen"],
      ["-y, --yes", "Don't ask for confirmation"],
    ],
  },
  install: {
    usage: "winix install command | winix install skill",
    description: "Install part of Winix.",
    commands: [
      ["command", "Copy this Winix to your user folder and put a winix command on PATH. Inside a project it\n" +
        "runs the version the project pins; elsewhere, this one."],
      ["skill", "Write .agents/skills/winix/SKILL.md, which tells coding agents to run `winix --skill`"],
    ],
    options: [["--force", "Overwrite an edited skill file (skill)"]],
  },
  state: {
    usage: "winix state <command> (Windows)",
    description: "Winix records which Windows resources it created, and only removes those. These commands change that record.",
    commands: [
      ["owners", "List the checkouts and hosts that own resources, with their ids"],
      ["forget startup <name>", "Stop owning a startup entry, without removing it"],
      ["forget startup-app <name>", "Stop owning a startup app, without removing it"],
      ["forget package <winget|msstore> <id>", "Stop owning a package, without uninstalling it"],
      ["migrate-owner [<id>|<old folder>]", "Move an old owner's resources to this checkout and host (no argument: the checkout that moved here)"],
    ],
    options: [
      ["--dry", "Only show what would change"],
      ["--host <name>", "migrate-owner: the host (default: the remembered host, else this PC's name)"],
      ["-y, --yes", "Confirm migrate-owner"],
    ],
  },
};

/** Help for one command, or undefined for an unknown one. */
export function commandHelp(command: string): string | undefined {
  // Older names of the windows subcommands.
  const name = command === "package" || command === "fonts" ? "windows" : command;
  const help = Object.hasOwn(COMMANDS, name) ? COMMANDS[name] : undefined;
  if (!help) return undefined;
  const tables: [string, Row[]][] = [];
  if (help.commands?.length) tables.push(["Commands", help.commands]);
  if (help.options?.length) tables.push(["Options", help.options]);
  const parts = [`Usage: ${help.usage}`, help.description];
  if (tables.length) parts.push(sections(tables));
  if (help.examples?.length) parts.push(`Examples:\n${help.examples.map((example) => `  ${example}`).join("\n")}`);
  return parts.join("\n\n");
}
