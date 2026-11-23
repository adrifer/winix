---
title: Workspace and hosts
description: workspace, inputs, host, feature, profile, platforms and account - the functions every config is built from.
sidebar:
  order: 1
---

# Workspace and hosts

Everything on this page is imported from `@adrifer/winix`. How the pieces fit
together: [Features, profiles and hosts](../concepts/features-and-hosts.md).

## workspace

```ts
export default workspace({ inputs, hosts: [...] });
```

The default export of `winix.config.ts`.

| Field | |
|---|---|
| `hosts` | Every host, from `host()`. |
| `inputs` | Nix flake inputs. Required, with `nixpkgs`, when there are NixOS, WSL or macOS hosts; a Windows-only workspace needs none. |

## Inputs

```ts
const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", { follows: { nixpkgs: "nixpkgs" } }),
  nixDarwin: input("github:nix-darwin/nix-darwin", { nixName: "nix-darwin", follows: { nixpkgs: "nixpkgs" } }),
  nixosWsl: input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } }),
});
```

- **A string** is a nixpkgs branch (`"nixos-unstable"` becomes
  `github:NixOS/nixpkgs/nixos-unstable`) or a `github:` URL.
- **`input(url, { follows?, nixName? })`**, or the same object written out
  (`{ url, follows }`). `follows` maps the input's own inputs to yours.
- **Names** are camelCase in TypeScript and kebab-case in the flake
  (`homeManager` → `home-manager`); `nixName` sets the flake name explicitly.
- **`defineInputs()`** only adds type inference.

The platforms use them by name: Home Manager needs `homeManager`,
`platforms.wsl()` needs `nixosWsl`, and `platforms.darwin({ homebrew: true })`
needs a `nix-homebrew` input. `winix check` warns when one is missing.

## host

```ts
host(name, platform, entries)
host(name, platform, ({ home, nixos, darwin, windows, platforms }) => { ... })
```

One machine (or one WSL distro) on one platform. `entries` is an array of
features, profiles and fragments. The body form receives the same namespaces as
a feature, declares through them, and may return entries.

`name` selects the host (`--host <name>`) and is the hostname on Nix hosts.
`host()` returns a value other declarations can refer to, such as a WSL setup's
`host`.

## Platforms

| | Options |
|---|---|
| `platforms.nixos(opts)` | `stateVersion`, `system` (default `x86_64-linux`), `allowUnfree` (default `true`), `homeManager` (default `true`), `hostname` (default: the host name; `false` to leave it unset) |
| `platforms.wsl(opts)` | Everything `nixos` takes, plus `input` (the NixOS-WSL input's flake name, default `nixos-wsl`). Imports the NixOS-WSL module and sets `wsl.enable`. |
| `platforms.darwin(opts)` | `stateVersion`, `system` (default `aarch64-darwin`), `allowUnfree`, `homeManager`, `homebrew` (default `false`; enables nix-homebrew), `hostname` |
| `platforms.windows()` | None needed. |

Every platform also has `isActive`, for use inside features:
`platforms.windows.isActive`, `platforms.wsl.isActive`, and so on. A WSL host
is NixOS, so `platforms.nixos.isActive` is true there as well.

All NixOS and macOS hosts get `nix-command` and `flakes` enabled. With Home
Manager, `useGlobalPkgs` and `useUserPackages` are set.

## feature

```ts
const name = feature(id, (context, ...args) => { ... });
name(...args)  // an entry for a host or profile
```

| Context member | Declares for |
|---|---|
| `home` | Home Manager on NixOS, WSL and macOS hosts |
| `nixos` | NixOS and WSL hosts |
| `darwin` | macOS hosts |
| `windows` | Windows hosts |
| `platforms` | Nothing: `isActive` checks |

Calls through the context register themselves. The body can also return a
fragment or an array; other features and profiles must be returned to be
included. `name.isActive` is true while building a host that includes the
feature.

## profile

```ts
const dev = profile(id, [entry, entry, ...]);
```

A named group of entries (features, profiles, fragments). Array only, no body.
`dev.isActive` works like a feature's.

## account

```ts
const alice = account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }));
host("wsl", platforms.wsl({ stateVersion: "25.05" }), [alice()]);
```

`account.user(name, () => options)` declares a user on NixOS and macOS (on
macOS also `system.primaryUser`) and its Home Manager configuration:

| Option | |
|---|---|
| `admin` | On NixOS, adds the user to `wheel`. |
| `shell` | Login shell, by package name (`"zsh"`) or reference. Also enables the shell's NixOS or nix-darwin program. |
| `stateVersion` | Home Manager's `home.stateVersion`. |
| `wslDefault` | Makes the user `wsl.defaultUser` on NixOS-WSL, unless the host sets one. |
| `home`, `homeDirectory` | The home directory (default `/home/<name>`, or `/Users/<name>` on macOS). |
| `description`, `uid`, `gid`, `group`, `groups`, `extraGroups`, `isNormalUser`, `isSystemUser` | The matching NixOS user options (`description`, `uid`, `gid` on macOS too). |
| `packages` | Packages for this user (NixOS). |
| `sessionVariables` | Home Manager session variables. |
| `openssh` | `{ authorizedKeys?, authorizedKeyFiles? }`. |
| `hashedPasswordFile` | A file with the hashed password. |
| `homeManager` | Extra Home Manager config for this user, as a fragment. |

`account.group(name, () => ({ gid?, members? }))` declares a group; `members`
takes users by name or by their `account.user` value.

## rawModule

```ts
rawModule("./hardware-configuration.nix")          // a NixOS module
rawModule.homeManager("./legacy/home.nix")
rawModule.darwin("./legacy/darwin.nix")
```

Includes an existing Nix module file as it is. The path is relative to
`winix.config.ts` and must stay inside the project; the file is copied into the
generated output.

## Generated output

```text
.winix/out/
  flake.nix              inputs and one configuration per Nix host
  flake.lock             copied from the project's flake.lock
  hosts/<host>.nix       each Nix host's merged options
  <windows-host>/
    resources.json       each Windows resource and how to check and apply it
```

`winix apply` and `winix switch` write it; `.winix/` is git-ignored. Fragment keys are the Nix
option names as written (`"experimental-features"`, not
`experimentalFeatures`): Winix never converts option keys.
