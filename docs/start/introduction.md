---
title: Introduction
description: What Winix is, how it turns TypeScript into a configured machine, and when to use it.
sidebar:
  order: 1
---

# Introduction

Winix configures the computers you use (a Windows PC, the NixOS distro in its
WSL, a NixOS server, a Mac) from one repository of TypeScript. You declare what
each machine should have; Winix makes it so, and keeps doing it every time you
change the declaration.

```ts
export const lazygit = feature("lazygit", ({ home, windows }) => {
  home.packages("lazygit");                  // NixOS, WSL, macOS
  windows.package("JesseDuffield.lazygit");  // Windows
});
```

## How it works

Your config is a TypeScript program. Winix runs it, collects what each machine
declares, and hands each machine to the tool that applies it best:

```text
                         ┌─ NixOS, WSL, macOS ─▶  .winix/out/flake.nix  ─▶  nixos-rebuild / darwin-rebuild
winix.config.ts ─▶ Winix ┤
                         └─ Windows ───────────▶  plan against the machine  ─▶  WinGet, PowerShell, DSC
```

- **On NixOS, WSL and macOS**, Winix writes an ordinary Nix flake and host
  modules (NixOS, nix-darwin and Home Manager options) and runs the usual
  rebuild. Nix does the building; you can read everything Winix generated.
- **On Windows**, there is no Nix. Winix checks every declared resource against
  the machine, shows you a plan, and applies only what differs: packages
  through WinGet, files, settings and the rest through PowerShell and DSC, with
  one administrator prompt for everything that needs it.

Either way the daily loop is the same:

```bash
winix plan      # what would change on this machine
winix switch    # apply it
```

## The building blocks

| | What it is |
|---|---|
| **Feature** | Declares something: a tool, its config files, a setting. One feature can cover every operating system. |
| **Profile** | A named group of features, such as "everything I want on every machine". |
| **Host** | One machine (or one WSL distro) and the features it gets, on one platform. |
| **Workspace** | Your hosts and the Nix inputs they use, in `winix.config.ts`. |

[Features, profiles and hosts](../concepts/features-and-hosts.md) explains how
they fit together.

## When Winix fits

- **You use more than one kind of machine.** A Windows PC, its WSL distro and a
  Mac can share features, so a tool is declared once and its config file lives
  in one place.
- **You want Windows to be declarative too.** Packages with locked versions,
  dotfile links, environment variables, settings, fonts, startup apps and WSL
  distros, previewed before they change and removed when you delete them.
- **You'd rather write TypeScript than learn a new language.** Functions,
  conditionals and imports work as usual, with completion and type checks in
  your editor for every NixOS, Home Manager and nix-darwin option.

If you only manage NixOS machines and are happy writing Nix, plain Nix flakes
do the same job without a layer in between. Winix generates normal Nix, so you
can also start with it and leave later.

## Platforms

| Platform | Host | Applied by |
|---|---|---|
| NixOS | `platforms.nixos()` | `nixos-rebuild` |
| NixOS on WSL | `platforms.wsl()` | `nixos-rebuild`, inside the distro |
| macOS | `platforms.darwin()` | `darwin-rebuild` (nix-darwin) |
| Windows | `platforms.windows()` | Winix, with WinGet, PowerShell 7 and DSC |

Home Manager is included on NixOS, WSL and macOS hosts. Winix runs as a
standalone executable on Windows and Linux; macOS uses the npm package for now.

## Project status

Winix is used daily on Windows, NixOS-WSL and macOS machines. The authoring API
can still change before 1.0; every change is in the
[CHANGELOG](../../CHANGELOG.md).

## Next

- [Install](install.md) Winix.
- Follow [Your first config](first-config.md) from an empty folder to your
  first `winix switch`.
