---
title: Install
description: Install Winix with one script, by hand, or with npm, plus editor and agent support.
sidebar:
  order: 2
---

# Install

| You have | Do this |
|---|---|
| Nothing yet, and want to start a config | [The install script](#the-install-script): prerequisites, the latest Winix and a `winix` command |
| A repository with your config | [Set up a new machine](new-machine.md): the same script, pointed at your repository |
| Rules about what you run | [The executable by hand](#the-executable-by-hand), or [npm](#npm-package) |

## The install script

On Windows, in Windows PowerShell or PowerShell 7, as your normal user:

```powershell
irm https://github.com/adrifer/winix/releases/latest/download/install.ps1 -OutFile $env:TEMP\install.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\install.ps1
```

On Linux (NixOS, NixOS-WSL, or another distribution with glibc):

```bash
curl -fsSLO https://github.com/adrifer/winix/releases/latest/download/install.sh
bash install.sh
```

It lists what it will do and asks once:

1. **On Windows**, installs what Windows hosts need, if missing: Git,
   PowerShell 7 and DSC, through WinGet (on a fresh account it registers App
   Installer first). Installers may ask for administrator approval.
2. **Downloads the latest Winix**, checked against the release's checksums, into
   `%LOCALAPPDATA%\Winix` (Windows) or `~/.local/share/winix` (Linux). On NixOS
   it also sets up a pinned dynamic loader, which NixOS doesn't have by default.
3. **Puts a `winix` command on your PATH**: `%LOCALAPPDATA%\Winix\bin` (added to
   your user PATH) or `~/.local/bin/winix`.

Then open a new terminal, make a folder for your config and continue with
[Your first config](first-config.md):

```bash
winix init
```

`-Version 0.3.2` (`--version 0.3.2` on Linux) installs a specific release
instead of the latest. `-DryRun` (`--dry-run`) only shows what it would do. To
check the script before running it, compare it with the `install.ps1.sha256`
or `install.sh.sha256` file in the same release.

## The executable by hand

Every [GitHub release](https://github.com/adrifer/winix/releases) has
`winix-windows-x64.exe`, `winix-windows-arm64.exe`, `winix-linux-x64`,
`winix-linux-arm64` and a `SHA256SUMS` file to check them against. Download the
one for your machine, check it, and let it install itself:

```powershell
$release = "https://github.com/adrifer/winix/releases/latest/download"
Invoke-WebRequest "$release/winix-windows-x64.exe" -OutFile winix.exe
Invoke-WebRequest "$release/SHA256SUMS" -OutFile SHA256SUMS
$expected = ((Select-String -Path SHA256SUMS -Pattern 'winix-windows-x64.exe').Line -split '\s+')[0]
if ((Get-FileHash winix.exe -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch" }
.\winix.exe install command
```

`winix install command` copies the executable to `%LOCALAPPDATA%\Winix` (or
`~/.local/share/winix`) and puts the `winix` command on your PATH, exactly as
the script does. Skip it to run the file directly instead. Windows hosts still
need PowerShell 7.4+ and DSC 3.2+; the script is the easy way to get those.

## Things to know

- **Checksums detect corruption, not the publisher.** The Windows executables
  are not code-signed yet. Follow your organization's policies for running
  downloaded programs, and never turn off TLS verification to get past a proxy.
- **The Linux executable needs glibc and libstdc++.** NixOS has no standard
  dynamic linker, so the plain download doesn't start there: use the script,
  which runs it through a pinned loader.
- **ARM64** builds are cross-compiled and less tested than x64.
- The release's `LICENSE`, `NOTICE.txt` and `BUN-LICENSE.md` cover the
  executables, which embed the Bun runtime.
- **You won't need to update it by hand.** Inside a project, the `winix` command
  runs the version the project pins, downloading it when needed
  ([The winix command](../concepts/the-winix-command.md)).

## npm package

For macOS, until it has a standalone executable. With Node.js 22.13 or later
(22.x, 24.x or 26.x):

```bash
mkdir my-config && cd my-config
npx @adrifer/winix@latest init
npm install
npx winix check
```

Run Winix as `npx winix`. `init` adds `@adrifer/winix` to `package.json`, pinned
to an exact version; after `winix upgrade` moves that pin, run `npm install`
again. Node 26 only runs TypeScript that
can be erased (no `enum`, no constructor parameter properties); use Node 24 if
your config needs those.

## Editor support

Completion and type checking work without npm. Every command that reads your
config writes the type declarations of the Winix that runs it to `.winix/types`
(git-ignored), including the bundled NixOS, Home Manager and nix-darwin option
types, so `nixos.program("nix-ld", { ... })` completes and is checked.

`winix init` writes a `tsconfig.json` that uses them. For a config that
predates it, `winix types` writes the declarations and prints what
`tsconfig.json` needs:

```jsonc
{
  "compilerOptions": {
    "typeRoots": ["./.winix/types/@types"],
    "types": ["node"],
    "paths": {
      "@adrifer/winix": ["./.winix/types/node_modules/@adrifer/winix/index.d.ts"],
      "@adrifer/winix/types": ["./.winix/types/node_modules/@adrifer/winix/dist/types/index.d.ts"],
      "@adrifer/winix/types/bundled": ["./.winix/types/node_modules/@adrifer/winix/types/index.d.ts"]
    }
  },
  "exclude": ["node_modules", ".winix"]
}
```

Your editor's built-in TypeScript does the rest; VS Code needs nothing else.

## Coding agents

`winix --skill` prints instructions for coding agents that match the Winix you
run: how a config is organised, the helpers, and the commands to verify a
change. `winix init` also writes `.agents/skills/winix/SKILL.md`, a small skill
that tells agents to read it; add it to an existing config with
`winix install skill`.

## Next

[Your first config](first-config.md): from an empty folder to your first
`winix switch`.
