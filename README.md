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
outside the config checkout. Windows binaries are not yet code-signed:
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

### npm installation (optional)

```bash
mkdir my-winix-config
cd my-winix-config
npx @adrifer/winix@latest init
npm install
```

The npm CLI requires Node.js with native TypeScript transformation and the
`--experimental-transform-types` flag (Node 22.13+ or 24; use Node 24).
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
npx @adrifer/winix apply --diff           # show changes against current .winix/out/
npx @adrifer/winix switch --host my-host  # generate and run nixos-rebuild/darwin-rebuild
npx @adrifer/winix update                 # update generated flake.lock and copy it back
npx @adrifer/winix inspect                # inspect host composition and fragments
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

### Account helpers

`account.user()` wires together platform users and Home Manager users.

```ts
const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

host("wsl", platforms.nixos({ stateVersion: "25.05" }), [
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
nixos.users({ users: { root: { shell: nix.pkg("bash") } } })
nixos.system({ stateVersion: "25.05" })

home.program("zsh", { enableCompletion: true })
home.configFiles({ nvim: home.symlink("~/dotfiles/nvim/.config/nvim") })
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

This generates a DSC v3 document that `winget configure` applies. Typed helpers
also cover environment variables, PATH, files, Windows settings, and PowerShell
modules:

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  const developerMode = windows.setting({ DeveloperMode: true });
  const icons = windows.powershell.module("Terminal-Icons");

  windows.file.symlink(
    windows.knownFolder.documents("PowerShell\\Microsoft.PowerShell_profile.ps1"),
    "../windows/powershell/Microsoft.PowerShell_profile.ps1",
    { backup: true, dependsOn: [icons, developerMode] },
  );
});
```

`windows.knownFolder.documents(childPath?)` resolves redirected Documents **during activation**,
not on the machine generating the configuration. Supported folders are
`documents`, `desktop`, `localAppData`, `appData`, and `userProfile`. The optional
child path must stay within the folder. All `windows.file.*` targets accept it.
Copy/symlink source strings are relative to the directory containing
`winix.config.ts`, not the calling feature or working directory. Absolute paths,
`%VARIABLE%` paths, and `file:` URL objects remain supported. Symlinks stay live
and require the checkout to remain in place. Existing backup/force protections
are unchanged. Direct `generateWindows(hosts, lock, configDir)` callers must
supply `configDir` when using relative sources.

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

`windows.powershell.module(name, { repository?, dependsOn? })` defaults to
the host repository policy, otherwise PSGallery, selects stable releases, and installs the exact locked version for
the current user. PowerShell 7 with PSResourceGet must already be available for
resolution. Installation is idempotent and runs directly in DSC's
`Microsoft.DSC.Transitional/PowerShellScript` resource; a declared `Microsoft.PowerShell` package is an
automatic dependency. Other versions are not removed. Profiles still import
modules themselves; an unversioned `Import-Module` can load a newer installed
version, so installation locking alone does not enforce session imports.

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

Named feeds use HTTPS URLs without embedded credentials. Version resolution
registers a missing feed for the current user; activation also ensures registration
before module installation. A same-name registration with a different URI is an
error, never overwritten. Registration persists, but global priorities and permanent
trust are unchanged. Authenticate separately using the organization's supported
PSResourceGet setup; do not put secrets in config or locks. `--dry` does not write
the lock or activate resources, but resolving missing versions can register a feed.
Pins distinguish module name, repository name, and configured URI across hosts;
a new source resolves its own pin. Existing matching installed versions are reused,
not reinstalled to attest their original source. Settings retains its existing
prerelease ensure behavior rather than adding a stable module lock.

