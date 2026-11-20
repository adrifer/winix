# Winix

[![npm](https://img.shields.io/npm/v/%40adrifer%2Fwinix?label=npm&logo=npm)](https://www.npmjs.com/package/@adrifer/winix)
[![npm preview](https://img.shields.io/npm/v/%40adrifer%2Fwinix/preview?label=preview&logo=npm&color=orange)](https://www.npmjs.com/package/@adrifer/winix?activeTab=versions)
[![CI](https://github.com/adrifer/winix/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/adrifer/winix/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![TypeScript](https://img.shields.io/badge/types-TypeScript-blue?logo=typescript&logoColor=white)](./types)

**TypeScript-first system configuration for NixOS, nix-darwin, and Home Manager.**

Winix lets you write system configuration as typed, composable TypeScript fragments and generates a normal Nix flake that `nixos-rebuild`, `darwin-rebuild`, and Home Manager can consume.

```ts
// winix.config.ts
import {
  account,
  defineInputs,
  feature,
  home,
  host,
  input,
  platforms,
  workspace,
} from "@adrifer/winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

const wsl = feature("wsl", ({ nixos }) => {
  nixos.imports("inputs.nixos-wsl.nixosModules.wsl");
  nixos({ wsl: { enable: true } });
  nixos.program("nix-ld");
});

const shell = feature("shell", ({ home, platforms }) =>
  home.program("zsh", {
    shellAliases: {
      g: "lazygit",
      ...(platforms.nixos.isActive && {
        i: "cd ~/dotfiles/winix && npx @adrifer/winix switch",
      }),
      ...(platforms.darwin.isActive && {
        i: "cd ~/dotfiles/winix && npx @adrifer/winix switch --host macbook",
      }),
    },
  })
);

export default workspace({
  inputs,
  hosts: [
    host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
      account.user("adrifer", () => ({
        admin: true,
        shell: "zsh",
        stateVersion: "25.05",
        wslDefault: true,
      }))(),
      wsl(),
      shell(),
      home.packages("neovim", "ripgrep", "fd"),
    ]),
  ],
});
```

Feature and host callbacks receive an injected context
(`{ home, nixos, darwin, windows, platforms }`); declarations made through it
register automatically, so no `return` is needed. The older style still works:
import the helpers as globals and `return` the fragments you build.

## Why Winix?

- **Use TypeScript as the authoring language.** Compose functions, arrays, objects, conditionals, and package-specific helpers without inventing another DSL.
- **Keep Nix as the output.** Winix writes `.winix/out/flake.nix` and host modules; the final build still runs through Nix.
- **One model for NixOS, nix-darwin, and Home Manager.** Share features across Linux, macOS, WSL, servers, and profiles.
- **Typed helpers for common config.** Use `nixos.networking()`, `home.program()`, `darwin.homebrew()`, `account.user()`, and more.
- **Escape hatches when needed.** Drop to `nix.expr()`, `nixos.raw()`, or `rawModule()` without leaving the system.

> Winix is early software. The core pipeline works end-to-end, but the public API is still evolving.

### Why the name?

It started as a half-joke about wrapping Nix for **Win**dows (early prototypes targeted WSL first). The name stuck because **Win + Nix** also reads as "winning at Nix", which felt apt for a project that's trying to make the Nix ecosystem a bit less painful to onboard into.

For what it's worth: Winix today works just as well on macOS and native NixOS as it does on WSL. The Windows-flavored origin survives in the name only.

## Install and create a config

### Standalone executable (no Node.js or npm)

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
`winix init` works without npm too; its package/TypeScript files are optional
editor/development tooling. Type-only `@adrifer/winix/types` imports work;
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

### Bootstrap an existing repository

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
  -Ref main -Destination "$HOME\dotfiles" -ConfigDirectory winix `
  -HostName windows-devbox -PrepareOnly
```

```bash
bash bootstrap-linux.sh --repository https://github.com/example/dotfiles.git \
  --ref main --destination "$HOME/dotfiles" --config-directory winix \
  --host linux-desktop --prepare-only
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
before activation. Config evaluation can itself run arbitrary code, so it
requires consent **before** `check`. Omit prepare-only to review the preview
and confirm activation separately. `-Yes` / `--yes` explicitly accepts trust,
prerequisite changes, activation (unless prepare-only), and managed removals.
Host selection does not rename the machine. Reboot/WSL shutdown are manual.

Existing checkouts must have the expected origin, local ref/HEAD and clean
working tree. Bootstrap never pulls, resets, stashes, changes branches in an
existing checkout, or overwrites an unrelated directory; links/path escapes
are rejected. Rerun after resolving a reported prerequisite/reboot boundary.
Updating an existing checkout is an explicit Git operation, not a bootstrap side effect.

For ongoing use, bootstrap writes `.winix/bin/winix.ps1` (Windows) or
`.winix/bin/winix` (Linux). These call `winix run <args>` from the config directory:

```powershell
.\.winix\bin\winix.ps1 check
.\.winix\bin\winix.ps1 switch --host windows-devbox
```

```bash
./.winix/bin/winix check
./.winix/bin/winix switch --host linux-desktop
```

The launcher rereads the manifest on every invocation. If an optional
`node_modules/@adrifer/winix` is installed, its version must match the pin and
the launcher uses its own CLI/SDK under supported Node 22.13+, 24 or 26. Install dependencies
explicitly with `npm ci` using an approved npm source; bootstrap never does it.
Existing `npm run` scripts also use that local CLI, without a global installation.
Without the npm SDK, the verified standalone executable must match the pin;
after changing the pin, rerun bootstrap to download the matching executable.
A stale/corrupt local installation is an error, never a silent standalone fallback.

Fresh Windows-driven WSL setups using a branch now fetch full history and
create a local tracking branch **at the locked first-run commit**, even if
upstream has advanced. `HEAD` resolves the default branch; commit/tag refs stay
detached intentionally. Completed setups and their existing detached checkouts
are not migrated or updated automatically.

### npm installation (optional)

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

### Bootstrap prerequisites on NixOS

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

## CLI

From a Winix project:

```bash
npx @adrifer/winix check                  # validate winix.config.ts
npx @adrifer/winix apply                  # generate .winix/out/
npx @adrifer/winix apply --dry            # print generated Nix without writing files
npx @adrifer/winix apply --diff           # unified diff against the current .winix/out/
npx @adrifer/winix plan --host my-pc      # what switch would change on this Windows machine
npx @adrifer/winix switch --host my-host  # generate and run nixos-rebuild/darwin-rebuild
npx @adrifer/winix update                 # update generated flake.lock and copy it back
npx @adrifer/winix inspect --host my-pc   # each feature and what it declares
npx @adrifer/winix scaffold feature lazygit  # features/lazygit.ts, home.* and windows.* side by side
npx @adrifer/winix --skill                # print version-matched agent instructions
```

If you add scripts to your `package.json`, you can use shorter commands:

```json
{
  "scripts": {
    "check": "winix check",
    "apply": "winix apply",
    "dry": "winix apply --dry",
    "switch": "winix switch"
  }
}
```

Generated output lives under:

```text
.winix/out/
  flake.nix
  hosts/
    <host>.nix
```

You can also run the generated flake manually:

```bash
sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#my-host
sudo darwin-rebuild switch --flake path:$(pwd)/.winix/out#macbook
```

## Guides

Task-focused recipes, built on the runnable
[`examples/cross-platform`](examples/cross-platform) workspace. This README stays
the reference for every option.

- [Write a cross-platform feature](docs/guides/cross-platform-feature.md): one
  feature per tool, with `home.*` and `windows.*` side by side.
- [Pair a Windows host with its WSL host](docs/guides/pair-windows-and-wsl.md):
  Windows creates a NixOS-WSL distro and sets it up from the same checkout.
- [Share git config across Windows and WSL](docs/guides/share-git-config.md):
  one settings object for Home Manager and Git for Windows.
- [PowerShell profile and Windows Terminal](docs/guides/powershell-and-terminal.md):
  profile, prompt and Terminal settings kept in the repo.

## Core concepts

### Workspaces and hosts

A workspace declares inputs and hosts. Each host has exactly one platform and a list of fragments.

```ts
export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
    homeManager: input("github:nix-community/home-manager", {
      follows: { nixpkgs: "nixpkgs" },
    }),
  },
  hosts: [
    host("server", platforms.nixos({ stateVersion: "25.05" }), [
      serverProfile(),
    ]),
    host("macbook", platforms.darwin({ stateVersion: 6, homebrew: true }), [
      macProfile(),
    ]),
  ],
});
```

### Features and profiles

Features **declare** config and are the flexible building block. Profiles
**group** features and take an array of entries only (no callback).

```ts
const git = feature("git", ({ home }) => {
  home.program("git", {
    userName: "Adrian Fernandez",
    userEmail: "me@example.com",
  });
});

const developer = profile("developer", [
  git(),
  home.packages("neovim", "lazygit", "ripgrep"),
]);
```

A feature can also return one fragment or an array of fragments (the older
style still works):

```ts
const neovim = feature("neovim", () => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);
```

When a feature body composes other features, return them: a `feature()`/
`profile()` call yields a lazy fragment that is not auto-collected.

One feature can declare for every platform; each namespace only applies where
it makes sense. See [Write a cross-platform feature](docs/guides/cross-platform-feature.md),
or start one with `winix scaffold feature <name>`.

### Platform-aware configuration

Fragments can ask whether another platform or feature is active.

```ts
const shell = feature("shell", ({ home, platforms }) =>
  home.program("zsh", {
    shellAliases: {
      ...(platforms.nixos.isActive && { rebuild: "sudo nixos-rebuild switch" }),
      ...(platforms.darwin.isActive && { rebuild: "sudo darwin-rebuild switch" }),
    },
  })
);
```

`platforms.wsl({ stateVersion, ... })` is NixOS running under WSL. It takes the
same options as `platforms.nixos()`, imports the NixOS-WSL module and sets
`wsl.enable`, so a WSL host needs no module boilerplate. Declare the input
(`nixosWsl: input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } })`);
`winix check` warns when an imported module's input is missing. Pass
`input: "<name>"` if your NixOS-WSL input has another Nix name. A WSL host is
still NixOS, so `platforms.nixos.isActive` stays true there and
`platforms.wsl.isActive` tells WSL hosts apart.

### Account helpers

`account.user()` wires together platform users and Home Manager users.
On NixOS-WSL, `wslDefault: true` sets `wsl.defaultUser` as a Nix default,
unless the host already declares a default user. It detects WSL from
`wsl.enable` or the NixOS-WSL module import, not a feature or profile name.

```ts
const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

