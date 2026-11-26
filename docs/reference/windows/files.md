---
title: Files
description: windows.file for text files, dotfile links and copies, the PowerShell profile and Terminal settings, and how existing files are backed up.
sidebar:
  order: 2
---

# Files

```ts
windows.file.symlink(windows.knownFolder.localAppData("nvim"), "./dotfiles/nvim");
windows.file.copy(windows.knownFolder.appData("tool\\config.json"), "./dotfiles/tool.json");
windows.file.text(windows.knownFolder.userProfile(".gitconfig"), "[user]\n\tname = Alice\n");
windows.file.remove("%USERPROFILE%\\.oldrc");
```

| Helper | Makes the target |
|---|---|
| `windows.file.symlink(target, source, opts?)` | A link to `source`. Live: editing the file in your checkout changes it on the machine, with no switch. |
| `windows.file.copy(target, source, opts?)` | A copy of `source`. A copy changed on the machine is replaced by the next switch. |
| `windows.file.text(target, content, opts?)` | A file with exactly this content. |
| `windows.file.remove(target, opts?)` | Absent. |

`target` is a known folder, a `%VARIABLE%` path or an absolute path; `source`
is relative to `winix.config.ts` ([Paths](README.md#paths)).

| Option | |
|---|---|
| `backup` | Default `true`: move a differing existing target to `<target>.bak` first. `false`: fail instead of replacing it. |
| `force` | Replace a differing target without a backup (`backup: true` still backs up). Never deletes a directory with files in it. |
| `recursive` | For a directory `symlink`: create the directory tree and link each file, instead of linking the directory itself. |
| `encoding` | For `text`: `"utf8"` (default), `"utf8bom"` or `"ascii"`. |
| `elevate` | Write in the elevated step, for targets your user can't write. |
| `dependsOn` | Handles to apply after. |

## Existing files

The first time Winix takes over a file that already exists and differs, it
moves the existing one to `<target>.bak` and puts its own in place. If that
`.bak` already exists, the switch stops rather than overwrite it. A target that
already matches is left alone.

Deleting a declaration leaves the file where it is: removal isn't tracked for
files yet.

## Symlinks and Developer Mode

Creating symlinks on Windows needs Developer Mode or an elevated process.
Declare it once and Winix orders it before every link:

```ts
windows.settings.developer({ mode: true });
```

Winix never turns Developer Mode on just because you declared a link. Without
it, use `copy` (or `mode: "copy"` below), or links fail.

Links point into your checkout, so keep the checkout where it is. When you
generate from WSL, sources inside the Linux filesystem become WSL network (UNC)
paths, so that distro must be available whenever Windows reads the file.

## PowerShell profile and Terminal settings

Named targets for two files most Windows configs have:

```ts
windows.powershell.profile("./dotfiles/powershell/Microsoft.PowerShell_profile.ps1");
windows.terminal.settings("./dotfiles/terminal/settings.json", { channel: "preview" });
```

| | Target |
|---|---|
| `windows.powershell.profile(source, opts?)` | PowerShell 7's current-user profile, `Documents\PowerShell\Microsoft.PowerShell_profile.ps1`, following a redirected Documents folder. `shell: "windowspowershell"` targets Windows PowerShell 5.1. |
| `windows.terminal.settings(source, opts?)` | The packaged Windows Terminal's `LocalState\settings.json`. `channel: "stable"` (default) or `"preview"`. |

Both link by default; `mode: "copy"` copies instead. They also take `backup`,
`force` and `dependsOn`. Walkthrough:
[PowerShell profile and Windows Terminal](../../guides/powershell-and-terminal.md).