### Provision WSL from a Windows host

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  const runtime = windows.package("Microsoft.WSL");
  const setup = windows.wsl({
    config: {
      wsl2: { memory: "16GB", processors: 8 },
      experimental: { autoMemoryReclaim: "gradual" },
    },
    backup: true,
  });
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: "D:/WSL/NixOS",
    default: true,
    dependsOn: [setup, runtime],
  });
});
```

`windows.wsl({ config?, backup?, force?, dependsOn? })` enables the WSL and
Virtual Machine Platform Windows features and optionally manages `.wslconfig`.
Calling `windows.wsl()` without config leaves that file untouched.
`windows.optionalFeature(name,
{ enabled?, dependsOn? })` also supports individual optional features.
Feature changes require administrator approval. If a restart is required,
dependent provisioning stops: restart Windows yourself and rerun `winix switch`.
Winix never automatically restarts Windows or shuts down WSL.

Declare both the features and `Microsoft.WSL` package in the same Windows host.
The distro automatically depends on the features, optional configuration file,
and runtime package; explicit `dependsOn` also supports other handles. The setup
handle covers both features and configuration when provided. Registration runs
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

Winix refuses conflicting or unrecorded existing distros; it does not automatically
adopt, replace, move, convert, or unregister them. Successful imports create
`.winix-wsl.json` in the installation directory to identify that registration.
If import is interrupted before recording completes, inspect the existing
registration and disk manually; Winix will not unregister it as rollback.
Removing declarations leaves distro data and enabled optional features intact.
Only explicit `enabled: false` disables a feature. The separately declared
WSL package follows normal package ownership/removal rules.

The Windows registration name (`NixOS`) and Linux Winix host name (`wsl-work`,
for example) are independent. To automate their first-run link, opt into `setup`:

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
`system.stateVersion`, and match the distro architecture. `user` selects an
already-declared normal account, not a second account definition. Omit it when
Home Manager or the sole normal account identifies the user unambiguously.
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
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1 -Check
# Executable workflow: omit all Node/npm checks and installations.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1 -Standalone -Check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1 -Standalone
# Review and confirm installation/upgrade of missing or outdated prerequisites.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1
# Choose NVM for Windows rather than standalone Node on NVM-based setups.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\bootstrap-windows.ps1 -UseNvm
```

`-ExecutionPolicy Bypass` applies to this process only, not the machine/user
policy; organizational policy may still block execution. `-Yes` accepts bootstrap
installation for automation. Installers may request UAC elevation. The script
checks Git, Node (22.13+), npm, PowerShell (7.4+), PSResourceGet/PSGallery, DSC
(3.2+), and the backend's required DSC resources. Supported existing versions
are kept; standalone installs use `Git.Git`, `OpenJS.NodeJS.LTS`,
`Microsoft.PowerShell`, and `Microsoft.DSC` from the exact WinGet source/IDs.
`-UseNvm` installs `CoreyButler.NVMforWindows` if needed and selects Node LTS
through NVM instead. It refuses to introduce standalone Node alongside an
existing NVM installation when Node needs setup. Install mode also enables
WinGet configuration components (requires Store access); `-Check` does not.

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
  backup: true,
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
Replacement is refused by default; `backup: true` preserves an existing entry
as `.lnk.bak` and refuses backup collisions, while `force: true` opts into
replacement without a backup. A new shortcut is staged and verified before
replacing the old one. Keep names unique per host.

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

When packages or startup shortcuts would be removed, `switch` lists them and asks
`Continue with switch? [y/N]` before activation. Declining or closing the prompt
cancels the whole switch without activation or cleanup. Switches without removals
and `--dry` do not prompt. Use `winix switch --yes` (or `-y`) to accept removals
for automation; noninteractive switches with removals require this flag.

Startup file hashes and installed package versions detect drift. External edits
or version changes block reconciliation rather than silently deleting or
overwriting managed resources. Restore the recorded resource, or explicitly
release Winix's removal rights without deleting anything:

```powershell
winix state forget startup komorebi --dry
winix state forget startup komorebi
winix state forget package winget Example.App
```

`state forget` preserves recorded requirements but releases ownership for that
resource across this user's inventory. If still declared, it remains required;
future creation or explicit shortcut replacement can grant ownership again.
Package removal requires an exact installed-version match and uses exact ID,
source, and version selection.

Dry Windows switches inspect and report removals without changing inventory,
system resources, or generated output. `apply`, running generated
scripts directly, or invoking `winget configure` yourself does not record
ownership or perform cleanup. A failed/interrupted activation never grants new
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
