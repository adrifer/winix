---
title: Features, profiles and hosts
description: The Winix model - what a feature declares, how profiles group features, and how hosts pick them up per platform.
sidebar:
  order: 1
---

# Features, profiles and hosts

A Winix config is built from three kinds of pieces, all plain functions:

- a **feature** declares something;
- a **profile** groups features;
- a **host** is a machine on one platform, with the features and profiles it
  gets.

A **workspace** lists the hosts and the Nix inputs they use. It's the default
export of `winix.config.ts`.

```ts
import { feature, host, platforms, profile, workspace } from "@adrifer/winix";

const lazygit = feature("lazygit", ({ home, windows }) => {
  home.packages("lazygit");
  windows.package("JesseDuffield.lazygit");
});

const everywhere = profile("everywhere", [lazygit()]);

export default workspace({
  inputs: { nixpkgs: "nixos-unstable" /* , homeManager, nixosWsl... */ },
  hosts: [
    host("DESKTOP", platforms.windows(), [everywhere()]),
    host("wsl", platforms.wsl({ stateVersion: "25.05" }), [everywhere()]),
  ],
});
```

## Features declare

`feature(id, body)` returns a factory; calling it (`lazygit()`) gives the piece
a host or profile includes. The body receives one namespace per kind of
target, and every call through them declares something for this host:

| Namespace | Applies on | Declares |
|---|---|---|
| `home.*` | NixOS, WSL and macOS hosts | Home Manager: packages, programs, dotfiles, environment |
| `nixos.*` | NixOS and WSL hosts | NixOS: system packages, services, users, networking |
| `darwin.*` | macOS hosts | nix-darwin: defaults, Homebrew, launchd |
| `windows.*` | Windows hosts | Packages, files, environment, settings, startup apps, WSL distros |
| `platforms` | everywhere | `isActive` checks (below) |

A namespace that doesn't apply to the host is simply ignored. That's what lets
**one feature cover a tool on every platform**: the Windows host takes the
`windows.*` half, the WSL host the `home.*` half
([Write a cross-platform feature](../guides/cross-platform-feature.md)).

Features can take arguments, which is how one feature can refer to another
host or user:

```ts
const nixosWsl = feature("nixos-wsl", ({ windows }, linuxHost: HostDef) => {
  windows.wsl.distro("NixOS", { source: "nixos-wsl", setup: { repository: "self", host: linuxHost } });
});

host("DESKTOP", platforms.windows(), [nixosWsl(linuxHost)]);
```

`nix.*`, `account` and `overlay` aren't passed in; import them from
`@adrifer/winix` where you need them.

### Declaring and returning

Calls through the namespaces a feature receives register themselves. A body
can also return what it declares, one fragment or an array, which is the older
style and still works:

```ts
const neovim = feature("neovim", ({ home }) => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);
```

Two things must be returned rather than just called: other features and
profiles (`return [git(), lazygit()]`), and helpers imported at the top of a
file instead of received by the body.

## Profiles group

`profile(id, entries)` names a list of features, other profiles and plain
fragments:

```ts
export const dev = profile("dev", [node(), docker(), lazygit()]);
```

Profiles take only an array, never a body. They're how a config describes
**roles**, kinds of machines such as "everywhere", "dev" or "work", and they
span operating systems: a Windows PC and a Mac can share `dev()`, and each gets
its own half of every feature in it
([Organising a config](organising-a-config.md)).

## Hosts target one platform

`host(name, platform, entries)` is one machine, or one WSL distro, on one
platform:

| Platform | For |
|---|---|
| `platforms.nixos({ stateVersion, system?, ... })` | NixOS |
| `platforms.wsl({ stateVersion, ... })` | NixOS under WSL: also imports the NixOS-WSL module and sets `wsl.enable` |
| `platforms.darwin({ stateVersion, homebrew?, ... })` | macOS with nix-darwin |
| `platforms.windows()` | Windows |

A Windows PC and the NixOS distro in its WSL are **two hosts**: different
platforms, applied separately, usually defined side by side
([Pair Windows with WSL](../guides/pair-windows-and-wsl.md)).

A host can also take a body instead of an array, with the same namespaces as a
feature, for host-only details:

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  windows.setting({ DeveloperMode: true });
  return [everywhere(), dev()];
});
```

The host's name is how you select it (`--host DESKTOP`) and, on Nix hosts, its
hostname.

## Asking where you are

Inside a feature, `platforms.<name>.isActive` says whether the host being built
is that platform, so small differences stay in one feature:

```ts
const shell = feature("shell", ({ home, platforms }) => {
  home.program("zsh", {
    shellAliases: {
      ...(platforms.nixos.isActive && { rebuild: "sudo nixos-rebuild switch" }),
      ...(platforms.darwin.isActive && { rebuild: "sudo darwin-rebuild switch" }),
    },
  });
});
```

A WSL host is NixOS, so both `platforms.nixos.isActive` and
`platforms.wsl.isActive` are true there. Features have `isActive` too
(`docker.isActive`): true when the host includes that feature anywhere.

## Users

On Nix hosts, `account.user(name, () => options)` declares a Linux or macOS
user together with its Home Manager configuration, so `home.*` has someone to
apply to:

```ts
import { account } from "@adrifer/winix";

export const alice = account.user("alice", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true, // the default user of a NixOS-WSL distro
}));

host("wsl", platforms.wsl({ stateVersion: "25.05" }), [alice(), everywhere()]);
```

Windows hosts apply to the user running `winix switch`; they don't declare
users.

## How declarations combine

Everything a host gets is evaluated in host order and merged into one
configuration per host:

| Value type | Nix (`nixos`, `homeManager`, `darwin`) | Windows (`windows`) |
|---|---|---|
| **Objects** | Merged recursively, key by key | Merged by resource identity (package id, file target path, env var name, setting key) |
| **Arrays** | Appended in declaration order (two features adding packages get both) | Appended (`dependsOn`, PATH entries, raw commands); duplicates de-duplicated where appropriate |
| **Scalars** | Last declaration wins; `winix check` warns on conflicting values across features | Contradictory declarations (e.g. two different exact versions for one package, or two files at the same target path) fail evaluation with an error |

### Resolving conflicts

- **Order in the host list** determines which scalar wins on Nix hosts; put
  host-specific overrides after shared roles (`[everywhere(), dev(), hostOverrides()]`).
- **Nix option priorities:** use `nix.lib.mkDefault(value)` for a fallback a
  host can override without a conflict, or `nix.lib.mkForce(value)` to override
  a value set by an upstream NixOS/Home Manager module.
- **Strict checks:** `winix check --strict` turns scalar-conflict warnings into
  errors—useful in CI to catch accidental overrides across features.
- **Inspecting what won:** `winix inspect --host <name>` shows what each
  feature contributed to a host; `winix inspect --matrix` shows every feature
  against every host.

Every helper and option: [Workspace and hosts](../reference/config.md),
[Linux and macOS helpers](../reference/nix.md), [Windows](../reference/windows/README.md).
