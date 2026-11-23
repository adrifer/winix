---
title: Packages
description: windows.package for WinGet and Microsoft Store apps - ids, sources, version policies, elevation and finding ids.
sidebar:
  order: 1
---

# Packages

```ts
windows.package("Git.Git");                                 // WinGet, locked version
windows.package("Valve.Steam", { version: "any" });         // installed, never pinned
windows.package({ id: "Git.Git", version: "2.44.0" });      // exactly this version
windows.package({ source: "msstore", id: "9NKSQGP7F2NH" }); // Microsoft Store
```

`windows.package(id, options?)` or `windows.package({ id, ...options })`:

| Option | |
|---|---|
| `id` | The WinGet id (`Git.Git`) or Store product id. Case-insensitive. |
| `source` | `"winget"` (default) or `"msstore"`. |
| `version` | Omitted: locked in `winix-windows.lock`. A version: exactly that one. `"any"`: whatever is installed. |
| `elevated` | `true` when the package's installers need administrator rights and WinGet can't tell (Winix sets this for `Microsoft.WSL`). |
| `dependsOn` | Handles to install after. |

The version policies, and what each does when the installed version differs:
[Versions and locks](../../concepts/versions-and-locks.md#windows-package-versions).

## Finding ids

```powershell
winix windows search lazygit
```

searches WinGet and prints the declaration for each result. To list what a PC
already has that the host doesn't declare, with lines to paste:
`winix windows import` ([Move a Windows machine to Winix](../../guides/move-a-windows-machine.md)).

## How packages are installed

- One `winget export` per switch tells Winix what's installed; packages it
  doesn't list are confirmed with a batched DSC read before anything is
  installed.
- Installs and upgrades use `winget install` / `winget upgrade` with the exact
  id, source and version.
- **Scope**: an upgrade keeps the scope the package was installed with, and a
  machine-wide one joins the elevated step. For installs, WinGet picks the
  installer; to prefer per-user installers, set WinGet's
  `installBehavior.preferences` to `"scope": "user"` and
  `"installerTypes": ["portable", "zip"]`.
- **Running apps**: a portable app (zip and exe tools like lazygit) can't be
  upgraded while it runs; switch asks you to close it first.
- **Removal**: deleting a declaration uninstalls the package only if Winix
  installed it ([What Winix owns](../../concepts/ownership.md)).

[`examples/windows`](../../../examples/windows) shows every package form.
