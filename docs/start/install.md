---
title: Install
description: The standalone winix executable for Windows and Linux, or the npm package, plus editor and agent support.
sidebar:
  order: 2
---

# Install

There are two ways to run Winix. Both run the same code; pick one.

- **The standalone executable** (Windows and Linux): one file, no Node.js or
  npm.
- **The npm package** (any platform with Node.js, and the only option on macOS
  for now).

Setting up a machine from a repository you already have? Skip this page:
[Set up a new machine](new-machine.md) downloads the right Winix for you.

## What each platform needs

| Platform | Needs |
|---|---|
| Windows | WinGet (App Installer), PowerShell 7.4+, DSC 3.2+, and Git for repositories. `bootstrap-windows.ps1 -Standalone` installs the missing ones ([details](new-machine.md#only-the-prerequisites)). |
| NixOS, NixOS-WSL | Nix with flakes, which NixOS has. |
| macOS | Nix and nix-darwin, plus Node.js for the npm package. |

## Standalone executable

Every [GitHub release](https://github.com/adrifer/winix/releases) has
`winix-windows-x64.exe`, `winix-windows-arm64.exe`, `winix-linux-x64`,
`winix-linux-arm64` and a `SHA256SUMS` file to check them against.

On Windows, in PowerShell:

```powershell
$dir = "$env:LOCALAPPDATA\Programs\winix"
New-Item -ItemType Directory -Force $dir | Out-Null
$release = "https://github.com/adrifer/winix/releases/latest/download"
Invoke-WebRequest "$release/winix-windows-x64.exe" -OutFile "$dir\winix.exe"
Invoke-WebRequest "$release/SHA256SUMS" -OutFile "$dir\SHA256SUMS"

$expected = ((Select-String -Path "$dir\SHA256SUMS" -Pattern 'winix-windows-x64.exe').Line -split '\s+')[0]
if ((Get-FileHash "$dir\winix.exe" -Algorithm SHA256).Hash -ne $expected) { throw "Checksum mismatch" }
& "$dir\winix.exe" --version
```

Then add that folder to your user `PATH` (Settings → System → About → Advanced
system settings → Environment Variables), or run Winix by its full path.

On Linux:

```bash
mkdir -p ~/.local/bin && cd ~/.local/bin
curl -fLO https://github.com/adrifer/winix/releases/latest/download/winix-linux-x64
curl -fLO https://github.com/adrifer/winix/releases/latest/download/SHA256SUMS
sha256sum --check --ignore-missing SHA256SUMS
mv winix-linux-x64 winix && chmod +x winix && rm SHA256SUMS
```

Things to know:

- **Checksums detect corruption, not the publisher.** The Windows executables
  are not code-signed yet. Follow your organization's policies for running
  downloaded programs, and never turn off TLS verification to get past a proxy.
- **The Linux executable needs glibc and libstdc++.** NixOS has no standard
  dynamic linker, so the plain download doesn't run there. On NixOS, use
  [`bootstrap-linux.sh`](new-machine.md), which sets up a pinned loader, or the
  npm package.
- **ARM64** builds are cross-compiled and less tested than x64.
- The release's `LICENSE`, `NOTICE.txt` and `BUN-LICENSE.md` cover the
  executables, which embed the Bun runtime.
- Once you have a repository, you don't need to update this copy yourself:
  the repository pins a Winix version, and the `winix` command that
  [bootstrap](new-machine.md) installs always runs that one
  ([The winix command](../concepts/the-winix-command.md)).

## npm package

With Node.js 22.13 or later (22.x, 24.x or 26.x):

```bash
mkdir my-config && cd my-config
npx @adrifer/winix@latest init
npm install
npx winix check
```

`init` adds `@adrifer/winix` to `package.json`, pinned to an exact version, so
`npm install` gives everyone the same Winix. Node 26 only runs TypeScript that
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