host("wsl", platforms.wsl({ stateVersion: "25.05" }), [
  adrifer(),
]);
```

### Curated helpers

Winix includes helpers for common Nix namespaces:

```ts
nixos.imports("inputs.nixos-wsl.nixosModules.wsl")
nixos.networking({ hostName: "server", firewall: { allowedTCPPorts: [22, 443] } })
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })
nixos.systemd.service("backup", { script: "echo backup" })
nixos.systemd.tmpfiles.link("/usr/bin/bash", "/run/current-system/sw/bin/bash")
nixos.users({ users: { root: { shell: nix.pkg("bash") } } })
nixos.system({ stateVersion: "25.05" })

home.program("zsh", { enableCompletion: true })
home.configFiles({ nvim: home.symlink("../nvim/.config/nvim") })
home.activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })

darwin.defaults({ dock: { autohide: true } })
darwin.homebrew({ enable: true, casks: ["visual-studio-code"] })
darwin.launchd.agent("emacs", {
  serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] },
})
```

Plain object fragments are still supported for options that do not have helpers yet.

### Nix escape hatches

Use `nix.*` when a value needs to be a Nix expression:

```ts
nix.pkg("zsh")
nix.bin("git", "git")
nix.homePath(".config/nvim/init.lua")
nix.pkgPath("git", "share/git-core/templates")
nix.str`${nix.pkg("neovim")}/bin/nvim`
nix.script`
  echo "hello from activation"
`
nix.lib.mkForce(["https://cache.nixos.org/"])
```

`nix.homePath(relativePath)` builds a path below
`config.home.homeDirectory`, while `nix.pkgPath(packageName, relativePath)`
builds one below `pkgs.<packageName>`. Both return a typed `NixExpr`, safely
quote string content, ignore leading `/` characters in the relative path,
preserve all other characters, and omit the trailing slash for an empty path.
Use POSIX `/` separators; backslashes are preserved as literal characters.

For prebuilt single-binary CLI releases (the `azd`, `gh`, `kubectl`,
`1password` family), use `nix.binaryRelease()` instead of hand-rolling
the `stdenvNoCC.mkDerivation` boilerplate:

```ts
home.packages(
  nix.binaryRelease({
    name: "azure-dev-cli",
    version: "1.25.5",
    binary: "azd",
    urlTemplate:
      "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
    platforms: {
      "x86_64-linux":  { file: "azd-linux-amd64.tar.gz",  hash: "sha256-..." },
      "aarch64-linux": { file: "azd-linux-arm64.tar.gz",  hash: "sha256-..." },
      "x86_64-darwin": { file: "azd-darwin-amd64.zip",    hash: "sha256-..." },
      "aarch64-darwin":{ file: "azd-darwin-arm64.zip",    hash: "sha256-..." },
    },
    meta: {
      description: "Azure Developer CLI",
      homepage: "https://github.com/Azure/azure-dev",
      license: "mit",
    },
  }),
);
```

Supports per-platform `{platform}` URL placeholders (for vendors whose
URLs aren't just `${file}`), shell completions via `installShellFiles`,
optional `autoPatchelfHook` on Linux, and a validated `meta.license`
(rejects SPDX-style ids like `MIT`/`Apache-2.0` at TS-eval time so misuse
surfaces immediately, not at Nix build time). Pass `nix.expr(...)` for
licenses that aren't a simple `pkgs.lib.licenses.<id>` lookup. See
[`spec/proposals/binary-release.md`](spec/proposals/binary-release.md)
for the full reference.

Release assets can also be raw executables. Set `format: "raw"` explicitly;
Winix never guesses that an extensionless file is executable. The format is
per-platform, so raw and archive assets can be mixed in one release:

```ts
home.packages(
  nix.binaryRelease({
    name: "herdr",
    version: "0.8.2",
    binary: "herdr",
    urlTemplate:
      "https://github.com/herdrdev/herdr/releases/download/v{version}/{file}",
    platforms: {
      "x86_64-linux": {
        file: "herdr-linux-x86_64",
        hash: "sha256-...",
        format: "raw",
      },
      "aarch64-linux": {
        file: "herdr-linux-aarch64",
        hash: "sha256-...",
        format: "raw",
      },
      "x86_64-darwin": {
        file: "herdr-macos-x86_64",
        hash: "sha256-...",
        format: "raw",
      },
      "aarch64-darwin": {
        file: "herdr-macos-aarch64",
        hash: "sha256-...",
        format: "raw",
      },
    },
    meta: {
      description: "The runtime your coding agents live on",
      homepage: "https://github.com/herdrdev/herdr",
      license: "asl20",
    },
  }),
);
```

When `format` is omitted, `.zip`, `.tar.gz`, and `.tgz` filenames retain the
legacy extension-based archive behavior. Other extensions are rejected unless
a supported format (`"raw"`, `"zip"`, `"tar.gz"`, or `"tgz"`) is explicit.

For bigger migrations, import existing Nix modules:

```ts
rawModule("./legacy/system.nix")
rawModule.homeManager("./legacy/home.nix")
rawModule.darwin("./legacy/darwin.nix")
```

### Windows (preview)

Winix has an early native Windows backend. Declare a `platforms.windows()` host
and install winget/msstore packages with `windows.package(...)`; use
`windows.raw(...)` for arbitrary commands. Both return a handle you can pass to
another resource's `dependsOn` to express ordering.

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  const node = windows.package("OpenJS.NodeJS");
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" });
  windows.raw({
    executable: "npm",
    arguments: ["install", "--global", "typescript"],
    dependsOn: node,
  });
});
```

