---
title: CLI
description: Every winix command and option.
sidebar:
  order: 4
---

# CLI

Run commands from a Winix project (any folder below `winix.config.ts`).
`winix --help` lists the commands and `winix <command> --help` shows a command's
options. With npm instead of the `winix` command, use `npx @adrifer/winix`.

`--host <name>` picks the host. Without it, Winix uses the host `winix bootstrap`
remembered on this machine, the only host, or the host named like this machine.

## Day to day

| Command | What it does |
| --- | --- |
| `winix plan` | Show what `switch` would change on this machine, without changing anything. On NixOS and WSL it builds the new system and compares it with the running one ([details](../concepts/applying-changes.md#the-plan-on-nixos-and-wsl)). |
| `winix switch` | Generate the host's output and apply it. On Windows, Winix applies what differs (one UAC prompt); on NixOS it builds, shows the plan and runs `nixos-rebuild` (skipped when nothing changed); on macOS it runs `darwin-rebuild`. |
| `winix update [<name>...]` | Update the locks to the latest versions: `winix-windows.lock` on Windows, the Nix `flake.lock` elsewhere. Names limit it to those packages, PowerShell modules or flake inputs, or to `fonts`, `nixos-wsl` (WSL images) or `wsl-setup`. |
| `winix check` | Validate the configuration and report conflicts and missing pins. |

| Option | Commands | What it does |
| --- | --- | --- |
| `--dry` | `update` | Only show what would be updated |
| `-y`, `--yes` | `switch` | Confirm removing resources no longer declared |
| `--update-versions` | `switch` | Raise `winix-windows.lock` to newer installed versions without asking |
| `--no-build` | `plan` | NixOS: skip the build and only show the command a switch would run |
| `--offline` | `plan`, `switch`, `apply` | Never look up versions online; fail when a pin is missing |
| `--locked` | `plan`, `switch`, `apply` | Fail instead of changing `winix-windows.lock` |
| `--windows` | `update` | Update `winix-windows.lock` from WSL, Linux or macOS (the default on Windows). Fonts and WSL pins resolve anywhere; packages need WinGet |
| `--strict` | `check` | Treat conflicts as errors |
| `--escape-report` | `check` | List where the configuration uses escape hatches |

## Writing configuration

| Command | What it does |
| --- | --- |
| `winix inspect [--matrix]` | Show each host's features and what they declare; `--matrix` prints a features × hosts table, grouped by role. |
| `winix scaffold feature <name>` | Create `features/<name>.ts` with a Linux/macOS (`home.*`) part and a Windows (`windows.*`) part. |
| `winix windows search <query>` | Search WinGet and show how to declare each result. |
| `winix windows import` | Print `windows.package()` declarations for installed packages the host doesn't declare. |
| `winix windows fonts [query]` | Search Nerd Fonts release names for `windows.fonts()`. |
| `winix apply` | Generate the output in `.winix/out/` without applying it; `--dry` prints it, `--diff` shows a diff against the current output. |
| `winix types` | Write editor types to `.winix/types` and check `tsconfig.json` (every config command also does this). |

## Setup

| Command | What it does |
| --- | --- |
| `winix init` | Create a Winix project in this directory. |
| `winix bootstrap` | Set up this machine from a trusted checkout: validate, preview, confirm once, then apply the host. It remembers the host. `--prepare-only` stops before applying. |
| `winix install skill` | Install the agent skill, so coding agents read `winix --skill` for this version. |
| `winix --skill` | Print the instructions for coding agents that match this version. |

## Windows ownership records

Winix records which Windows resources it created, and only removes those (see
[What Winix owns](../concepts/ownership.md)). These commands change that record:

| Command | What it does |
| --- | --- |
| `winix state owners` | List the checkouts and hosts that own resources, with their ids. |
| `winix state forget startup <name>` | Stop owning a startup entry, without removing it. |
| `winix state forget startup-app <name>` | Stop owning a startup app, without removing it. |
| `winix state forget package <winget\|msstore> <id>` | Stop owning a package, without uninstalling it. |
| `winix state migrate-owner <id> --host <name>` | Move an old owner's resources to this checkout and host (`--dry` to preview, `--yes` to confirm). |

## Also accepted

Not listed in `winix --help`, but they keep working:

| Command | What it does |
| --- | --- |
| `winix run <args>` | Run the checkout's pinned Winix with these arguments, downloading it (checksum-verified) when needed. The `winix` command's launchers call this, so `winix switch` is `winix run switch`. `WINIX_SDK=<dir>` runs another Winix, such as a source checkout. |
| `winix switch --dry` | Same as `winix plan`. |
| `winix bootstrap --command-only` | Only install the `winix` command and remember `--host`, without evaluating the configuration. WSL setup uses it inside a new distro. |
| `winix package search`, `winix fonts search` | The older names of `winix windows search` and `winix windows fonts`. |

## Generated output

`winix apply` and `winix switch` write `.winix/out/`
([Workspace and hosts](config.md#generated-output)). You can run the generated
flake yourself:

```bash
sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#my-host
sudo darwin-rebuild switch --flake path:$(pwd)/.winix/out#macbook
```
