---
title: Move a NixOS machine to Winix
description: Bring an existing NixOS machine (configuration.nix or flake) over to Winix piece by piece, without breaking a working system.
sidebar:
  order: 7
---

# Move a NixOS machine to Winix

You don't need to rewrite `/etc/nixos/configuration.nix` in one go.
`rawModule()` lets Winix include your existing `.nix` files as they are, so
you can get a working, identical `winix plan` on day one and move modules into
TypeScript features at your own pace.

You need Winix [installed](../start/install.md) and a project started with
`winix init` ([Your first config](../start/first-config.md)).

## 1. Copy hardware-configuration.nix and check stateVersion

Copy the machine's generated hardware file into your repository, and note the
`system.stateVersion` already in `/etc/nixos/configuration.nix`:

```bash
mkdir -p machines/workstation
cp /etc/nixos/hardware-configuration.nix machines/workstation/
grep stateVersion /etc/nixos/configuration.nix
```

Keep that exact `stateVersion`: it records the release the machine was first
installed with, not the latest NixOS version.

If you have existing custom `.nix` modules (or your whole `configuration.nix`),
copy them into the repository as well—for example `machines/workstation/legacy.nix`—and
remove its `imports = [ ./hardware-configuration.nix ];` line so Winix imports
each file once.

## 2. Declare the host with rawModule()

Wrap your existing modules so the generated flake produces the same system you
run today:

```ts
import { account, defineInputs, host, platforms, rawModule, workspace } from "@adrifer/winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: {
    url: "github:nix-community/home-manager",
    follows: { nixpkgs: "nixpkgs" },
  },
});

const alice = account.user("alice", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
}));

export default workspace({
  inputs,
  hosts: [
    host("workstation", platforms.nixos({ stateVersion: "25.05" }), [
      rawModule("./machines/workstation/hardware-configuration.nix"),
      rawModule("./machines/workstation/legacy.nix"),
      alice(),
    ]),
  ],
});
```

- Every `rawModule()` path is relative to `winix.config.ts` and must stay
  inside the repository; Winix copies the files into `.winix/out/`.
- If you already use Home Manager, bring its module across with
  `rawModule.homeManager("./machines/workstation/legacy-home.nix")` until you
  move its pieces into `home.*` features.
- If your old config already defines your user, remove the user block from
  `legacy.nix` once `account.user()` replaces it (or keep `legacy.nix` and
  omit `account.user()` until you're ready to switch users over).

## 3. Lock inputs and verify before touching the system

Generate `flake.lock` (or copy your existing `flake.lock` alongside
`winix.config.ts`), check the config, and inspect the generated Nix:

```bash
winix update            # writes flake.lock (skip if you copied an existing one)
winix check
winix apply --dry       # prints flake.nix and hosts/workstation.nix
```

Then run a dry build and compare against your running system:

```bash
winix plan
```

`plan` builds the new system without activating it and lists package, `/etc`,
Home Manager file, and service differences against `/run/current-system`
([How changes are applied](../concepts/applying-changes.md#the-plan-on-nixos-and-wsl)).
If anything unexpected shows up, adjust the config and re-run `winix plan`
until the diff matches what you expect.

## 4. Switch

```bash
winix switch
```

`switch` reuses the build from `plan` and activates it with `nixos-rebuild`.
Your previous generations remain in the boot menu, and
`sudo nixos-rebuild switch --rollback` reverts immediately if needed.

## 5. Migrate piece by piece

Once the machine switches cleanly through Winix, move one section at a time out
of `legacy.nix` into typed features:

1. Extract a block (packages, SSH, Docker, dotfiles) into a feature under
   `features/`.
2. Delete that block from `legacy.nix`.
3. Run `winix plan` to confirm the generated system didn't change unexpectedly.

Use `winix check --escape-report` at any point to see which `rawModule()`,
`nixos.raw()`, and `home.raw()` escape hatches are still left. Keep
`rawModule("./machines/workstation/hardware-configuration.nix")` permanently—there
is no benefit to rewriting generated hardware config in TypeScript.
