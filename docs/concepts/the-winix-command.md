---
title: The winix command
description: How the winix command picks the Winix version and the folder to run in, and how Winix updates itself.
sidebar:
  order: 6
---

# The winix command

The [install script](../start/install.md) (or `winix install command`) puts a
`winix` command on your PATH. It works from any folder, and inside a project it
always runs the Winix version that project pins. That's what lets you update
Winix on every machine by changing one line in the repository.

## What it runs

The command runs the installed Winix (in `%LOCALAPPDATA%\Winix` or
`~/.local/share/winix`), which decides from where you are:

| Where you are | What runs |
|---|---|
| Inside a project (a `winix.config.ts` here or in a parent folder) | The version that project pins, in that project. Downloaded (checksum-verified) the first time. |
| Anywhere else, for commands that need a project (`switch`, `plan`, `update`, `check`…) | The checkout the install script set up on this machine, so `winix switch` from your home folder applies this machine. |
| Anywhere else, for the rest (`init`, `--version`, `windows search`, `--skill`) | The installed Winix, in the current folder. |

`winix init` always runs in the current folder, even inside another project.
The host comes from `--host`, or from the project's `.winix/host`, which the
install script (or `winix bootstrap`) wrote.

## The pin

A project's `package.json` pins Winix to an exact version, or to the matching
release tarball on GitHub:

```json
{
  "dependencies": {
    "@adrifer/winix": "0.3.2"
  }
}
```

Version ranges (`^0.3.2`), local links and other URLs are refused: the command
needs to know exactly which release to run. `winix init` pins the version that
created the project. Pinned releases are kept in the project's ignored
`.winix/runtime/<version>`; older ones are cleaned up after a download.

## Updating Winix

`winix upgrade` moves the pin to the latest release
([Keep everything up to date](../guides/keep-up-to-date.md#winix-itself)).
Commit it, and on each other machine:

```bash
git -C ~/dotfiles pull
winix switch
```

The first `winix` after the pull downloads the new version. Nothing else to
install. The installed copy that does the routing only matters outside your
projects (`winix init`, `--version`); rerun the install script to refresh it.

## node_modules

An installed `node_modules/@adrifer/winix` never changes what the `winix`
command runs.

## Running another Winix

To run a different Winix through the `winix` command on purpose, such as a
source checkout while working on Winix itself, set `WINIX_SDK` to its package
directory (absolute, or relative to the project):

```powershell
$env:WINIX_SDK = 'D:\src\winix'; winix plan
```

It prints which Winix it runs and the version the project pins, and needs
Node.js 22.13+, 24 or 26.
