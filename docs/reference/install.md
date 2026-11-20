---
title: Install and first run
description: Standalone executables, npm, and bootstrapping a machine from a dotfiles repository.
---

# Install and first run

## Standalone executable (no Node.js or npm)

[GitHub releases](https://github.com/adrifer/winix/releases) include
`winix-windows-x64.exe`, `winix-windows-arm64.exe`, `winix-linux-x64`,
`winix-linux-arm64`, and `SHA256SUMS`. Choose a versioned release and the native
architecture, compare its SHA256 with `SHA256SUMS`, and keep the executable
outside tracked files (repository bootstrap uses the ignored `.winix` directory).
Windows binaries are not yet code-signed:
checksums detect corruption, not publisher identity. Respect organizational
execution/network policies; do not disable TLS verification.
Redistribution notices and runtime source/rebuild references accompany the
assets as `LICENSE`, `NOTICE.txt`, and `BUN-LICENSE.md`.

On Windows, rename the verified executable to `winix.exe` and either add its
directory to PATH or invoke it by full path:

```powershell
& "$HOME\winix-bootstrap\winix.exe" --version
cd "$HOME\dotfiles\winix"
& "$HOME\winix-bootstrap\winix.exe" check
& "$HOME\winix-bootstrap\winix.exe" switch --host windows-devbox --dry
```

No `npm ci` is needed for normal configs. The executable contains its runtime
and SDK, supports local TypeScript/JavaScript imports and Node builtins, and
shares SDK evaluation context across all config files. Its version, not an
installed npm SDK or the config's package lock, determines the SDK used.
`winix init` works without npm too, and so does editing: every config command
writes the running Winix's type declarations to `.winix/types` (see
[Editor types](authoring.md#editor-types)). Type-only `@adrifer/winix/types` imports work;
runtime SDK imports must use `@adrifer/winix`. Other npm dependencies must
already be installed: Winix never downloads them automatically.

Native prerequisites remain Git, PowerShell 7, WinGet, DSC and the required DSC
resources on Windows, or Nix/activation tools for Linux targets. Use
`bootstrap-windows.ps1 -Standalone -Check` to inspect native prerequisites or
`-Standalone` to install missing ones; this mode never installs/checks Node/npm.
Standalone Windows WSL setup downloads the matching release's Linux executable,
verifies a checksum embedded in the Windows binary, and prepares its NixOS
runtime linker with pinned Nix dependencies. Account/config generation remains
unprivileged and does not run npm. Keep `flake.lock` committed; package manifests
are required only by the npm-based setup path. These downloads still need
approved access to GitHub and Nix caches.

Linux release binaries target glibc systems (with libstdc++); use `chmod +x`
before running. NixOS does not provide an FHS runtime linker by default:
automatic WSL setup handles this explicitly, while direct manual use needs a
compatible linker/library environment. Windows binaries used for WSL setup
must come from a complete official release; developer single-target builds
lack the Linux checksums. ARM64 assets are cross-compiled; fresh-machine
activation and ARM64 execution are not yet verified.

## Bootstrap an existing repository

Repository-specific entry scripts can download/verify Winix bootstrap installers and supply
repository, ref, destination, config-directory and host defaults. Git installation,
cloning and existing-checkout validation remain owned by Winix. Private HTTPS
repositories use Git's configured authentication/credential helper; never embed
credentials in scripts or repository URLs.

The Winix-owned `bootstrap-windows.ps1` and `bootstrap-linux.sh` release assets
prepare a trusted config repository without Node/npm. Download the script and
its `.sha256` from a **versioned release supporting repository bootstrap**,
verify the checksum, and review the script before running it. Do not pipe
unreviewed internet code into a shell. Checksums share the release's trust
boundary; they are not signatures.

```powershell
.\bootstrap-windows.ps1 -Repository https://github.com/example/dotfiles.git `
  -Ref main -Destination "$HOME\dotfiles" -ConfigDirectory winix
```

It asks **one** question, listing everything it will do (clone, prerequisites,
the pinned Winix download, running the config, applying the host); after that
only UAC prompts (sudo on Linux) and removal confirmations interrupt.
`bootstrap-linux.sh` behaves the same way. Without `-HostName`/`--host`, Winix
lists the declared hosts for this kind of machine (or picks the only one, or the
one matching the computer name) and remembers the choice in the checkout's
ignored `.winix\host`, so later `winix switch` runs need no `--host`, even on a
PC named `DESKTOP-XXXXXXX`. Rerunning the same command (for example after a
restart for WSL) reuses the checkout, the host and the downloads.

A dotfiles repository can ship a tiny entry script that reads its own
`winix/package.json` pin from GitHub, downloads that release's
`bootstrap-windows.ps1`, checks it against the release's `.sha256`, and runs it
with the repository defaults: then a fresh PC needs only

```powershell
irm https://raw.githubusercontent.com/<you>/dotfiles/main/setup/windows.ps1 -OutFile $env:TEMP\setup.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\setup.ps1
```

```bash
bash bootstrap-linux.sh --repository https://github.com/example/dotfiles.git \
  --ref main --destination "$HOME/dotfiles" --config-directory winix
```

Windows needs App Installer/WinGet initially. It ensures Git, makes a regular
clone, reads `config-directory/package.json` **without importing the config**,
then verifies and installs that exact release's native executable and
prerequisite-only script. Native PowerShell/DSC prerequisites are installed
without Node or PSGallery registration: feeds belong to the selected host.
Linux uses existing Nix to obtain temporary Git/Python tools, or requires
Git and Python 3 installed through your approved package manager. It does not
install Nix or turn another distribution into NixOS. Generic glibc Linux needs
libstdc++; NixOS gets a private, GC-rooted pinned libc/compiler launcher.
Real activation still requires the target's existing Nix/activation tools.

Pin `@adrifer/winix` in dependencies/devDependencies to an exact release version
or its matching official GitHub release SDK tarball URL. Floating ranges,
local SDK links, third-party URLs, and mismatched asset versions are refused.
`winix init` now generates an exact pin. No independent runtime version is
stored in dotfiles, and no global Winix/npm installation is performed.

`-DryRun` / `--dry-run` makes **no changes**, including no clone, tool downloads,
prerequisite installation, or config evaluation. `-PrepareOnly` / `--prepare-only`
allows those preparation steps, then runs `check` and `switch --dry` but stops
before activation. Config evaluation can itself run arbitrary code, so the one
confirmation comes **before** anything is evaluated. `-Yes` / `--yes` accepts
it noninteractively (then pass `-HostName`/`--host`), and also managed removals.
Running `winix bootstrap` directly (not through the script) keeps its separate
questions before evaluation and before activation.
Host selection does not rename the machine. Reboot/WSL shutdown are manual.

Existing checkouts must have the expected origin and local ref/HEAD. Local
changes (linked app settings rewrite files in the checkout) only produce a
warning: bootstrap never pulls, resets, stashes, cleans, changes branches in an
existing checkout, or overwrites an unrelated directory; links/path escapes
are rejected. Rerun after resolving a reported prerequisite/reboot boundary.
Updating an existing checkout is an explicit Git operation, not a bootstrap side effect.

For ongoing use, bootstrap writes `.winix/bin/winix.ps1` (Windows) or
`.winix/bin/winix` (Linux). These call `winix run <args>` from the config
directory. Bootstrap also installs a per-user `winix` command that runs this
launcher from any folder:

- Windows: `%LOCALAPPDATA%\Winix\bin\winix.cmd`, added to the user PATH without
  elevation (keeping `%VAR%` entries intact).
- Linux: `~/.local/bin/winix`. PATH is left to your shell or Home Manager
  config (for example `home.path(nix.homePath(".local/bin"))`); bootstrap
  prints a hint when it is missing.

Inside a NixOS-WSL distro created by Windows WSL setup, setup installs the same
command for the Linux user. For an existing distro, run `bootstrap-linux.sh`
there, or `winix bootstrap --command-only --host <linux-host>` from its config
directory with a standalone Winix: that only remembers the host and installs
the command, without evaluating anything.

```bash
winix switch          # the remembered host, on Windows or Linux
winix plan
```

The launcher rereads the manifest on every invocation and always runs the Winix
release it pins. When the pin
changes, `winix run` downloads that exact release's executable into
`.winix/runtime/<version>`, checked against its `SHA256SUMS` before it runs. On
Linux it sits behind a wrapper that must report that version (using the pinned
Nix loader on NixOS). The launcher uses it from then on, and older downloaded
versions are removed, keeping the one the launcher falls back to. On Windows,
Linux and WSL an update is therefore just `git pull` and `winix switch`. macOS
has no standalone executable yet; use the npm route there.

An installed `node_modules/@adrifer/winix` never changes what `winix run` (the
`winix` command) executes; `npm run` scripts and `npm exec -- winix` keep using
that local CLI as usual. To run another Winix through the `winix` command on
purpose, such as a source checkout while developing Winix, set `WINIX_SDK` to
its package directory (absolute, or relative to the config directory):

```powershell
$env:WINIX_SDK = 'D:\winix'; winix plan   # src/cli/index.ts, else dist/cli/index.js
```

It prints which Winix it runs and the version the checkout pins, and needs
Node 22.13+, 24 or 26.

Fresh Windows-driven WSL setups using a branch now fetch full history and
create a local tracking branch **at the locked first-run commit**, even if
upstream has advanced. `HEAD` resolves the default branch; commit/tag refs stay
detached intentionally. Completed setups and their existing detached checkouts
are not migrated or updated automatically.

## npm installation (optional)

```bash
mkdir my-winix-config
cd my-winix-config
npx @adrifer/winix@latest init
npm install
```

The npm CLI supports stable Node.js 22.13+ (22.x), 24.x and 26.x.
Its launcher enables `--experimental-transform-types` on Node 22/24 and omits
the removed flag on Node 26. Node 26 only supports erasable TypeScript: use Node
24 if your config or local imports contain enums, parameter properties or other
syntax requiring transformation. Odd-numbered and untested future majors are
rejected explicitly.
The standalone executable has no installed Node version requirement.

If you prefer to set up files yourself instead of using `init`, add the package to your own `package.json`:

```bash
npm install @adrifer/winix
```

The `init` command creates a starter `winix.config.ts`, `tsconfig.json`, `.gitignore`, and package scripts. After `npm install`, the `winix` binary comes from your local `node_modules`, so commands are reproducible through `package-lock.json`.

It also installs `.agents/skills/winix/SKILL.md`, a small agent skill wrapper.
The wrapper tells agents to run `winix --skill`, so the full instructions always
come from the same installed package version as the executable. Existing
projects can install it with:

```bash
winix install skill
```

You can also install it globally, but local project installs are recommended:

```bash
npm install -g @adrifer/winix
```

## Bootstrap prerequisites on NixOS

On an existing NixOS installation (including NixOS-WSL), a reviewed copy of
`scripts/bootstrap-nixos.sh` opens a temporary prerequisite environment:

```bash
bash bootstrap-nixos.sh
# Inside the shell, clone your config, install its dependencies, and run Winix yourself.
# Type exit when finished.
```

Git, Node.js 24/npm, and interactive Bash come from one nixpkgs commit pinned
in the script, without relying on your channels or flake registry. The script
enables `nix-command`/flakes for the child session only and disables Bash startup
files so user profiles cannot replace the bootstrap PATH. The working directory
is preserved. Network/store access is required on a cold machine; normal Nix
permissions, cache verification, and trust settings still apply.

Nothing is installed into a user profile or system configuration, though Nix
may download packages into its store. The script does not install NixOS, clone
a repo, install Winix/npm dependencies, select a host, or rebuild anything.
Declare tools and Nix settings in your own config for permanent availability.
Maintainers update the pinned nixpkgs commit deliberately alongside the script.

Future stable and preview [GitHub releases](https://github.com/adrifer/winix/releases)
include `bootstrap-nixos.sh` and `bootstrap-nixos.sh.sha256`. Download both,
check with `sha256sum --check bootstrap-nixos.sh.sha256`, review the script, then
run it; do not pipe an unreviewed download into a shell. Checksums detect
corruption but do not independently establish publisher identity.

## Bootstrap a Windows machine

`scripts/bootstrap-windows.ps1` runs with built-in Windows PowerShell 5.1 or
PowerShell 7, without needing Node, Git, or Winix first. Save a reviewed copy
from your chosen Winix checkout/revision (or carry it on your restore drive).
Starting with the next release containing this change, stable and preview
[GitHub releases](https://github.com/adrifer/winix/releases) include
`bootstrap-windows.ps1` and `bootstrap-windows.ps1.sha256` as downloadable assets,
so no checkout, Git, or npm is needed to obtain the script. Use
`Get-FileHash .\bootstrap-windows.ps1 -Algorithm SHA256` to compare its hash with
the downloaded checksum file. The checksum detects corruption, not publisher
identity; the script is not yet code-signed.
Do not pipe an unreviewed download into a shell.

App Installer/WinGet must already be available for the current Windows account.
If missing, the script stops with the official Store link and first-sign-in
registration instructions; it does not download unsigned installers or bypass
Store policy. Run from a normal Windows account, not WSL or another admin account:

```powershell
# Read-only: reports missing/old prerequisites and exits unsuccessfully if not ready.
powershell.exe -NoProfile -File .\scripts\bootstrap-windows.ps1 -Check
# Executable workflow: omit all Node/npm checks and installations.
powershell.exe -NoProfile -File .\scripts\bootstrap-windows.ps1 -Standalone -Check
powershell.exe -NoProfile -File .\scripts\bootstrap-windows.ps1 -Standalone
# Review and confirm installation/upgrade of missing or outdated prerequisites.
powershell.exe -NoProfile -File .\scripts\bootstrap-windows.ps1
# Choose NVM for Windows rather than standalone Node on NVM-based setups.
powershell.exe -NoProfile -File .\scripts\bootstrap-windows.ps1 -UseNvm
```

Run scripts only through an execution route permitted by your signing and
organizational policies; the bootstrap does not override them. `-Yes` accepts bootstrap
installation for automation. Installers may request UAC elevation. The script
checks Git, supported stable Node (22.13+/24/26), npm, PowerShell (7.4+), PSResourceGet/PSGallery, DSC
(3.2+), and the backend's required DSC resources. Supported existing versions
are kept; standalone installs use `Git.Git`, `OpenJS.NodeJS.LTS`,
`Microsoft.PowerShell`, and `Microsoft.DSC` from the exact WinGet source/IDs.
`-UseNvm` installs `CoreyButler.NVMforWindows` if needed and selects Node LTS
through NVM instead. It refuses to introduce standalone Node alongside an
existing NVM installation when Node needs setup. Installation needs Store
access; `-Check` installs nothing.

Only the process PATH/NVM environment is refreshed; no persistent policy or
environment values are written by the script itself. Installers can change
their normal installation settings. Errors stop the bootstrap; restart requests
are reported, never performed automatically. Reopen PowerShell 7 afterward.
Bootstrap installations are prerequisites, not Winix-owned host resources, and
are not pinned by a host's Windows lockfile.

This is the reusable prerequisite layer, not a dotfiles installer. Preparing a
config checkout, restoring its npm dependencies, selecting a compatible Winix
version/local SDK, reviewing `check`/`switch --dry`, and confirming `switch` are
separate steps. It never clones repositories, installs Winix globally, activates
a host, changes execution policy persistently, or provisions WSL. Repository
setup, npm installation, and all Winix commands remain the user's responsibility.

All generated file, PATH, and module scripts use PowerShell 7; string-form
`windows.raw("...")` commands also default to `pwsh`, without loading a profile
or prompting interactively. Explicit executable choices
remain unchanged. Winix no longer requires Windows PowerShell 5.1 for these
flows, but it does not remove it from Windows.

Install PowerShell 7 and make `pwsh` available on PATH **before** DSC discovers
the configuration's resources; a `dependsOn` package alone does not bootstrap
resource discovery. Script `setScript` operations independently check current
state because the transitional resource can invoke set without first running
`testScript`. Native Registry resources still manage persistent environment
variables, with machine-scope writes requiring elevation as before.
Generated script literals escape Unicode to survive DSC's script transport
without corrupting file contents or paths.