`winix switch` checks each resource against the machine and applies only what
is out of date (see [Previewing and applying Windows changes](#previewing-and-applying-windows-changes)). Typed helpers
also cover environment variables, PATH, files, Windows settings, and PowerShell
modules:

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  windows.setting({ DeveloperMode: true });
  const icons = windows.powershell.module("Terminal-Icons");

  windows.file.symlink(
    windows.knownFolder.documents("PowerShell\\Microsoft.PowerShell_profile.ps1"),
    "../windows/powershell/Microsoft.PowerShell_profile.ps1",
    { dependsOn: icons },
  );
});
```

`windows.knownFolder.documents(childPath?)` resolves redirected Documents **during activation**,
not on the machine generating the configuration. Supported folders are
`documents`, `desktop`, `localAppData`, `appData`, `userProfile`,
`programFiles`, and `programFilesX86`. The optional
child path must stay within the folder. All `windows.file.*` targets accept it.
Copy/symlink source strings are relative to the directory containing
`winix.config.ts`, not the calling feature or working directory. Absolute paths,
`%VARIABLE%` paths, and `file:` URL objects remain supported. Symlinks stay live
and require the checkout to remain in place. Direct `generateWindows(hosts, lock, configDir)` callers must
supply `configDir` when using relative sources.

**Existing files are backed up by default.** When a file, `.wslconfig` or
Startup shortcut target already exists and differs, Winix moves it to
`<target>.bak` and puts its own in place. It fails if that `.bak` already
exists, so nothing is overwritten. Targets that already match are left alone, so
this only happens the first time Winix takes a file over (or after something
else replaced it). Per resource:

- `backup: false` refuses to replace an existing target and fails the switch instead.
- `force: true` deletes the existing target without a backup (populated
  directories are still refused). `force` with `backup: true` backs up.

Before this default, replacement needed an explicit `backup: true` or
`force: true`; configs that set `backup: true` everywhere can drop it.

Guides: [PowerShell profile and Windows Terminal](docs/guides/powershell-and-terminal.md),
[Share git config across Windows and WSL](docs/guides/share-git-config.md).

#### Writing Windows config

Shortcuts for things most Windows hosts repeat:

```ts
// Windows-only workspaces need no Nix inputs.
export default workspace({ hosts: [
  host("desktop", platforms.windows(), ({ windows }) => {
    // Apps that update themselves: install when missing, never pin or downgrade.
    windows.package("Valve.Steam", { version: "any" });

    // Named targets instead of typed-out paths.
    windows.powershell.profile("../windows/powershell/Microsoft.PowerShell_profile.ps1");
    windows.terminal.settings("../windows/terminal/settings.json", { channel: "preview" });
    windows.env.set("REPOS", windows.configPath("../.."));

    // A file handle used as a path supplies the path *and* the dependency.
    const komorebi = windows.package("LGUG2Z.komorebi");
    const config = windows.file.symlink(windows.knownFolder.userProfile("komorebi.json"), "../windows/komorebi.json");
    windows.startup.command("komorebi", {
      executable: windows.knownFolder.programFiles("komorebi/bin/komorebic-no-console.exe"),
      arguments: ["start", "--config", config],
      dependsOn: komorebi,
    });

    // Light/dark mode lives next to the rest of the appearance settings.
    windows.personalization({ colorMode: "Dark", accentColor: "#336699" });
  }),
] });
```

- `version: "any"` is for apps that update themselves (browsers, launchers,
  Teams) or that winget can't report a usable version for. See
  [Package versions](#package-versions) below.
- `windows.powershell.profile(source, { shell?, mode?, backup?, force? })` targets
  `Documents\PowerShell\Microsoft.PowerShell_profile.ps1` (`shell:
  "windowspowershell"` for 5.1), following OneDrive-redirected Documents.
  `windows.terminal.settings(source, { channel?: "stable" | "preview" })` targets the
  packaged Terminal's `LocalState\settings.json`. Both symlink by default; use
  `mode: "copy"` to copy instead.
- `windows.configPath(path?)` returns an absolute path relative to
  `winix.config.ts` at evaluation, for string values. File sources are already
  config-relative.
- In `windows.startup.command`, a `windows.file.*` handle can stand in for the
  executable, an argument, or the working directory. Winix uses its target and
  adds the dependency.
- `winix package search <query>` finds winget ids. `winix windows import
  [--host <name>]` compares `winget export` with the host's declarations and
  prints paste-ready `windows.package(...)` lines for installed, undeclared apps.
  Shared runtimes such as VC++ redistributables are listed on one line, and
  declared packages that aren't installed are listed too. It is read-only.
- `winix check` warns about every pin missing from `winix-windows.lock`: floating
  packages, PowerShell modules (including the implicit `Microsoft.Windows.Settings`
  that `windows.setting` uses), NixOS-WSL images, WSL setup commits and fonts.
  Apply would resolve them online, and a typo would only fail there.

#### Package versions

A package's `version` picks one of three policies:

```ts
windows.package({ id: "Git.Git", version: "2.44.0" }); // exact
windows.package("Git.Git");                             // locked (default)
windows.package("Valve.Steam", { version: "any" });     // any version
```

**Declaring and activating**

| | Exact: `version: "2.44.0"` | Locked (default) | Any: `version: "any"` |
|---|---|---|---|
| Use for | Tools that must be one specific version | Most tools | Apps that update themselves, or report no usable version (e.g. `Unknown`) |
| `winix-windows.lock` | Records the inline pin | First apply pins the latest winget version; `winix update --windows` refreshes it | No entry |
| Not installed | Installs that version | Installs the locked version | Installs whatever winget currently offers |
| Installed version is older | Switch fails ("Exact version mismatch") | Upgraded to the locked version | Left alone |
| Installed version is newer | Switch fails; never downgraded | Kept ("Keeping X (locked Y)"); switch offers to update the lock | Left alone; no prompt |
| winget reports `Unknown` | Switch fails | Kept (warning each switch); never reinstalled | Left alone; no warning |
| Changed outside Winix (Winix-installed) | Switch fails | Newer accepted; older fails | Any change accepted |
| `check` warns when not in the lock | No | Yes (apply would resolve it online) | No |

**Removing the declaration**

| | Exact | Locked (default) | Any |
|---|---|---|---|
| Installed by Winix, version unchanged | Uninstalled, after confirmation | Uninstalled, after confirmation | Uninstalled, after confirmation |
| Installed by Winix, version changed since | Refused ("externally modified") | Refused ("externally modified") | Uninstalled, after confirmation |
| Installed by Winix, winget reports `Unknown` | Refused; remove it by hand | Refused; remove it by hand | Refused; remove it by hand |
| Installed before Winix managed it | Never uninstalled | Never uninstalled | Never uninstalled |

Uninstalls also need two things: no other host or workspace on the machine
still declares the package, and `switch --dry` lists it first as a planned
removal. `--yes` skips the confirmation. To keep a Winix-installed package but
stop managing it, run `winix state forget package winget <id>` before removing
the declaration. Hosts that share a package must use the same policy for it.
`"latest"` and `"*"` are rejected; there is no always-upgrade mode yet.

Symlinks automatically depend on typed `windows.setting({ DeveloperMode: true })`
resources declared anywhere in the same host. Developer Mode remains an explicit
machine-policy choice: Winix does not enable it merely because a symlink exists.
Without that declaration, symlinks still require existing Developer Mode or elevation.

When generating in WSL, Winix uses `wslpath` to translate filesystem sources to
Windows drive/UNC paths. Sources inside the Linux filesystem use a WSL UNC path,
so that distribution must remain available during activation. Generation on
other Linux/macOS systems does not translate local paths; use Windows-reachable
absolute or environment-variable sources when generating there.

PowerShell module versions and repositories are pinned in the optional `modules`
section of the existing `winix-windows.lock` (source-qualified lowercase keys;
legacy name-only pins remain readable).
Old package-only locks remain valid. First apply resolves missing entries;
subsequent applies reuse pins without querying the repository.
`winix update --windows` refreshes packages and modules, or pass names to update
only selected entries; `--dry` resolves without writing. Resolution errors never
replace existing pins. Network access is still needed for installation.

`windows.powershell.module(name, { repository?, prerelease?, dependsOn? })` defaults to
the host repository policy, otherwise PSGallery, selects stable releases, and installs the exact locked version for
the current user. Registered feeds are queried with PowerShell 7 and PSResourceGet.
Installation is idempotent and runs directly in DSC's
`Microsoft.DSC.Transitional/PowerShellScript` resource; a declared `Microsoft.PowerShell` package is an
automatic dependency. Other versions are not removed. Profiles still import
modules themselves; an unversioned `Import-Module` can load a newer installed
version, so installation locking alone does not enforce session imports.
Set `prerelease: true` to allow a prerelease pin; its full version, including
the prerelease label, is locked and checked. A shared module with any stable-only
declaration remains stable-only.

`windows.setting(...)` implicitly declares `Microsoft.Windows.Settings` through
this same mechanism, with prereleases allowed and the host's repository policy
enforced. First apply adds its exact source-qualified module pin; no version
belongs in handwritten configuration. A different installed version does not
satisfy that pin. Native Settings activation and adapted-resource discovery with
multiple side-by-side module versions remain unverified; installing the pin
does not claim to force DSC's module selection.

Work profiles can enforce an approved feed without changing shared features:

```ts
const workRepositories = feature("work-repositories", ({ windows }) => {
  windows.powershell.repositories({
    repositories: {
      approved: { uri: "https://packages.example.com/powershell/v3/index.json" },
    },
    default: "approved",
    allowed: ["approved"],
  });
});
const work = profile("work", [workRepositories(), windowsShell()]);
```

The policy is resolved after host fragments merge. Omitted module repositories
and the automatic `Microsoft.Windows.Settings` installer use its default.
Explicit repositories outside `allowed` fail before resolution; there is no
fallback. Omit `allowed` to permit explicit overrides. It governs Winix-managed
PowerShell installers, not raw commands, generic DSC, npm, NuGet, or WSL.
Personal hosts without this feature retain PSGallery.
Conflicting policies in one host fail instead of silently widening its allowlist.

Named feeds use HTTPS URLs without embedded credentials. Lock resolution reuses an
existing registration only when its name and URI match. Otherwise, it queries the
declared NuGet v3 feed's `PackageBaseAddress` anonymously, without following
redirects. Feeds that require authentication or do not expose this v3 endpoint
need a matching registration configured separately through PSResourceGet.
PSGallery uses its public v2 endpoint if no matching registration exists.
Lock resolution never creates or modifies registrations, including during `--dry`.
Activation ensures registration before module installation and rejects a same-name
registration with a different URI. Global priorities and permanent trust are
unchanged. Do not put secrets in config or locks.
Pins distinguish module name, repository name, and configured URI across hosts;
a new source resolves its own pin. Existing matching installed versions are reused,
not reinstalled to attest their original source. Settings retains its existing
prerelease ensure behavior rather than adding a stable module lock.

### Provision WSL from a Windows host

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  const setup = windows.wsl({
    config: {
      wsl2: { memory: "16GB", processors: 8 },
      experimental: { autoMemoryReclaim: "gradual" },
    },
  });
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: "D:/WSL/NixOS",
    default: true,
    dependsOn: setup,
  });
});
```

