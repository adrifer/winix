---
title: The winix command
description: How the winix command finds your checkout, runs the Winix version it pins, and updates itself.
sidebar:
  order: 6
---

# The winix command

After [bootstrap](../start/new-machine.md), `winix` works from any folder and
always runs the Winix version your repository pins. That's what lets you update
Winix on every machine by changing one line in the repository.

## The pin

Your config's `package.json` pins Winix to an exact version, or to the matching
release tarball on GitHub:

```json
{
  "dependencies": {
    "@adrifer/winix": "0.3.2"
  }
}
```

Version ranges (`^0.3.2`), local links and other URLs are refused: bootstrap
and the `winix` command need to know exactly which release to download.
`winix init` writes an exact pin.

## What runs

```text
winix switch
  └─ %LOCALAPPDATA%\Winix\bin\winix.cmd   (Linux: ~/.local/bin/winix)
      └─ <checkout>\.winix\bin\winix.ps1   (Linux: .winix/bin/winix)
          └─ winix run switch
              └─ the pinned release, from .winix/runtime/<version>/
```

1. The per-user command calls the launcher in the checkout bootstrap set up.
2. The launcher runs `winix run <your arguments>` from the config directory.
3. `run` reads the pin. When that release isn't downloaded yet, it downloads
   the executable and checks it against the release's `SHA256SUMS` before
   running it. On NixOS it runs through a pinned loader.
4. The host comes from `--host`, or from `.winix/host`, which bootstrap wrote.

Older downloaded versions are cleaned up, keeping the one the launcher falls
back to.

## Updating Winix

Change the pin, commit, and on each machine:

```bash
git -C ~/dotfiles pull
winix switch
```

The first `winix` after the pull downloads the new version. Nothing else to
install. [Keep everything up to date](../guides/keep-up-to-date.md#winix-itself)
shows how to move the pin.

## npm and node_modules

An installed `node_modules/@adrifer/winix` never changes what the `winix`
command runs. `npx winix` and `npm run` scripts keep using the local npm copy
as usual; that's the route on macOS, which has no standalone executable yet.

## Running another Winix

To run a different Winix through the `winix` command on purpose, such as a
source checkout while working on Winix itself, set `WINIX_SDK` to its package
directory (absolute, or relative to the config directory):

```powershell
$env:WINIX_SDK = 'D:\src\winix'; winix plan
```

It prints which Winix it runs and the version the checkout pins, and needs
Node.js 22.13+, 24 or 26.
