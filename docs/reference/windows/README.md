---
title: Windows
description: Every windows.* helper at a glance, plus what they share - handles and dependsOn, paths, and administrator rights.
sidebar:
  label: Overview
  order: 0
---

# Windows

Declare a Windows host with `platforms.windows()` and use `windows.*` in its
features:

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  const node = windows.package("OpenJS.NodeJS.LTS");
  windows.env.set("NODE_OPTIONS", "--max-old-space-size=8192");
  windows.file.symlink(windows.knownFolder.userProfile(".npmrc"), "./dotfiles/npmrc", { dependsOn: node });
});
```

How they're checked and applied: [How changes are applied](../../concepts/applying-changes.md).
Every signature and option: [API: windows](../../api/windows.md).

## Every helper

| Helper | Manages | Page |
|---|---|---|
| `windows.package()` | WinGet and Microsoft Store packages | [Packages](packages.md) |
| `windows.file.text()`, `.symlink()`, `.copy()`, `.remove()` | Files and dotfile links | [Files](files.md) |
| `windows.powershell.profile()`, `windows.terminal.settings()` | The PowerShell profile and Windows Terminal settings | [Files](files.md#powershell-profile-and-terminal-settings) |
| `windows.env.set()`, `.remove()`, `windows.path.add()`, `.remove()` | Environment variables and PATH | [Environment and settings](environment-and-settings.md) |
| `windows.setting()` | Windows settings (Developer Mode, color mode, taskbar…) | [Environment and settings](environment-and-settings.md#windows-settings) |
| `windows.optionalFeature()` | Optional Windows features | [Environment and settings](environment-and-settings.md#optional-features) |
| `windows.personalization()`, `windows.wallpaper()` | Accent color, Explorer and taskbar options, wallpaper | [Appearance and fonts](appearance-and-fonts.md) |
| `windows.fonts()` | Fonts, including Nerd Fonts | [Appearance and fonts](appearance-and-fonts.md#fonts) |
| `windows.startup.app()`, `.shortcut()`, `.explorer()` | Programs started at sign-in | [Startup](startup.md) |
| `windows.powershell.module()`, `.repositories()` | PowerShell modules and the feeds they come from | [Feeds](feeds.md) |
| `windows.npm.registries()` | npm registries | [Feeds](feeds.md#npm-registries) |
| `windows.wsl()`, `windows.wsl.distro()` | WSL and NixOS-WSL distros | [WSL distros](../wsl.md) |
| `windows.dsc()`, `windows.raw()` | Anything else: a DSC resource, a command | [Environment and settings](environment-and-settings.md#escape-hatches) |
| `windows.knownFolder.*()`, `windows.configPath()` | Paths | Below |

## Ordering: handles and dependsOn

Every resource helper returns a **handle**. Pass handles to another resource's
`dependsOn` to apply it after them:

```ts
const icons = windows.powershell.module("Terminal-Icons");
windows.powershell.profile("./dotfiles/powershell/profile.ps1", { dependsOn: icons });
```

Without `dependsOn`, don't rely on any order. Some dependencies are
automatic: a WSL distro after WSL itself, PowerShell modules after a declared
`Microsoft.PowerShell` package, symlinks after `windows.setting({ DeveloperMode: true })`.
A file handle used as a path (in a startup app's arguments, for example) adds
the dependency too. A handle from another host is an error.

When a resource fails, only what depends on it is skipped.

## Paths

**Targets** (where something goes on the machine) take:

- a known folder, resolved on the machine when the switch runs, so a
  redirected Documents folder (OneDrive) works:
  `windows.knownFolder.documents("PowerShell\\profile.ps1")`. Folders:
  `documents`, `desktop`, `localAppData`, `appData`, `userProfile`,
  `programFiles`, `programFilesX86`. The child path must stay inside the folder;
- an environment-variable path: `"%LOCALAPPDATA%\\nvim"`;
- an absolute path: `"C:\\tools\\config.json"`.

**Sources** (files from your repository) starting with `./` or `../` are
relative to the folder holding `winix.config.ts`, wherever the feature file is.
Absolute paths, `%VARIABLE%` paths and `file:` URLs work too.

`windows.configPath("..")` returns the absolute path of a folder relative to
`winix.config.ts`, for values that aren't file sources, such as an environment
variable pointing at your repositories.

In TypeScript strings, a Windows path needs doubled backslashes
(`"lazygit\\config.yml"`); forward slashes also work in most places.

## Administrator rights

Resources that need administrator rights (machine-wide packages, optional
features, machine environment variables, Windows settings, anything with
`elevate: true`) run together in one elevated step, with one UAC prompt per
switch. Run `winix switch` as your normal user.