`windows.wsl({ config?, backup?, force?, dependsOn? })` declares the `Microsoft.WSL`
package, enables the WSL and Virtual Machine Platform Windows features, and
optionally manages `.wslconfig`. The runtime uses normal package locking; a separate
`windows.package({ id: "Microsoft.WSL", ... })` can customize its package options.
Calling `windows.wsl()` without config leaves that file untouched.
`windows.optionalFeature(name,
{ enabled?, dependsOn? })` also supports individual optional features.
Feature changes require administrator approval. If a restart is required,
dependent provisioning stops: restart Windows yourself and rerun `winix switch`.
Winix never automatically restarts Windows or shuts down WSL.

Declare `windows.wsl()` in the same Windows host as its distros.
The distro automatically depends on the features, optional configuration file,
and runtime package; explicit `dependsOn` also supports other handles. The setup
handle covers the runtime package, features, and configuration when provided. Registration runs
as the current Windows user, not SYSTEM;
use the intended account rather than another administrator's credentials.
`installLocation` accepts an absolute local-drive path, an environment-variable
path, or a known-folder target. It must not already exist. Names and locations
must be unique per host; at most one distro may be declared default.

The `config` option owns the current user's complete `.wslconfig`, using the
normal file backup/force protections. Changes print a reminder to restart WSL
manually when safe. They do not immediately alter running distros.

