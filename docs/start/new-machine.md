---
title: Set up a new machine
description: Set up a fresh Windows PC or Linux machine from your dotfiles repository with one command and one confirmation.
sidebar:
  order: 4
---

# Set up a new machine

Once your config is in a Git repository, a new machine needs no manual
installs. The [install script](install.md#the-install-script), pointed at your
repository, clones it, installs what Winix needs, downloads the Winix version
the repository pins, asks which host this machine is, and applies it. It asks
you once, up front; after that only administrator prompts (UAC on Windows,
`sudo` on Linux) and removal confirmations interrupt.

## On Windows

From Windows PowerShell or PowerShell 7, as your normal user (not an elevated
window):

```powershell
irm https://github.com/adrifer/winix/releases/latest/download/install.ps1 -OutFile $env:TEMP\install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\install.ps1 `
  -Repository https://github.com/you/dotfiles.git -Ref main `
  -Destination "$HOME\dotfiles"
```

The script can come from the latest release: it reads your repository's pin and
installs that version, whichever release the script itself came from.

## On Linux

On NixOS, NixOS-WSL or another Linux with Nix, or with Git and Python 3:

```bash
curl -fsSLO https://github.com/adrifer/winix/releases/latest/download/install.sh
bash install.sh --repository https://github.com/you/dotfiles.git \
  --ref main --destination "$HOME/dotfiles"
```

Both find `winix.config.ts` at the repository root, else in `winix/`. Pass
`-ConfigDirectory` / `--config-directory` for another folder.

With Nix available, it borrows Git and Python from a pinned nixpkgs for the
duration of the run. It doesn't install Nix, and it doesn't turn another
distribution into NixOS.

## What happens

1. **One confirmation**, listing everything it will do. Evaluating a config runs
   its code, so the question comes before anything is evaluated.
2. **Prerequisites** (Windows): Git, PowerShell 7 and DSC through WinGet. A
   fresh account sometimes has App Installer installed but not registered; the
   script registers it, and when WinGet is truly missing it opens the Microsoft
   Store page instead of downloading unsigned installers.
3. **Clone** the repository. An existing checkout is reused if it has the
   expected origin; the script never pulls, resets, stashes or switches branches
   in it.
4. **Winix itself**: the exact release your config's `package.json` pins,
   verified against its checksums, into `%LOCALAPPDATA%\Winix` or
   `~/.local/share/winix`. The config isn't imported for this; the pin is read
   as text.
5. **Pick the host.** Without `-HostName` / `--host`, it lists the hosts for
   this kind of machine (or picks the only one, or the one named like this
   computer). The choice is saved in the checkout's ignored `.winix/host`, so
   later commands need no `--host`, even on a PC named `DESKTOP-7Q2K9XF`.
6. **Check, plan and switch** the host.
7. **The `winix` command** for your user, which remembers this checkout (below).

If something needs a restart (enabling WSL often does), restart and run the
same command again: it reuses the checkout, the host choice and the downloads,
and continues.

| Option (Windows / Linux) | Does |
|---|---|
| `-HostName` / `--host` | Use this host instead of asking. |
| `-DryRun` / `--dry-run` | Show what would happen; change nothing. |
| `-PrepareOnly` / `--prepare-only` | Prepare everything and show the plan, but stop before applying. |
| `-Yes` / `--yes` | Accept the confirmation (and removals) without asking; pass the host too. |

**Private repositories** clone with Git's own credentials (Git Credential
Manager on Windows). Never put credentials in the URL or in a script.

## A repository without a config yet

Pointed at a repository with no Winix config (a dotfiles repository you just
created), the script installs the latest Winix and the `winix` command, clones
the repository, and stops there. Create the config in it:

```bash
cd ~/dotfiles/winix
winix init
```

Inside that folder, `winix plan` and `winix switch` already work. Once it
declares a host for this machine, run `winix bootstrap` there once: it picks
the host and remembers the checkout, so `winix switch` works from any folder.
Commit the config, and the next machine gets the full setup.

## Afterwards: the `winix` command

From any folder:

```bash
winix plan
winix switch
```

Outside a project, these use the checkout the script set up; inside a project,
that project. It always runs the Winix version the project pins, so bumping the
pin in the repository updates every machine on its next run. On any machine,
updating is:

```bash
git -C ~/dotfiles pull
winix switch
```

How it decides: [The winix command](../concepts/the-winix-command.md).

**WSL distros** that a Windows host creates get the command as part of their
setup ([Pair Windows with WSL](../guides/pair-windows-and-wsl.md)). For a distro
you set up yourself, run `install.sh --repository …` inside it.

## A one-line setup for your repository

A dotfiles repository can wrap all of this in a small script of its own, which
downloads `install.ps1` and runs it with the repository's defaults. A fresh PC
then needs:

```powershell
irm https://raw.githubusercontent.com/you/dotfiles/main/setup/windows.ps1 -OutFile $env:TEMP\setup.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
```

Leave out `-HostName` and the install script asks which host the machine is.
