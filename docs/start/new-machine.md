---
title: Set up a new machine
description: Bootstrap a fresh Windows PC or Linux machine from your dotfiles repository with one confirmation.
sidebar:
  order: 4
---

# Set up a new machine

Once your config is in a Git repository, a new machine needs no manual
installs. A bootstrap script clones the repository, installs what Winix needs,
downloads the Winix version the repository pins, asks which host this machine
is, and applies it. It asks you once, up front; after that only administrator
prompts (UAC on Windows, `sudo` on Linux) and removal confirmations interrupt.

## On Windows

Run this from Windows PowerShell or PowerShell 7, as your normal user (not an
elevated window). Use the Winix version your repository pins:

```powershell
$version = "0.3.2"
$base = "https://github.com/adrifer/winix/releases/download/v$version"
Invoke-WebRequest "$base/bootstrap-windows.ps1" -OutFile "$env:TEMP\bootstrap-windows.ps1"
Invoke-WebRequest "$base/bootstrap-windows.ps1.sha256" -OutFile "$env:TEMP\bootstrap-windows.ps1.sha256"

$expected = ((Get-Content "$env:TEMP\bootstrap-windows.ps1.sha256") -split '\s+')[0]
if ((Get-FileHash "$env:TEMP\bootstrap-windows.ps1" -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch" }

powershell.exe -NoProfile -File "$env:TEMP\bootstrap-windows.ps1" `
  -Repository https://github.com/you/dotfiles.git -Ref main `
  -Destination "$HOME\dotfiles" -ConfigDirectory winix
```

Review the script before you run it, and run it through an execution route your
organization allows: it doesn't change the execution policy.

Windows needs App Installer (WinGet) to start with. A fresh account sometimes
has it installed but not registered yet; the script registers it, and when
WinGet is truly missing it opens the Microsoft Store page instead of
downloading unsigned installers. From there it installs Git, PowerShell 7 and
DSC with WinGet.

## On Linux

On NixOS, NixOS-WSL or another Linux with Nix or with Git and Python 3:

```bash
version=0.3.2
base=https://github.com/adrifer/winix/releases/download/v$version
curl -fLO "$base/bootstrap-linux.sh"
curl -fLO "$base/bootstrap-linux.sh.sha256"
sha256sum --check bootstrap-linux.sh.sha256

bash bootstrap-linux.sh --repository https://github.com/you/dotfiles.git \
  --ref main --destination "$HOME/dotfiles" --config-directory winix
```

With Nix available, it borrows Git and Python from a pinned nixpkgs for the
duration of the run. It doesn't install Nix, and it doesn't turn another
distribution into NixOS. On NixOS it sets up a pinned loader so the Linux
executable runs there.

## What happens

1. **One confirmation**, listing everything it will do: clone, prerequisites,
   the Winix download, evaluating your config, applying the host. Evaluating a
   config runs its code, so the question comes before anything is evaluated.
2. **Clone** the repository. An existing checkout is reused if it has the
   expected origin; bootstrap never pulls, resets, stashes or switches branches
   in it.
3. **Prerequisites** for the platform.
4. **Winix itself**: the exact release your config's `package.json` pins,
   verified against its checksums. The config isn't imported for this; the pin
   is read as text.
5. **Pick the host.** Without `-HostName` / `--host`, it lists the hosts for
   this kind of machine (or picks the only one, or the one named like this
   computer). The choice is saved in the checkout's ignored `.winix/host`, so
   later commands need no `--host`, even on a PC named `DESKTOP-7Q2K9XF`.
6. **Check, plan and switch** the host.
7. **Install the `winix` command** for your user (below).

If something needs a restart (enabling WSL often does), restart and run the
same command again: it reuses the checkout, the host choice and the downloads,
and continues.

| Option (Windows / Linux) | Does |
|---|---|
| `-HostName` / `--host` | Use this host instead of asking. |
| `-DryRun` / `--dry-run` | Show what would happen; change nothing (no clone, no downloads). |
| `-PrepareOnly` / `--prepare-only` | Prepare everything, then check and plan, but stop before applying. |
| `-Yes` / `--yes` | Accept the confirmation (and removals) without asking; pass the host too. |

**Private repositories** clone with Git's own credentials (Git Credential
Manager on Windows). Never put credentials in the URL or in a script.

## Afterwards: the `winix` command

Bootstrap installs a `winix` command for your user:
`%LOCALAPPDATA%\Winix\bin` on Windows (added to your user `PATH`) and
`~/.local/bin/winix` on Linux (add it to `PATH` in your shell or Home Manager
config; bootstrap tells you when it's missing). From any folder:

```bash
winix plan
winix switch
```

It always runs the Winix version the checkout pins, so bumping the pin in the
repository updates every machine on its next run. On any machine, updating is:

```bash
git -C ~/dotfiles pull
winix switch
```

How it finds the checkout and the version: [The winix command](../concepts/the-winix-command.md).

**WSL distros** that a Windows host creates get the command as part of their
setup ([Pair Windows with WSL](../guides/pair-windows-and-wsl.md)). For a distro
you set up yourself, run `bootstrap-linux.sh` inside it, or, from its config
directory with a Winix executable, `winix bootstrap --command-only --host <name>`,
which only remembers the host and installs the command.

## A one-line setup for your repository

A dotfiles repository can wrap all of this in a small script of its own: read
its pinned Winix version, download that release's bootstrap script, check it,
and run it with the repository's defaults. A fresh PC then needs:

```powershell
irm https://raw.githubusercontent.com/you/dotfiles/main/setup/windows.ps1 -OutFile $env:TEMP\setup.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
```

Leave out `-HostName` and the bootstrap asks which host the machine is.

## Only the prerequisites

To prepare a machine without cloning or applying anything:

```powershell
# Report what's missing, change nothing:
powershell.exe -NoProfile -File .\bootstrap-windows.ps1 -Standalone -Check
# Install what the standalone executable needs (Git, PowerShell 7, DSC):
powershell.exe -NoProfile -File .\bootstrap-windows.ps1 -Standalone
```

Without `-Standalone`, it also installs Node.js and npm for the npm package
(`-UseNvm` uses NVM for Windows instead). These prerequisites are not part of
any host: they aren't in `winix-windows.lock`, and removing them is up to you.

On NixOS, `bootstrap-nixos.sh` (also in every release) opens a temporary shell
with Git, Node.js 24 and npm from a pinned nixpkgs, with flakes enabled, for
running Winix through npm by hand. It installs nothing into your profile or
system.
