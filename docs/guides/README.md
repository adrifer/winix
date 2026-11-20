---
title: Guides
description: Task-focused recipes for Winix. The README stays the reference.
---

# Guides

Recipes for things people set up on day one. Each guide quotes
[`examples/cross-platform`](../../examples/cross-platform), a runnable
workspace with a Windows desktop, the NixOS-WSL distro it provisions, and a
Mac, organised as machines → roles → features (see its README). Its test
(`tests/cross-platform-example.test.ts`) keeps the code here working.

| Guide | You want to… |
|---|---|
| [Write a cross-platform feature](cross-platform-feature.md) | Declare a tool once and get it on Linux, WSL, macOS and Windows |
| [Pair a Windows host with its WSL host](pair-windows-and-wsl.md) | Have Windows create a NixOS-WSL distro and set it up from the same checkout |
| [Share git config across Windows and WSL](share-git-config.md) | Keep one git identity and settings for Git for Windows and Linux git |
| [PowerShell profile and Windows Terminal](powershell-and-terminal.md) | Keep your PowerShell profile (with aliases shared with zsh), prompt and Terminal settings in the repo |

For every option a helper takes, see the [reference](../README.md). Agents can
print version-matched instructions with `winix --skill`.

To try the example from a clone of this repository:

```bash
cd examples/cross-platform
npx winix check
npx winix inspect --matrix
npx winix inspect --host DESKTOP
npx winix apply --dry --host wsl-work
```
