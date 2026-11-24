---
title: Move a Windows machine to Winix
description: Bring the apps, dotfiles and settings of a PC you already use into your config, without reinstalling anything.
sidebar:
  order: 3
---

# Move a Windows machine to Winix

You don't need a fresh PC to start. Winix adopts what's already installed: it
keeps it as declared from then on, and never uninstalls it
([What Winix owns](../concepts/ownership.md)). This guide brings an existing
PC's apps, config files and settings into your config a piece at a time.

You need a config with a Windows host for this PC; [Your first
config](../start/first-config.md) gets you there.

## 1. List what's installed

```powershell
winix windows import
```

It compares what WinGet reports as installed with what the host declares, and
prints lines to paste:

```text
Host DESKTOP: 64 installed winget/msstore package(s), 3 declared.

Installed but not declared (41). Paste the ones you want into a feature:
  windows.package("7zip.7zip");
  windows.package("Discord.Discord");
  windows.package("Git.Git");
  windows.package("Microsoft.VisualStudioCode");
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" });
  ...

Shared runtimes, usually installed as dependencies (12); declare only if you rely on them directly:
  Microsoft.VCRedist.2015+.x64, Microsoft.DotNet.DesktopRuntime.8, ...

Add { version: "any" } for apps that update themselves. Packages Winix did not install
stay externally owned: removing their declaration later never uninstalls them.
```

It only reads; nothing changes. Apps not installed through WinGet or the Store
aren't listed; find their ids with `winix windows search <name>`.

## 2. Declare the ones you want

Paste each into a feature where it belongs, not all into one list: the
lines are easier to keep once each tool has a home. Some patterns:

```ts
// features/apps/browsers.ts: apps that update themselves
export const browsers = feature("browsers", ({ windows }) => {
  windows.package("Mozilla.Firefox", { version: "any" });
  windows.package("Google.Chrome", { version: "any" });
});

// features/cli/git.ts: a tool you also want on Linux
export const git = feature("git", ({ home, windows }) => {
  home.program("git");
  windows.package("Git.Git");
});
```

Use `{ version: "any" }` for anything that updates itself (browsers, chat apps,
launchers). Leave the rest locked: the first switch pins the installed version
in `winix-windows.lock`, so your next PC gets the same one
([Versions and locks](../concepts/versions-and-locks.md)).

## 3. Plan

```powershell
winix plan
```

Packages that are already installed show up as unchanged. Expect a few
differences:

- **`~ upgrade`** when the lock is newer than what's installed. Fine; or pin
  what you have with an exact version for now.
- **`i ... newer than locked`** when an app updated itself past the lock. Switch
  offers to raise the lock.
- **`= keep` with a `!` note** for a package another installer put there that
  WinGet can't upgrade, such as an organization's PowerShell MSI. Winix leaves
  it alone.

Switch when the plan looks right. Everything Winix found already installed is
adopted, not owned: deleting a declaration later leaves the app installed.

## 4. Bring in your config files

For each config file you care about (a PowerShell profile, `.gitconfig`,
Windows Terminal settings), copy the current one into the repository, then
link it back:

```powershell
Copy-Item $PROFILE .\dotfiles\powershell\Microsoft.PowerShell_profile.ps1
```

```ts
windows.powershell.profile("./dotfiles/powershell/Microsoft.PowerShell_profile.ps1");
windows.terminal.settings("./dotfiles/terminal/settings.json");
windows.file.symlink(windows.knownFolder.userProfile(".wezterm.lua"), "./dotfiles/wezterm/.wezterm.lua");
```

The first switch moves each existing file to `<file>.bak` and puts the link in
its place. If a `.bak` already exists, the switch stops rather than overwrite
it. Links are live: editing the file in the repository changes it on the
machine, with no switch.

Symlinks need Developer Mode (`windows.setting({ DeveloperMode: true })`, which
Winix orders before every link) or an elevated shell. More in
[PowerShell profile and Windows Terminal](powershell-and-terminal.md).

## 5. Settings and the rest

Work through what you'd otherwise set up by hand on a new PC:

| You want | Declare |
|---|---|
| Dark mode, accent colour, taskbar and Explorer options | `windows.personalization({ ... })` |
| Developer Mode, time zone, Start menu folders | `windows.setting({ ... })` |
| Environment variables and PATH | `windows.env.set()`, `windows.path.add()` |
| Fonts | `windows.fonts({ sources: [...] })` |
| Apps that start at sign-in | `windows.startup.app()` |
| WSL with a NixOS distro | [Pair Windows with WSL](pair-windows-and-wsl.md) |

All of them: [Windows reference](../reference/windows/README.md).

## 6. Check it on the next machine

The real test is a fresh PC: run the [install script with your repository](../start/new-machine.md) there
and see what's missing. Whatever you set up by hand afterwards is the next
thing to declare.
