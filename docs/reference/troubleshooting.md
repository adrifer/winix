---
title: Troubleshooting
description: Common issues on Windows, NixOS and WSL, and how to fix them.
sidebar:
  order: 5
---

# Troubleshooting

## Windows

### Symlinks fail with access denied

Windows restricts creating symbolic links unless **Developer Mode** is enabled
or the shell is elevated. Declare it in your Windows host:

```ts
windows.setting({ DeveloperMode: true });
```

Winix automatically orders `DeveloperMode` before every `windows.file.symlink()`,
`windows.powershell.profile()` and `windows.terminal.settings()` link. If it
was just turned on for the first time, run `winix switch` once so the elevated
step enables it.

### A file switch stops because `.bak` already exists

When a target file already exists and differs from what you declared, Winix
moves it to `<file>.bak` before replacing it. If `<file>.bak` is already
present, Winix stops rather than overwrite an earlier backup. Inspect and
remove or rename the `.bak` file, or pass `{ force: true }` on that file helper
if you don't want backups.

### Package marked `[running]` or fails to upgrade

WinGet cannot replace a running portable executable (such as `lazygit.exe` or a
terminal tool). Close the process shown in the plan and run `winix switch`
again.

### Package marked `! conflict` (installed is newer than an exact pin)

Winix never downgrades a package silently. Either raise the pinned version in
your config, switch to a floating pin (omit `version`, letting
`winix-windows.lock` track it), or use `{ version: "any" }` for apps that
update themselves ([Versions and locks](../concepts/versions-and-locks.md)).

### Package reports `"Unknown"` version in WinGet

Some installers don't report a comparable version string to WinGet. Winix
treats floating declarations for those packages as presence-only so it does not
reinstall them on every switch; use `{ version: "any" }` if you want that
intent explicit in your config.

### WSL features say a restart is required

Enabling `Microsoft-Windows-Subsystem-Linux` or `VirtualMachinePlatform` often
requires a Windows reboot. Winix **never** restarts Windows automatically, and
skips resources that depend on those features (such as `windows.wsl.distro()`).
Restart Windows when convenient and run `winix switch` again—it picks up where
it stopped.

### Moved the repo folder or switched hosts, and ownership looks wrong

Ownership records are keyed by checkout path and host name. Run
`winix state owners` to inspect existing owners and
`winix state migrate-owner <id> --host <name>` to transfer records to the new
checkout ([CLI: Windows ownership records](cli.md#windows-ownership-records)).

## NixOS and WSL

### `flake.lock` missing on first switch

On NixOS and WSL, run `winix update` once before your first `winix switch` so
Winix generates `flake.lock` alongside `winix.config.ts`, then commit it.

### `winix check` warns about a missing input

Platform options require matching flake inputs:

- Home Manager (enabled by default on NixOS/WSL/macOS) needs `homeManager`.
- `platforms.wsl()` needs `nixosWsl` (or the input name passed via `{ input }`).
- `platforms.darwin({ homebrew: true })` needs `nixHomebrew` / `nix-homebrew`.

Add the missing input in `workspace({ inputs: { ... } })`
([Workspace and hosts: Inputs](config.md#inputs)).

### Wrong `stateVersion`

`system.stateVersion` (and Home Manager's `home.stateVersion`) must match the
release the machine was first installed with—not the latest NixOS release. Check
your existing `/etc/nixos/configuration.nix` before switching a bare-metal
machine.

### NixOS build fails because disks/filesystems aren't defined

Bare-metal NixOS hosts need `/etc/nixos/hardware-configuration.nix` copied into
the repo and included via `rawModule("./hardware-configuration.nix")`. WSL
hosts don't need it (`platforms.wsl()` provides the WSL module instead).

### WSL first-run setup failed partway through

WSL setup is staged and resumable, and never resets a checkout with local
changes:

- **Unpushed commit:** setup resolves the commit on the remote before cloning
  inside the distro. Push your branch first, then run `winix switch` again.
- **Private repository:** setup does not inject credentials; ensure Git
  authentication inside the distro works, or clone manually and adopt the
  distro instead ([WSL distros: Adopting](wsl.md#adopting)).
- **Transient network/build error:** just run `winix switch` again on Windows;
  it resumes from the failed stage.

## Config and editor

### Editor shows missing module or stale autocomplete

Run `winix types` (or any config command like `winix check`) to regenerate
`.winix/types`, and verify `tsconfig.json` has the `paths` entries printed by
`winix types` ([Install: Editor support](../start/install.md#editor-support)).

### Nix option rejected at build time (camelCase vs kebab-case)

Winix never rewrites option keys. Use the exact Nix option name—for example
`"experimental-features"`, not `experimentalFeatures`. Only flake input keys in
`defineInputs()` convert from camelCase to kebab-case.

### Unexpected override between features

Run `winix check --strict` to surface scalar conflicts across features, and
`winix inspect --host <name>` to see which feature declared each option. Use
`nix.lib.mkDefault()` or `nix.lib.mkForce()` when an override is intentional
([How declarations combine](../concepts/features-and-hosts.md#how-declarations-combine)).
