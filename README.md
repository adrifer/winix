# Winix

[![npm](https://img.shields.io/npm/v/%40adrifer%2Fwinix?label=npm&logo=npm)](https://www.npmjs.com/package/@adrifer/winix)
[![npm preview](https://img.shields.io/npm/v/%40adrifer%2Fwinix/preview?label=preview&logo=npm&color=orange)](https://www.npmjs.com/package/@adrifer/winix?activeTab=versions)
[![Docs](https://img.shields.io/badge/docs-adrifer.github.io%2Fwinix-blue)](https://adrifer.github.io/winix/)
[![CI](https://github.com/adrifer/winix/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/adrifer/winix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-blue?logo=typescript&logoColor=white)](./types)

**TypeScript-first configuration for Windows, NixOS, WSL and macOS machines.**

Describe your machines in typed, composable TypeScript. On Linux and macOS,
Winix generates a normal Nix flake that `nixos-rebuild`, `darwin-rebuild` and
Home Manager apply. On Windows, it installs packages with WinGet and applies
files, settings and more itself, after showing you a plan.

```ts
// features/lazygit.ts: one tool, every platform
export const lazygit = feature("lazygit", ({ home, windows }) => {
  home.packages("lazygit");                  // Linux, WSL, macOS (Home Manager)
  windows.package("JesseDuffield.lazygit");  // Windows (WinGet, version locked)
  home.configFiles({ "lazygit/config.yml": home.symlink("./dotfiles/lazygit/config.yml") });
  windows.file.symlink(windows.knownFolder.localAppData("lazygit\\config.yml"), "./dotfiles/lazygit/config.yml");
});

// winix.config.ts
export default workspace({
  inputs, // nixpkgs, Home Manager, NixOS-WSL, nix-darwin (see examples/cross-platform)
  hosts: [
    host("DESKTOP", platforms.windows(), [lazygit()]),
    host("wsl", platforms.wsl({ stateVersion: "25.05" }), [alice(), lazygit()]),
    host("macbook", platforms.darwin({ stateVersion: 6 }), [alice(), lazygit()]),
  ],
});
```

```bash
winix plan      # what would change on this machine
winix switch    # apply it
```

## Why Winix?

- **TypeScript as the language.** Functions, arrays, conditionals and typed
  helpers instead of a new DSL; completion and type checks in any editor, with
  no npm install.
- **One config for every machine.** A feature declares a tool for every OS; a
  Windows PC, its WSL distro and a Mac share the same features.
- **Nix where Nix runs.** NixOS, nix-darwin and Home Manager do the building;
  Winix writes `.winix/out/flake.nix` and host modules you can read.
- **Declarative Windows.** Packages, files, environment, settings, fonts,
  startup apps and WSL distros, version-locked, applied only where they differ,
  with one UAC prompt, and removed when you delete them.
- **Escape hatches when needed:** `nix.expr()`, `nixos.raw()`, `rawModule()`,
  `windows.dsc()`, `windows.raw()`.

## Quick start

**A new config.** Install Winix and its prerequisites with one script (no
Node.js needed; other ways in [Install](docs/start/install.md)):

```powershell
# Windows
irm https://github.com/adrifer/winix/releases/latest/download/install.ps1 -OutFile $env:TEMP\install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\install.ps1
```

```bash
# Linux
curl -fsSLO https://github.com/adrifer/winix/releases/latest/download/install.sh && bash install.sh
```

Then, in a new folder:

```bash
winix init      # winix.config.ts, tsconfig.json (editor types), .gitignore
winix check
winix plan
winix switch
```

**A fresh machine from your dotfiles repository.** The same script with
`-Repository` clones it, installs prerequisites, downloads the Winix version it
pins, asks which host the machine is and applies it, after one confirmation. A
dotfiles repo can wrap that into two lines; see
[Set up a new machine](docs/start/new-machine.md).
Afterwards, `winix switch` from any folder applies the remembered host, and a
pin bump downloads the new version by itself.

## Organising a config

`winix init` starts with one file. As a config grows to several machines and
operating systems, this layout keeps "what does each machine get?" easy to answer:

```
winix.config.ts     inputs + the list of machines
machines/           one file per computer: its roles and machine-only extras
                    (a Windows PC and its WSL distro are one machine, two hosts)
roles/              profiles for kinds of machines (everywhere, dev, work...),
                    spanning operating systems
features/           one file per tool, declaring every OS it supports
```

`winix inspect --matrix` prints every feature against every host, grouped by
role. [`examples/cross-platform`](examples/cross-platform) is a small, runnable
version of this layout.

## Documentation

Read the full documentation at **[adrifer.github.io/winix](https://adrifer.github.io/winix/)** (or browse the same pages in [`docs/`](docs/README.md)):

| | |
|---|---|
| [Start here](docs/start/introduction.md) | What Winix is, [install](docs/start/install.md), [your first config](docs/start/first-config.md), [set up a new machine](docs/start/new-machine.md) |
| [Concepts](docs/concepts/features-and-hosts.md) | Features and hosts, organising a config, how changes are applied, versions and locks, what Winix owns |
| [Guides](docs/guides/README.md) | Cross-platform features, pairing Windows and WSL, moving a Windows or NixOS machine over, PowerShell and Terminal, shared Git config, updates, testing your config |
| [Reference](docs/reference/config.md) | [Workspace and hosts](docs/reference/config.md), [Linux and macOS helpers](docs/reference/nix.md), [Windows](docs/reference/windows/README.md), [WSL distros](docs/reference/wsl.md), [CLI](docs/reference/cli.md), [Troubleshooting](docs/reference/troubleshooting.md) |
| [API](docs/api/README.md) | Every exported function, namespace and option, generated from source types and doc comments |

The [docs index](docs/README.md) lists every page.

Design and plans: [SPEC](spec/SPEC.md) (the contract),
[ARCHITECTURE](spec/ARCHITECTURE.md), [ROADMAP](ROADMAP.md),
[CHANGELOG](CHANGELOG.md).

## Project status

Winix is used daily on Windows, NixOS-WSL and macOS machines. The authoring API
can still change before 1.0; changes are listed in the [CHANGELOG](CHANGELOG.md).
macOS lags behind Windows and Linux in conveniences (standalone executable,
bootstrap); see the [ROADMAP](ROADMAP.md).

## Development

Only clone this repository to work on Winix itself; see
[CONTRIBUTING.md](CONTRIBUTING.md).

```bash
git clone https://github.com/adrifer/winix.git
cd winix
npm install
npm run check
npm test -- --run
```

### Why the name?

It started as a half-joke about wrapping Nix for **Win**dows. It stuck because
**Win + Nix** also reads as "winning at Nix", and Winix now targets Windows,
NixOS, WSL and macOS alike.

## License

MIT
