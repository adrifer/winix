---
title: Documentation
description: Reference pages and guides for Winix.
---

# Winix documentation

The same pages are published as a website; this index is for reading them on
GitHub.

## Start here

| Page | |
|---|---|
| [Introduction](start/introduction.md) | What Winix is, how it works, when to use it |
| [Install](start/install.md) | The standalone executable or the npm package, editor and agent support |
| [Your first config](start/first-config.md) | From an empty folder to your first `winix switch` |
| [Set up a new machine](start/new-machine.md) | Set up a fresh PC or Linux machine from your repository with the install script |

## Concepts

| Page | |
|---|---|
| [Features, profiles and hosts](concepts/features-and-hosts.md) | The model: what declares, what groups, what's a machine |
| [Organising a config](concepts/organising-a-config.md) | Machines → roles → features |
| [How changes are applied](concepts/applying-changes.md) | Nix hosts and Windows: plan, switch, one UAC prompt |
| [Versions and locks](concepts/versions-and-locks.md) | `flake.lock`, `winix-windows.lock`, package version policies, updates |
| [What Winix owns](concepts/ownership.md) | Why Winix only removes what it created |
| [The winix command](concepts/the-winix-command.md) | How the pinned version runs from any folder |

## Guides

| Guide | |
|---|---|
| [Write a cross-platform feature](guides/cross-platform-feature.md) | One tool on Linux, WSL, macOS and Windows |
| [Pair a Windows host with its WSL host](guides/pair-windows-and-wsl.md) | Windows creates and sets up its NixOS-WSL distro |
| [Move a Windows machine to Winix](guides/move-a-windows-machine.md) | Bring an existing PC into your config |
| [Move a NixOS machine to Winix](guides/move-a-nixos-machine.md) | Bring an existing NixOS machine over piece by piece with `rawModule()` |
| [PowerShell profile and Windows Terminal](guides/powershell-and-terminal.md) | Profile, aliases shared with zsh, Terminal settings |
| [Share git config across Windows and WSL](guides/share-git-config.md) | One git identity for Git for Windows and Linux |
| [Keep everything up to date](guides/keep-up-to-date.md) | Packages, Nix inputs and Winix itself |
| [Test your configuration](guides/testing-your-config.md) | Unit-test features, platform guards and generated output with Vitest |

## Reference

| Page | |
|---|---|
| [Workspace and hosts](reference/config.md) | `workspace`, inputs, `host`, `feature`, `profile`, platforms, `account`, `rawModule` |
| [Linux and macOS helpers](reference/nix.md) | `home.*`, `nixos.*`, `darwin.*`, `nix.*`, binary releases, overlays |
| [Windows](reference/windows/README.md) | Every `windows.*` helper: [packages](reference/windows/packages.md), [files](reference/windows/files.md), [environment and settings](reference/windows/environment-and-settings.md), [startup](reference/windows/startup.md), [appearance and fonts](reference/windows/appearance-and-fonts.md), [feeds](reference/windows/feeds.md) |
| [WSL distros](reference/wsl.md) | Create or adopt a NixOS-WSL distro and set it up from your repository |
| [CLI](reference/cli.md) | Every command and option |
| [Troubleshooting](reference/troubleshooting.md) | Common issues on Windows, NixOS, WSL and the editor, and how to fix them |

## API

Every function and option, generated from the source's types and doc comments:
[API](api/README.md) ([workspace and hosts](api/config.md), [platforms](api/platforms.md),
[account](api/account.md), [home](api/home.md), [nixos](api/nixos.md),
[darwin](api/darwin.md), [nix and overlay](api/nix.md), [windows](api/windows.md),
[evaluation and backends](api/evaluation.md)).

## For contributors

[CONTRIBUTING](../CONTRIBUTING.md), [SPEC](../spec/SPEC.md),
[ARCHITECTURE](../spec/ARCHITECTURE.md), [ROADMAP](../ROADMAP.md),
[CHANGELOG](../CHANGELOG.md).