First apply pins official stable NixOS-WSL image URLs and SHA256 digests for x64
and ARM64 in the optional `wslImages` section of `winix-windows.lock`. Subsequent
applies reuse these pins. `winix update --windows nixos-wsl` refreshes them;
updating all Windows entries includes images too. Downloads are verified before
import. Image updates affect **new registrations only**, never existing Linux
filesystems. Dry generation can resolve missing pins but neither writes the lock
nor downloads images.

Winix creates the declared distro only when its registration is absent. It never
replaces, moves, converts, or unregisters a conflicting existing distro.
Successful imports create
`.winix-wsl.json` in the installation directory to identify that registration.
If import is interrupted before recording completes, inspect the existing
registration and disk manually; Winix will not unregister it as rollback.
Removing declarations leaves distro data and enabled optional features intact.
Only explicit `enabled: false` disables a feature. The separately declared
WSL package follows normal package ownership/removal rules.

The Windows registration name (`NixOS`) and Linux Winix host name (`wsl-work`,
for example) are independent. The **same declaration** can create a distro on a
new machine or adopt a matching existing one:

```ts
windows.wsl();
windows.wsl.distro("NixOS", {
  source: "nixos-wsl",
  host: "wsl-work",
  installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
});
```

During Windows activation, an untracked registration must be WSL 2, run NixOS,
and report the expected Linux hostname. `host` supplies that hostname and defaults
to `setup.host` when omitted. Winix normally sets Linux's hostname to its host ID;
if yours is overridden, set `host` to the actual expected hostname. Without
either hostname declaration, existing untracked distros are refused.

Matching distros are automatically recorded under the current Windows user's
Local AppData `Winix\wsl-registrations\registration-<name>.json`. Records bind the
registration GUID, actual location, and adopted hostname. An adopted distro keeps
its actual location; `installLocation` is only the creation destination. Later
runs revalidate identity and refuse changed/missing registrations, hostname
changes, or invalid tracking records. Inspect these records before manual
recovery; never remove one while activation is running. Existing Winix import
markers remain supported and retain their provisioning behavior.

Adoption checks no Git origin, user, checkout, or config files and executes no
repository code. It may start a stopped distro but never writes Linux setup
state, clones repositories, installs dependencies, changes defaults, or activates
Linux. `setup` and `default` are not applied to adopted distros, even on later
runs. Activate Linux manually. `winix check` and dry generation perform static
checks only; creation pins may still be resolved, but no distro is inspected or
adopted. Removing the declaration leaves the distro, its data, and tracking alone.
Automatic adoption is not available in preview.3.

For a **new distro**, automate its first-run link by opting into `setup`:

```ts
windows.wsl.distro("NixOS", {
  source: "nixos-wsl",
  installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
  default: true,
  setup: {
    repository: "https://github.com/example/dotfiles.git",
    ref: "main",
    configDirectory: "winix",
    host: "wsl-work",
    user: "alice",
    checkout: "/home/alice/dotfiles",
  },
});
```

This explicitly trusts the repository and its Winix configuration (including
npm lifecycle scripts when using the npm SDK). Commit `flake.lock` in
`configDirectory`; the npm path additionally requires `package.json`,
`package-lock.json`, and a released Winix dependency supporting this API.
Only HTTPS Git URLs without embedded credentials are accepted. Private repository
and dependency authentication must already be available inside Linux; credentials
are never provisioned by this helper.

The Linux host must explicitly enable NixOS-WSL, import its input module, declare
`system.stateVersion`, and match the distro architecture; `platforms.wsl({
stateVersion })` does all of that. `user` selects an
already-declared normal account, not a second account definition. Omit it when
Home Manager or the sole normal account identifies the user unambiguously.
`winix check` (and every apply) validates the whole setup plan offline, before
any distro exists: `setup.host` names one NixOS host, the NixOS-WSL module and
`system.stateVersion` are declared, the account is a normal user on that host and
the checkout stays inside its home. Errors name the Windows host and distro.
Home Manager's username/home must agree with the selected account. `checkout`
defaults to `<declared-home>/dotfiles` and must stay inside that home.

First apply locks the repository ref (default `HEAD`) to a commit in
`wslRepositories`. `winix update --windows wsl-setup` refreshes these pins;
an update without names includes them too. Dry generation never clones or executes
repository code. Pins affect **first-run setup only**, not subsequent dotfiles
updates; an interrupted setup retains its original commit.

During activation, Git/config preparation (and npm on the npm path) runs as the image's initial `nixos`
user. A root coordinator first activates only the selected declarative account
and required WSL/shell settings, moves checkout ownership to it, then generates
the full host as that user and activates it as root. No password is invented and
sudo policy is not changed. External secret files required by the account must
already exist. The full host must set `wsl.defaultUser` to the selected user.

Setup records resumable stages under `/var/lib/winix/wsl-setup`; rerun Windows
`winix switch` after a reported failure. Dirty, occupied, or changed checkouts and
changed setup settings are refused, never reset or adopted. A killed coordinator
can leave `run.lock`: inspect its recorded PID/state and confirm no setup is
running before manually removing that lock. Other conflicts require explicit
manual recovery or a new distro. Successful setup is not repeated; later Linux
updates remain ordinary Linux Winix operations. No shutdown/reboot is performed;
restart WSL manually when safe if its new default-user setting needs it.
Fresh-image end-to-end activation remains unverified.

