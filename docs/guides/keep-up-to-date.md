---
title: Keep everything up to date
description: Update packages, Nix inputs and Winix itself on purpose, and roll the change out to every machine.
sidebar:
  order: 6
---

# Keep everything up to date

Versions only move when you move them
([Versions and locks](../concepts/versions-and-locks.md)). An update is a
commit like any other: update the locks on one machine, try it, commit, and
the other machines pick it up with `git pull` and `winix switch`.

## Windows packages

On the PC:

```powershell
winix update --dry    # what would change
winix update          # write the new versions to winix-windows.lock
winix plan            # the upgrades it means for this machine
winix switch
git commit -am "Update Windows packages"
```

To move only some pins:

```powershell
winix update JesseDuffield.lazygit Git.Git
winix update fonts          # font downloads
winix update nixos-wsl      # the NixOS-WSL image for new distros
```

### Apps that updated themselves

When an app updates itself past the lock, switch keeps the newer version and
offers to raise the pin:

```text
JesseDuffield.lazygit: installed 0.66.3, locked 0.66.1. Update winix-windows.lock to 0.66.3? [y/N/a]
```

`a` accepts this one and all the rest. To accept them all without being asked,
for example in a script:

```powershell
winix switch --update-versions
```

Commit the lock afterwards so other machines get those versions too. Apps that
always update themselves are easier as `{ version: "any" }`: they never enter
the lock.

## Nix inputs (NixOS, WSL, macOS)

Inside WSL, or on the Linux or macOS machine:

```bash
winix update --dry        # which inputs have newer commits
winix update              # rewrite flake.lock
winix update nixpkgs      # just one input
winix switch
git commit -am "Update flake inputs"
```

An update of nixpkgs updates every Nix package at once. If something breaks,
`git checkout flake.lock` and switch again, or use NixOS's own rollback
(`sudo nixos-rebuild switch --rollback`).

## Winix itself

Your config pins one Winix version, which every machine runs
([The winix command](../concepts/the-winix-command.md)). To move to a new
release, read the [CHANGELOG](../../CHANGELOG.md), then change the pin in your
config's `package.json`:

```json
"@adrifer/winix": "0.3.2"
```

If you use the npm package and commit `package-lock.json`, let npm change both:

```bash
npm install --save-exact @adrifer/winix@0.3.2
```

Run `winix check` and `winix plan` (the first run downloads the new version),
then commit.

## Rolling it out

On every other machine:

```bash
git -C ~/dotfiles pull
winix switch
```

A Windows PC and its WSL distro have **separate checkouts**: pull and switch in
both. The `winix` command picks up a new Winix pin by itself.
