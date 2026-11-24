---
title: Guides
description: Recipes for the things people set up first, built on a tested example config.
sidebar:
  label: All guides
  order: 0
---

# Guides

Recipes for the things people set up first. Most quote
[`examples/cross-platform`](../../examples/cross-platform), a runnable config
with a Windows desktop, the NixOS-WSL distro it creates, and a Mac, organised as
machines → roles → features. Its test (`tests/cross-platform-example.test.ts`)
keeps the code here working.

| Guide | You want to… |
|---|---|
| [Write a cross-platform feature](cross-platform-feature.md) | Declare a tool once and get it on Linux, WSL, macOS and Windows |
| [Pair a Windows host with its WSL host](pair-windows-and-wsl.md) | Have Windows create a NixOS-WSL distro and set it up from the same checkout |
| [Move a Windows machine to Winix](move-a-windows-machine.md) | Bring a PC you already use into your config without reinstalling anything |
| [Move a NixOS machine to Winix](move-a-nixos-machine.md) | Bring an existing NixOS machine over piece by piece using `rawModule()` |
| [PowerShell profile and Windows Terminal](powershell-and-terminal.md) | Keep your PowerShell profile (with aliases shared with zsh), prompt and Terminal settings in the repo |
| [Share git config across Windows and WSL](share-git-config.md) | Keep one git identity and settings for Git for Windows and Linux git |
| [Keep everything up to date](keep-up-to-date.md) | Update packages, Nix inputs and Winix itself, and roll it out to every machine |
| [Test your configuration](testing-your-config.md) | Write fast unit tests for features, platform guards and generated output with Vitest |

New to Winix? Start with [Your first config](../start/first-config.md). Every
helper and option is in the [reference](../reference/config.md); agents can
print version-matched instructions with `winix --skill`.

To try the example from a clone of the Winix repository:

```bash
cd examples/cross-platform
npx winix check
npx winix inspect --matrix
npx winix inspect --host DESKTOP
npx winix apply --dry --host wsl-work
```