Without `setup`, repository installation and Linux activation remain manual.

#### Pair a Windows host with its WSL host

Walkthrough: [Pair a Windows host with its WSL host](docs/guides/pair-windows-and-wsl.md).
Pass values instead of repeating names: `setup.host` (and a distro's adoption
`host`) accept the value returned by `host(...)`, and `setup.user` the
`account.user(...)` factory; names still work.

`repository: "self"` reads the Git checkout holding `winix.config.ts` (local
Git only): the current branch's tracked remote (else `origin`; SSH remotes such
as `git@github.com:me/dotfiles.git` become HTTPS), its upstream branch as `ref`
(the commit when detached) and the config's path as `configDirectory`. The
commit is still pinned in `wslRepositories`; push the branch first, since the pin
is resolved on the remote. An inferred `ref` is left out of the completed-setup
fingerprint, so switching branches on Windows never trips the "settings changed"
guard on finished distros. Any other change to a setup declaration, including
moving to `"self"` without the same explicit `ref`, still changes the
fingerprint, and completed distros then refuse activation. Keep the existing
`ref` and `checkout` explicit when migrating machines that were already
provisioned. After `winix switch` on Windows, Winix prints the command that
applies later Linux changes inside each distro.

#### Reach Windows from WSL

`nix.wsl.windowsBin(name, paths)` builds a package whose `bin/<name>` runs the
first existing Windows path from a list. Paths are absolute (`C:\...`) or start
with an environment variable (`%LOCALAPPDATA%\...`); variables are expanded with
`cmd.exe` and converted with `wslpath`, which costs about 50ms per run. The shim
exits 127 with the paths it tried when none exist.
`home.wsl.gitCredentialManager({ paths? })` enables `programs.git` and points
`credential.helper` at such a shim for Git for Windows' ucrt64/mingw64 GCM.
Example: [Reach Windows from WSL](docs/guides/pair-windows-and-wsl.md#reach-windows-from-wsl).

### Bootstrap a Windows machine

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

### Windows sign-in startup

```ts
windows.startup.command("my-app", {
  executable: "%ProgramFiles%/MyApp/app.exe",
  arguments: ["--config", windows.knownFolder.appData("MyApp/config.json")],
  workingDirectory: windows.knownFolder.userProfile(),
  windowStyle: "minimized",
  dependsOn: appPackage,
});
```

`windows.startup.command(name, spec)` manages `<name>.lnk` in the current user's
actual Startup known folder. It only registers the shortcut: nothing is launched,
stopped, or reloaded during apply. Commands run at sign-in, not at machine boot;
this is not a service, scheduled task, elevated launch, or all-users startup API.

The executable may be an absolute path, an environment-variable path, a named
known-folder path, or an application name resolved on PATH during activation.
The executable and working directory must exist then; use `dependsOn` for
installation/configuration ordering. Relative filesystem paths are rejected.
The default working directory is the user profile. `arguments` is an argv array:
strings are literal (including `%VAR%`), while known-folder values resolve during
activation. Standard Windows argv quoting preserves spaces, empty arguments,
embedded quotes, backslashes, and Unicode; no shell is implicitly inserted.

`windowStyle` accepts `normal` (default), `minimized`, or `maximized`; minimized
does not guarantee a hidden console. Correct shortcuts are left untouched.
A different existing shortcut is moved by default to
`%LOCALAPPDATA%\Winix\startup-backups\<timestamp>-<name>.lnk`, outside the
Startup folder (Windows opens everything in that folder at sign-in, so a
`.lnk.bak` there would ask how to open it). `backup: false` refuses the replacement instead, and
`force: true` replaces it without a backup. A new shortcut is staged and verified before
replacing the old one. Keep names unique per host.

### Windows npm registries

Configure npm's current-user default and scoped registries independently from
PowerShell repositories:

```ts
windows.npm.registries({
  registries: {
    npmjs: { uri: "https://registry.npmjs.org/" },
    work: { uri: "https://packages.example.com/npm/" },
  },
  default: "work",
  scopes: { "@my-company": "work", "@adrifer": "npmjs" },
});
```

The host's merged policy emits one idempotent DSC resource managing only
`registry` and the declared `@scope:registry` entries in the current user's
`.npmrc` (or absolute `NPM_CONFIG_USERCONFIG` when set during activation).
Existing authentication, comments and unrelated scopes/options are preserved.
Managed keys are explicitly replaced; symlinked userconfigs and concurrent
edits fail rather than overwriting their targets. Removing declarations leaves
their previous settings in place; cleanup is not tracked.

Registries require HTTPS URLs without embedded credentials, queries or
fragments. Authentication stays external (for example `npm login` or existing
environment-token references); Winix never logs or declares tokens. npm itself
need not be installed to generate or apply this file resource.

Unlike PowerShell module policy, this does not enforce an `allowed` list:
project `.npmrc`, environment variables and npm command-line options can
override user settings, and package locks may contain independent download
URLs. It does not redirect Winix bootstrap/SDK downloads, WSL setup npm, or
install packages. `check`/`apply --dry` do not modify the userconfig.

### Windows personalization and fonts

These helpers manage the current Windows user without requiring elevation:

```ts
windows.wallpaper({ source: "../wallpapers/desktop.jpg", style: "Fill" });
windows.personalization({
  accentColor: "#336699",
  explorer: { showExtensions: true, showHiddenFiles: false, openTo: "ThisPC" },
  taskbar: { autoHide: false, search: "Hidden", taskView: true, widgets: false },
});
windows.fonts({
  sources: [
    "../fonts/MyFont-Regular.ttf",
    { url: "https://example.com/releases/v1/fonts.zip", files: ["**/*.ttf"] },
    { provider: "nerd-fonts", family: "JetBrainsMono" },
  ],
});
```

Wallpaper accepts a local path or `windows.knownFolder.*` path. Relative image
and font paths resolve from `winix.config.ts`, including Windows and WSL path
conversion. Wallpaper images are cached by content hash, so editing the source
image is detected. Styles are `Fill` (default), `Fit`, `Stretch`, `Tile`, `Center`,
and `Span`; this is one desktop background, not per-monitor image assignment.

Personalization only changes declared values. `accentColor` is `#RRGGBB` and
disables automatic accent coloring. Explorer `openTo` accepts `ThisPC` or `Home`;
hidden files does not expose protected operating-system files. Taskbar `search`
accepts `Hidden`, `Icon`, `IconAndLabel`, or `Box`. Explorer/taskbar/accent values
depend on Windows version and policy and may require signing out; Winix never
restarts Explorer. Existing `windows.setting()` theme settings remain available.
Avoid declaring conflicting automatic accent coloring in both helpers.

Fonts support local `.ttf`/`.otf` files, HTTPS `.ttf`/`.otf` downloads, and ZIP
archives. ZIP `files` accepts exact member paths or `**/*.ttf` / `**/*.otf`;
omitting it selects all font files. Unsafe archives, missing selections and
conflicting filenames fail explicitly. Downloads and expanded archives have
size limits. Remote sources must not contain credentials. An optional `sha256`
provides an independently trusted checksum; otherwise the first resolution
records the upstream digest or the downloaded bytes (trust on first use).

Remote fonts have a separate `fonts` section in `winix-windows.lock`. First
apply resolves missing entries; subsequent apply reuses them without a catalog
query. `winix update --windows fonts` refreshes only font pins; `--dry` never
writes pins or installs fonts. Installation verifies checksums and caches
downloads in Local AppData. Nerd Fonts IDs come from official release ZIP
assets, not a handwritten registry:

```sh
winix fonts search JetBrains --provider nerd-fonts
winix update --windows fonts --dry
```

Nerd Fonts is the only built-in provider. Its optional `version: "vX.Y.Z"` selects
an exact upstream release; otherwise latest resolves once and stays locked.
Provider IDs, archive filenames and installed family names differ. Installation
reports family names from font metadata; configure Terminal/editors separately
to select them. Fonts are installed and registered for the current user,
identical files are reused, and differing existing files/registry entries are
not overwritten. Updating a ZIP pin may therefore require explicitly resolving
an existing font collision. Font removal/cleanup is not tracked; deleting a
declaration leaves installed fonts and caches intact.

These helpers emit idempotent DSC PowerShell resources. Native desktop/font
activation has not been rehearsed on a shared machine; automated checks cover
authoring, locking, generated scripts and isolated archive handling.

### Previewing and applying Windows changes

`winix plan --host <name>` (the same as `winix switch --dry`) shows what a switch
would change, checked against the current machine. It never installs or writes
anything:

```text
Plan for desktop (checked against this machine):
  + install  DEVCOM.JetBrainsMonoNerdFont  (3.3.0)
  ~ upgrade  Git.Git  (2.55.0.3 -> 2.56.0.4)
  ~ upgrade  JesseDuffield.lazygit  (0.64.0 -> 0.66.1)
  ~ apply    link localAppData\nvim -> ../nvim/.config/nvim
  ? check    Enable Windows features Microsoft-Windows-Subsystem-Linux, VirtualMachinePlatform  (needs an elevated shell to check)
  = 31 unchanged (packages: 21, files: 4, settings: 2, ...)
  i 4 package(s) newer than locked; switch keeps them and offers to update the lock: Neovim.Neovim, ...
  ! 2 package(s) need administrator rights; switch asks once (UAC) for all of them: Git.Git (installed machine-wide), DEVCOM.JetBrainsMonoNerdFont (no per-user installer)
  ! JesseDuffield.lazygit is running (lazygit.exe, pid 12156); close it before switch: winget cannot upgrade a running portable app, and a failed upgrade can remove its command.
  ! Enable Windows features ... can require a Windows restart; Winix never restarts Windows.
  Summary: 20 to change, 2 not checked, 31 unchanged.

Removals and ownership (Winix applied-state inventory):
  Would remove: ["package","winget","old.app"]

winix switch would apply only these 20 change(s); work that needs administrator rights runs in one elevated step (one UAC prompt).
```

`winix switch` makes the same plan and then applies **only what is out of
date**, in dependency order:

- packages with `winget install` / `winget upgrade` (exact id, source and version);
- PowerShell script resources (files, links, Startup shortcuts, PATH, modules,
  WSL...) in one PowerShell 7 runner: check, apply, check again;
- other DSC resources (registry environment variables, Windows settings,
  `windows.dsc(...)`) with `dsc config set`, one resource at a time;
- raw `windows.raw` commands, on every switch.

Everything that needs administrator rights (machine-wide installs, packages
without a per-user installer, Windows features, machine environment variables,
Windows settings, `elevate: true`) runs in **one elevated step**: one UAC prompt
per switch, none when nothing machine-wide changes. Run `winix switch` as your
normal user; per-user packages and some DSC resources fail when the whole
switch runs elevated. A failed step only skips what depends on it; switch
reports every failure, exits non-zero, and the next switch retries. When
nothing is out of date, a switch takes about as long as the plan (seconds, not
minutes): the machine is inventoried once, and again after applying only if
something changed.

In a terminal, each phase shows a spinner with its elapsed time, then one line
when it finishes; while applying, the spinner names the step in progress (or
says it is waiting for the UAC prompt):

```text
✓ Read 30 installed package(s) (2.0s)
✓ Generated .winix/out/desktop/resources.json
✓ Checked 22 resource(s) on this machine (9.0s)

Plan for desktop (checked against this machine):
  + install  Proton.ProtonPass  (1.43.0)
  = 51 unchanged (packages: 29, files: 12, ...)
  Summary: 1 to change, 51 unchanged.

Applying 1 change(s):
  ✓ install Proton.ProtonPass 1.43.0 (45s)
Applied 1, already in place 0, failed 0, skipped 0.
✓ Verified 32 managed resource(s) (2.4s)

Done in 1m 01s.
```

Generated output per Windows host is `.winix/out/<host>/resources.json`: each
resource with its name, category, dependencies, elevation, and how to check
and apply it.

- `+` install, `~` change, `!` conflict (for example an exact pin older than the
  installed version: switch fails rather than downgrade), `?` could not be
  checked, `=` already in the desired state.
- Packages come from one `winget export` (a batched DSC read confirms any it
  does not list before switch installs them). Every other resource runs its
  own test script, each isolated so one failure (often a missing elevation)
  only marks that resource `?`. Raw `windows.raw` commands always show as
  `~ run`, because they run on every switch.
- Packages about to upgrade are checked for running processes from winget's
  portable installs (zip/exe tools such as lazygit, under `WinGet\Packages`).
  winget replaces those files in place, so an upgrade fails while one runs and
  can leave its command removed from `WinGet\Links`. The plan warns, and
  `winix switch` stops before applying anything until you close them.
- Installs and upgrades that need administrator rights are listed: upgrades
  keep the scope a package was installed with (`winget list --details` reports
  `Installed Scope: Machine`), and installs use whichever installer winget
  picks (compared with its per-user one). They join switch's elevated step; the
  UAC prompt can open behind other windows. To get per-user installers where packages offer them, set winget's
  `installBehavior.preferences` (`"scope": "user"` and, since many manifests
  declare no scope, `"installerTypes": ["portable", "zip"]`).
- Switch holds a lock next to the applied-state file and records its process.
  If a switch is interrupted (closed terminal, killed process), the next one
  removes the lock once that process is gone; the state file is only ever
  replaced atomically.
- Machine checks need native Windows with `dsc` and PowerShell 7. Elsewhere (for
  example `plan` for a Windows host from WSL) it lists what the host declares.
- It is also the drift check: anything changed outside Winix shows up as `~`.

Related commands:

- `winix apply --dry` still prints the full generated files; `apply --diff`
  prints a unified diff against the last generated `.winix/out`.
- `winix inspect --host <name>` lists each feature once, the scopes it targets
  (`windows`, `homeManager`, ...), the Windows resources it declares and their
  `dependsOn` edges, and marks features that contribute nothing on that platform.
- `--offline` (apply, switch, plan) never resolves `winix-windows.lock` online and
  fails, naming what is missing, when a pin is absent. `--locked` also fails when
  the lock would change at all, including inline versions it does not record yet.
  Use it in CI or on a machine that should only apply what is committed.
- `winix-windows.lock` no longer has a top-level `generatedAt` timestamp, so
  machines sharing one lock stop conflicting on it. Older lock files that still
  contain it remain valid; it disappears on the next change.
- File resources share one PowerShell module instead of repeating their helper
  functions in every script. The first resource, `Winix PowerShell helpers`,
  installs it to `%LOCALAPPDATA%\Winix\powershell\WinixFiles-<hash>.psm1`
  (content-addressed, so workspaces on different Winix versions never clash).

### Windows removal and ownership

Native Windows `winix switch` keeps a separate applied-state inventory under
`%LOCALAPPDATA%\Winix\applied-<machine-and-user-hash>.json`. This is machine-local
state, not the version lockfile and not something to commit or copy to another
machine. Canonical workspace directories and host names identify recorded
requirements across activations by the same Windows account.

- A shortcut Winix creates or explicitly replaces becomes owned after successful
  activation. Removing its declaration removes that unchanged shortcut on the
  next successful switch, without stopping the running program. An already
  matching, pre-existing shortcut is not automatically adopted.
- A package absent before and present after successful activation becomes owned.
  Already-installed packages satisfy requirements without gaining uninstall
  ownership. Removing a declaration automatically uninstalls an unused,
  previously owned package after successful activation. Preview all cleanup with
  `winix switch --dry`. Uninstallers may remove application data.
- External resources are never swept. Other recorded hosts/workspaces retain
  their requirements; incompatible shared declarations fail before activation.
  Removing a host or moving a workspace does not automatically release its old
  recorded requirements.

After moving a checkout or renaming a host, explicitly transfer the old owner's
requirements to the current config directory and new host:

```powershell
winix state owners
winix state migrate-owner <old-owner-id> --host new-host --dry
winix state migrate-owner <old-owner-id> --host new-host --yes
winix switch --host new-host --dry
```

Run migration from the new config checkout. It changes inventory
metadata only, never evaluates config or activates/deletes resources. Every
resource's snapshots and removal rights, including external/unowned status, are
preserved; other owners stay recorded. The next switch still enforces shared
requirements, drift checks and removal confirmation. Migration requires `--yes`
unless previewing with `--dry`; old owners are never discarded automatically.

When packages or startup shortcuts would be removed, `switch` lists them and asks
`Continue with switch? [y/N]` before activation. Declining or closing the prompt
cancels the whole switch without activation or cleanup. Switches without removals
and `--dry` do not prompt. Use `winix switch --yes` (or `-y`) to accept removals
for automation; noninteractive switches with removals require this flag.

During native Windows `switch`, a package without an inline `version` uses its
lock as a minimum version and fresh-install target. An absent package installs
the lock; an older installed version upgrades; a newer installed version is kept
and reported. The generated activation document targets that installed version,
not the older lock. External upgrades of owned packages retain ownership and
refresh the observed snapshot after successful activation. Pre-installed packages
remain unowned even when upgraded by Winix.

An inline declaration such as `windows.package({ id: "Git.Git", version: "2.44.0" })`
is exact. Installed version mismatches stop before activation, without an
automatic downgrade. Unequal versions that are not dotted numeric values cannot
be reliably ordered and fail with instructions to resolve them explicitly.

After a successful interactive switch that kept a newer floating package,
Winix asks `Update winix-windows.lock to <version>? [y/N]`. Declining keeps the
lock and still completes the switch. Dry/noninteractive runs never ask or
update observed-version pins; `--yes` confirms removals, not lock updates.
Normal missing-pin resolution remains unchanged. These defaults apply to
`winix switch`, not direct generated-script/DSC activation or plain `apply`.

Startup file hashes and installed package versions still protect removals.
If the installed version is non-numeric or reported as `Unknown` (common for
self-updating installers), switch warns and emits that floating package without
a version, so activation ensures it is installed instead of reinstalling the
locked version every run. The lock entry is kept. Exact pins still require a
match, and automatic removal refuses non-comparable installed versions.
External shortcut edits, package downgrades, and exact-pin drift block
reconciliation rather than silently deleting or overwriting managed resources.
Restore the recorded resource, or explicitly
release Winix's removal rights without deleting anything:

```powershell
winix state forget startup komorebi --dry
winix state forget startup komorebi
winix state forget package winget Example.App
```

`state forget` preserves recorded requirements but releases ownership for that
resource across this user's inventory. If still declared, it remains required;
future creation or explicit shortcut replacement can grant ownership again.
It does not fix a stale owner identity; use explicit owner migration instead.
Package removal requires an exact installed-version match and uses exact ID,
source, and version selection.

Dry Windows switches inspect and report removals without changing inventory,
system resources, or generated output. `apply`, or running generated
scripts yourself, does not record ownership or perform cleanup. A failed/interrupted activation never grants new
ownership; partial installations can remain unmanaged. Removal progress is saved
after each successful removal so failures can be retried conservatively.
Concurrent switches are refused. After a crash, inspect the inventory and
`.lock`/`.tmp` siblings before manually clearing stale files.

This coordinates recorded activations for one user/machine, not other users,
unrecorded configurations, or independent installers running concurrently.
Losing the inventory loses deletion rights; Winix does not reconstruct ownership
from installed software, existing shortcuts, generated output, or lockfiles.
Files, modules, Registry values, and PATH entries do not yet have removal tracking.

See
[`examples/windows/`](examples/windows) and
[`spec/proposals/windows-backend.md`](spec/proposals/windows-backend.md).

## Generated Nix

Winix evaluates fragments in two passes:

1. Collect active fragment IDs so `.isActive` works.
2. Resolve lazy fragments and deep-merge the results.
3. Generate a flake and one host module per host.

Objects merge recursively, arrays append, and scalar values use last-wins semantics.

## Type generation

Winix ships bundled option augmentations and can generate/update local option types:

```bash
winix types generate
winix types generate nixos
winix types generate home-manager
winix types generate darwin
```

## Project status

Winix is currently best suited for personal configurations and experimentation. The core workflow is functional, but expect API refinements before a stable `1.0`.

## Development

Only clone this repository if you want to work on Winix itself. For normal configuration usage, install `@adrifer/winix` from npm as shown above.

```bash
git clone https://github.com/adrifer/winix.git
cd winix
npm install
npm run check
npm test -- --run
npm run build
```

## License

MIT
