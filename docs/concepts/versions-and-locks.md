---
title: Versions and locks
description: How Winix pins versions in flake.lock and winix-windows.lock, the three package version policies, and how updates happen.
sidebar:
  order: 4
---

# Versions and locks

Every machine built from the same commit gets the same versions. Two files in
your repository make that true; commit both:

| File | Pins | Written by |
|---|---|---|
| `flake.lock` | Nix inputs (nixpkgs, Home Manager, NixOS-WSL, nix-darwin) at exact commits, and through them every Nix package | `winix update` |
| `winix-windows.lock` | WinGet packages, PowerShell modules, fonts, NixOS-WSL images and the commit a new WSL distro is set up from | the first `winix switch` that needs a pin, and `winix update` |

Nothing changes version behind your back: versions move when you run
`winix update` (or accept the switch prompt below), and the change shows up as
a diff in your repository.

## Windows package versions

A package's `version` picks one of three policies:

```ts
windows.package("Git.Git");                             // locked (the default)
windows.package({ id: "Git.Git", version: "2.44.0" }); // exact
windows.package("Valve.Steam", { version: "any" });     // any version
```

- **Locked**, the default, for most tools. The first switch pins the version
  WinGet offers in `winix-windows.lock`; every machine then installs that
  version until `winix update` moves the pin. A newer version already
  installed is kept, and switch offers to raise the lock to it.
- **Exact**, for tools that must be one specific version. Anything else fails
  the switch; Winix never downgrades.
- **Any**, for apps that update themselves (browsers, launchers, Teams) or that
  WinGet reports no usable version for. Installed when missing, otherwise left
  alone, and never in the lock.

What each policy does in every situation:

| | Exact | Locked (default) | Any |
|---|---|---|---|
| In `winix-windows.lock` | The inline version | Pinned on first switch | No |
| Not installed | Installs that version | Installs the locked version | Installs what WinGet offers |
| Installed, older | Switch fails | Upgraded to the lock | Left alone |
| Installed, newer | Switch fails; never downgraded | Kept; switch offers to update the lock | Left alone |
| WinGet reports `Unknown` | Switch fails | Kept, with a warning each switch | Left alone |
| Older, installed by an installer WinGet can't upgrade | Switch fails | Kept; the plan says how to hand it to WinGet | Left alone |
| `winix check` warns when missing from the lock | No | Yes | No |

`"latest"` and `"*"` aren't versions: there is no always-upgrade mode. Use
locked and `winix update`.

### When the installed version is newer

Apps that update themselves end up newer than the lock. Switch keeps them and,
after a successful interactive switch, asks:

```text
JesseDuffield.lazygit: installed 0.66.3, locked 0.66.1. Update winix-windows.lock to 0.66.3? [y/N/a]
```

`a` answers yes for this package and every one after it. Saying no keeps the
lock and still completes the switch. `winix switch --update-versions` raises
every such pin without asking, which suits a setup script. Dry runs and
non-interactive switches never ask.

### Packages WinGet can't upgrade

Some machines have a package another installer put there, such as an
organization's repackaged PowerShell 7 MSI. WinGet lists it by name but can't
upgrade it by id. The plan keeps it (`= keep` with a `!` note) instead of
failing the switch. To let Winix manage it, uninstall that copy and switch
again: Winix installs the locked version from WinGet.

## The other Windows pins

The same file has sections for everything else Winix downloads:

| Section | Pins | Update just those |
|---|---|---|
| `packages` | WinGet versions | `winix update <id>` |
| `modules` | PowerShell modules, per repository | `winix update <name>` |
| `fonts` | Font downloads and their checksums | `winix update fonts` |
| `wslImages` | NixOS-WSL image URLs and SHA-256, for x64 and ARM64 | `winix update nixos-wsl` |
| `wslRepositories` | The commit a new WSL distro's first-run setup checks out | `winix update wsl-setup` |

`winix check` warns about every pin that's missing, so a typo in a package id
shows up before a switch tries to resolve it online.

## Updating

```bash
winix update               # everything this platform can update
winix update --dry         # show what would change
winix update nixpkgs       # one flake input
winix update JesseDuffield.lazygit
```

On Windows, `winix update` updates `winix-windows.lock`. On WSL, Linux and
macOS it updates `flake.lock` with the Nix CLI; `winix update --windows`
updates the Windows lock from there too, except package versions, which need
WinGet. A failed lookup never replaces an existing pin.

## Strict modes

| Option | For |
|---|---|
| `--offline` (plan, switch, apply) | Never look anything up online; fail, naming what's missing, when a pin is absent. |
| `--locked` (plan, switch, apply) | Fail if the lock would change at all. For CI, or a machine that should only apply what's committed. |

Day-to-day updating, step by step: [Keep everything up to date](../guides/keep-up-to-date.md).
