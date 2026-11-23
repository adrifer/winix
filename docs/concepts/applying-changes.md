---
title: How changes are applied
description: What winix plan and winix switch do on NixOS, WSL and macOS, and on Windows.
sidebar:
  order: 3
---

# How changes are applied

`winix plan` shows what would change; `winix switch` changes it. Both start the
same way: Winix runs your config, merges what the selected host declares, and
generates the output for it (`switch` and `apply` write it to `.winix/out/`,
which is git-ignored). What happens next depends on the platform.

## NixOS, WSL and macOS

Winix writes an ordinary Nix flake:

```text
.winix/out/
  flake.nix          inputs from your workspace, one configuration per host
  flake.lock         copied from your project's flake.lock
  hosts/<host>.nix   the merged NixOS, nix-darwin and Home Manager options
```

`switch` then runs the platform's own tool on it:

```bash
sudo nixos-rebuild switch --flake path:/home/alice/dotfiles/.winix/out#wsl-work
sudo darwin-rebuild switch --flake path:/Users/alice/dotfiles/.winix/out#macbook
```

From there it's plain Nix: builds, generations and rollbacks work as they
always do. `winix plan` prints the command; `winix apply --dry` prints the
generated files and `winix apply --diff` what changed since the last run. You
can run the flake yourself without Winix.

## Windows

Windows has no Nix, so Winix applies the host itself, in three phases.

**Generate.** Each declaration becomes a resource in
`.winix/out/<host>/resources.json`: what it is, what it depends on, whether it
needs administrator rights, and how to check and apply it.

**Plan.** Winix checks every resource against the machine:

- packages come from one `winget export` (a batched DSC read confirms any it
  doesn't list);
- every other resource runs its own check, isolated, so one that can't be
  checked is marked `?` without hiding the rest.

The plan lists only what differs:

```text
Plan for desktop: 5 changes, 1 removal, 47 unchanged
  + install  DEVCOM.JetBrainsMonoNerdFont                  3.3.0                [admin]
  ~ upgrade  Git.Git                                       2.55.0.3 → 2.56.0.4  [admin]
  ~ upgrade  JesseDuffield.lazygit                         0.64.0 → 0.66.1      [running]
  ~ apply    link localAppData\nvim -> ../nvim/.config/nvim
  ~ apply    Enable Windows features Microsoft-Windows-Subsystem-Linux, VirtualMachinePlatform  [admin]
  - remove   Old.App (winget package)                      no longer declared; uninstalls it
  = 47 unchanged (30 packages, 12 files, 2 settings, ...)
  i 3 packages newer than locked (kept; switch offers to update the lock): Microsoft.PowerShell, ...

  ! Switch asks once for administrator approval (UAC) for the 3 [admin] rows.
  ! Close lazygit.exe (pid 12156) before switching: winget cannot upgrade a running portable app.
  ! Uninstalling a package can remove its application data.
  ! Enable Windows features ... can require a Windows restart; Winix never restarts Windows.
```

| Mark | Means |
|---|---|
| `+` | install |
| `~` | change (an upgrade, a file to link, a setting to set) |
| `-` | remove something Winix created and you no longer declare ([What Winix owns](ownership.md)) |
| `!` | conflict, such as an exact pin older than what's installed: switch fails rather than downgrade |
| `?` | couldn't be checked |
| `=` | already as declared |
| `[admin]` | runs in the elevated step |
| `[running]` | a program to close first |

**Apply.** `switch` makes the same plan, asks before removing anything, and
then applies only what differs, in dependency order:

- packages with `winget install` / `winget upgrade`, by exact id, source and
  version;
- files, links, PATH, PowerShell modules, startup entries and WSL distros
  through one PowerShell 7 runner that checks, applies and checks again;
- registry environment variables, Windows settings and `windows.dsc()`
  resources with DSC;
- `windows.raw()` commands, which have no check and run on every switch.

In a terminal each phase shows a spinner and then one line:

```text
✓ Read 30 installed packages (2.0s)
✓ Generated .winix/out/desktop/resources.json
✓ Checked 22 resources on this machine (9.0s)

Plan for desktop: 1 change, 51 unchanged
  + install  Proton.ProtonPass  1.43.0
  = 51 unchanged (29 packages, 12 files, ...)

Applying 1 change:
  ✓ install Proton.ProtonPass 1.43.0 (45s)
Applied 1, already in place 0, failed 0, skipped 0.
✓ Verified 32 managed resources (2.4s)

Done in 1m 01s.
```

When nothing differs, a switch takes about as long as the plan: seconds.

### One administrator prompt

Run `winix switch` as your normal user, not from an elevated terminal: per-user
packages and some settings fail when everything runs elevated. Whatever needs
administrator rights (machine-wide installs, packages without a per-user
installer, Windows features, machine environment variables, Windows settings,
resources marked `elevate: true`) runs together in **one elevated step**, with
one UAC prompt. The prompt can open behind other windows. No prompt appears
when nothing machine-wide changes.

To get per-user installers where packages offer them, set WinGet's
`installBehavior.preferences` to `"scope": "user"` and, since many manifests
don't declare a scope, `"installerTypes": ["portable", "zip"]`.

### Running programs

winget replaces portable apps (zip and exe tools such as lazygit) in place, so
upgrading one while it runs fails and can remove its command. The plan marks
those `[running]`, and `switch` stops before applying anything until you close
them.

### When something fails

A failed step only skips what depends on it. Switch reports every failure,
exits with an error, and the next switch retries what's still out of date. A
failed **upgrade** doesn't skip its dependents, since the older version is
still installed. When Windows needs a restart (enabling WSL often does),
restart yourself and switch again: Winix never restarts Windows or shuts down
WSL.

Only one switch runs at a time. An interrupted one (a closed terminal) leaves a
lock behind, which the next switch removes once that process is gone.

### Drift

The plan compares with the machine, not with the last switch, so anything
changed outside Winix (a file edited in place, a setting toggled by hand) shows
up as `~` and the next switch puts it back.

### From WSL, Linux or macOS

Checking a Windows machine needs native Windows with PowerShell 7 and DSC.
Elsewhere, `winix plan --host DESKTOP` lists what the host declares instead,
which is still useful for reviewing a change before you switch on the PC.
