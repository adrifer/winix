---
title: Linux and macOS helpers
description: home.*, nixos.* and darwin.* helpers, nix.* expressions, binary releases, overlays and escape hatches for Nix hosts.
sidebar:
  order: 2
---

# Linux and macOS helpers

On NixOS, WSL and macOS hosts, every helper writes NixOS, Home Manager or
nix-darwin options. Your editor completes and checks them against the bundled
option types, so this page lists the helpers, not every option.

Helpers fall into three kinds:

- **Passthrough** for a whole option namespace: `nixos.networking({ ... })`
  writes `networking.*` as given.
- **Keyed helpers** for collections: `nixos.systemd.service("backup", { ... })`.
- **Shortcuts** that also enable something: `home.program("zsh", { ... })` is
  `programs.zsh = { enable = true; ... }`.

For an option without a helper, a plain object works:
`{ nixos: { hardware: { bluetooth: { enable: true } } } }`.

## home.* (Home Manager)

| Helper | Writes |
|---|---|
| `home.packages("ripgrep", "fd")` | `home.packages` (by nixpkgs attribute, or `nix.pkg(...)`) |
| `home.program("git", { settings })` | `programs.git`, enabled |
| `home.service("syncthing", { ... })` | `services.syncthing`, enabled |
| `home.env({ EDITOR: "nvim" })` | `home.sessionVariables` |
| `home.path("$HOME/.local/bin")` | `home.sessionPath` |
| `home.files({ ".npmrc": { text } })` | `home.file` |
| `home.configFiles({ "nvim": home.symlink("./nvim") })` | `xdg.configFile` |
| `home.configFile("tool/config.toml", { text })` | One `xdg.configFile` entry |
| `home.symlink("./dotfiles/x")` | A live link to a file in your checkout (relative to `winix.config.ts`), for `files`/`configFiles` |
| `home.activation("name", { script })` | A Home Manager activation script |
| `home.imports("...")` | Home Manager module imports |
| `home.raw("...")` | A raw Nix snippet in the Home Manager module |
| `home.wsl.gitCredentialManager({ paths? })` | Git on WSL using Git for Windows' Credential Manager ([WSL](wsl.md#reach-windows-from-wsl)) |

