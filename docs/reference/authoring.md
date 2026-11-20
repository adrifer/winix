---
title: Writing a config
description: Workspaces, hosts, features and profiles, platform-aware config, helpers, escape hatches, generated Nix and editor types.
---

# Writing a config

## Workspaces and hosts

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

## Features and profiles

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
it makes sense. See [Write a cross-platform feature](../guides/cross-platform-feature.md),
or start one with `winix scaffold feature <name>`.

## Organising a config

`winix init` starts with one file. As a config grows to several machines and
operating systems, this layout keeps "what does each machine get?" easy to answer:

```
winix.config.ts     inputs + the list of machines
machines/           one file per computer: its roles and machine-only extras
                    (a Windows PC and its WSL distro are one machine, two hosts)
roles/              profiles for kinds of machines (everywhere, dev, work...),
                    spanning operating systems
features/           one file per tool, declaring every OS it supports
```

A machine lists roles, a role lists features, and each host gets its own
platform's half of every feature. `winix inspect --matrix` prints the result,
every feature against every host and grouped by role, and `winix check` only
flags features listed on a host directly that do nothing there.
[`examples/cross-platform`](../../examples/cross-platform) is a small, runnable
version of this layout.

## Platform-aware configuration

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

## Account helpers

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

## Curated helpers

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

## Nix escape hatches

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
licenses that aren't a simple `pkgs.lib.licenses.<id>` lookup.

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

## Generated Nix

Winix evaluates fragments in two passes:

1. Collect active fragment IDs so `.isActive` works.
2. Resolve lazy fragments and deep-merge the results.
3. Generate a flake and one host module per host.

Objects merge recursively, arrays append, and scalar values use last-wins semantics.

## Editor types

Autocomplete and type checking need no npm install. Every command that loads a
config (`check`, `apply`, `plan`, `switch`, `update`, `inspect`, and `init`)
writes the type declarations of the Winix that runs it to the config's ignored
`.winix/types`:

- the Winix SDK, including the bundled NixOS, Home Manager and nix-darwin
  option types (so `nixos.program("nix-ld", { ... })` completes and is checked);
- Node's types (`@types/node` and `undici-types`), for `node:` imports.

They are rewritten only when they change, so they always match the pinned Winix.
`winix types` writes them on demand and prints what `tsconfig.json` still needs.
`winix init` generates a tsconfig that uses them; for an existing config, add:

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

Your editor's built-in TypeScript does the rest (VS Code needs nothing else).
The bundled option types are generated by Winix maintainers from NixOS, Home
Manager and nix-darwin (`npm run generate:types` in the Winix repository) and
ship with each release.