`home.symlink()` links to the file in the checkout, so edits apply without a
switch (Home Manager's `mkOutOfStoreSymlink`).

## nixos.*

| Helper | Writes |
|---|---|
| `nixos.packages("git", "curl")` | `environment.systemPackages` |
| `nixos.program("nix-ld", { ... })` | `programs.nix-ld`, enabled |
| `nixos.service("openssh", { settings })` | `services.openssh`, enabled |
| `nixos.networking({ hostName, firewall })` | `networking` |
| `nixos.boot({ loader })` | `boot` |
| `nixos.users({ users })` | `users` |
| `nixos.environment({ ... })`, `nixos.fonts(...)`, `nixos.security(...)`, `nixos.time(...)`, `nixos.nix(...)`, `nixos.system(...)` | The matching namespace |
| `nixos.sysctl({ "vm.swappiness": 10 })` | `boot.kernel.sysctl` |
| `nixos.systemd.service(name, { ... })`, `.userService(...)`, `.timer(...)` | `systemd.services`, `systemd.user.services`, `systemd.timers` |
| `nixos.systemd.tmpfiles.link(path, target)` | A `systemd.tmpfiles` symlink rule |
| `nixos.virtualisation.ociContainer(name, { ... })` | One OCI container, by name |
| `nixos.imports("inputs.x.nixosModules.y")` | Module imports |
| `nixos.raw("...")` | A raw Nix snippet in the host module |

## darwin.* (nix-darwin)

| Helper | Writes |
|---|---|
| `darwin.packages(...)` | `environment.systemPackages` |
| `darwin.program(...)`, `darwin.service(...)` | `programs.*`, `services.*`, enabled |
| `darwin.defaults({ dock: { autohide: true } })` | `system.defaults` |
| `darwin.homebrew({ casks: [...] })` | `homebrew` |
| `darwin.launchd.agent(name, { ... })`, `.daemon(...)` | `launchd.user.agents`, `launchd.daemons` |
| `darwin.security(...)`, `darwin.nix(...)` | The matching namespace |
| `darwin.imports(...)`, `darwin.raw("...")` | Module imports, raw Nix |

## nix.* expressions

Most values are plain TypeScript data. When a value must be a Nix expression,
build it with `nix.*` (imported from `@adrifer/winix`):

| | Nix |
|---|---|
| `nix.pkg("zsh")` | `pkgs.zsh` |
| `nix.pkg.stable("zsh")` | `pkgs.stable.zsh` (with `overlay.stable`, below) |
| `nix.bin("git", "git")` | The path of `git` in `pkgs.git` |
| `nix.homePath(".config/nvim")` | A path below `config.home.homeDirectory` |
| `nix.pkgPath("git", "share/git-core/templates")` | A path below `pkgs.git` |
| ``nix.str`${nix.pkg("neovim")}/bin/nvim` `` | An interpolated Nix string |
| ``nix.script`echo hi` `` | A multi-line script string |
| `nix.withPkgs(["git", "curl"])` | `with pkgs; [ git curl ]` |
| `nix.lib.mkForce(x)`, `mkDefault`, `mkBefore`, `mkAfter` | Option priorities and ordering |
| `nix.optionalAttrs(cond, attrs)`, `nix.optionalString(cond, s)`, `nix.isDarwin`, `nix.isLinux` | Conditionals evaluated by Nix |
| `nix.expr("...")` | Any Nix expression, as written |
| `nix.wsl.windowsBin(name, paths)` | A command that runs a Windows program from WSL ([WSL](wsl.md#reach-windows-from-wsl)) |

String content is quoted safely. Paths use `/`; a backslash is kept as a
literal character.

## nix.binaryRelease

A package for a prebuilt single-binary release (the `azd`, `gh`, `kubectl`
kind), without writing the derivation:

```ts
home.packages(
  nix.binaryRelease({
    name: "azure-dev-cli",
    version: "1.25.5",
    binary: "azd",
    urlTemplate: "https://github.com/Azure/azure-dev/releases/download/azure-dev-cli_{version}/{file}",
    platforms: {
      "x86_64-linux": { file: "azd-linux-amd64.tar.gz", hash: "sha256-..." },
      "aarch64-linux": { file: "azd-linux-arm64.tar.gz", hash: "sha256-..." },
      "x86_64-darwin": { file: "azd-darwin-amd64.zip", hash: "sha256-..." },
      "aarch64-darwin": { file: "azd-darwin-arm64.zip", hash: "sha256-..." },
    },
    meta: { description: "Azure Developer CLI", homepage: "https://github.com/Azure/azure-dev", license: "mit" },
  }),
);
```

- `urlTemplate` takes `{version}`, `{file}` and, per platform, `{platform}`.
- **Formats:** `.zip`, `.tar.gz` and `.tgz` files are unpacked. A bare
  executable needs `format: "raw"` on that platform; Winix never guesses that
  an extensionless file is executable. Formats can differ per platform.
- **Licenses** are nixpkgs `lib.licenses` names (`"mit"`, `"asl20"`), not SPDX
  ids: `"MIT"` is rejected when the config is evaluated rather than failing in
  the Nix build. Pass `nix.expr(...)` for anything else.
- Shell completions (through `installShellFiles`) and `autoPatchelfHook` on
  Linux are options too; your editor lists them.

## Overlays

```ts
import { overlay } from "@adrifer/winix";

overlay.stable("nixpkgsStable")   // pkgs.stable from another nixpkgs input
overlay.custom("(final: prev: { ... })")
overlay.darwin.stable(...), overlay.darwin.custom(...)   // macOS only
```

## Existing Nix modules

`rawModule("./hardware-configuration.nix")` (and `.homeManager(...)`,
`.darwin(...)`) includes a Nix module file as it is: the way to bring an
existing NixOS configuration over in pieces
([Workspace and hosts](config.md#rawmodule)).
