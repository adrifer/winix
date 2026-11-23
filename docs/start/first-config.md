---
title: Your first config
description: From an empty folder to your first winix switch, on Windows or on NixOS and WSL.
sidebar:
  order: 3
---

# Your first config

This walks you from an empty folder to a machine Winix manages. It takes a few
minutes and changes very little: one or two packages, which you can remove
again the same way.

You need Winix [installed](install.md). The commands are the same on every
platform; only the config you write differs.

## 1. Create the project

A Winix config is usually a Git repository you'll later clone on your other
machines:

```bash
mkdir dotfiles
cd dotfiles
git init
winix init
```

`init` writes:

| File | What it is |
|---|---|
| `winix.config.ts` | Your config: a starter host to replace below. |
| `package.json` | Pins the Winix version this config uses. |
| `tsconfig.json` | Lets your editor complete and check the config. |
| `.gitignore` | Ignores `.winix/`, where Winix writes generated output, types and downloads. |
| `.agents/skills/winix/SKILL.md` | Points coding agents at `winix --skill`. |

Open the folder in your editor. Type `windows.` or `home.` anywhere in the
config and you get completion for every helper.

## 2. Describe this machine

### On Windows

Replace `winix.config.ts` with a Windows host:

```ts
import { host, platforms, workspace } from "@adrifer/winix";

export default workspace({
  hosts: [
    host("DESKTOP", platforms.windows(), ({ windows }) => {
      windows.package("JesseDuffield.lazygit");
      windows.package("BurntSushi.ripgrep.MSVC");
      windows.env.set("EDITOR", "code --wait");
    }),
  ],
});
```

- `windows.package()` takes a WinGet id. Find ids with
  `winix windows search <name>`, which also prints the line to paste.
- A workspace with only Windows hosts needs no Nix inputs.
- With a single host, Winix uses it without `--host`. Once you have several,
  name each after its computer (`$env:COMPUTERNAME`) or pass `--host`.

### On NixOS or WSL

The starter config is already a NixOS host. Make it match this machine:

```ts
import { account, host, nixos, platforms, rawModule, workspace } from "@adrifer/winix";

export default workspace({
  inputs: {
    nixpkgs: "nixos-unstable",
    homeManager: {
      url: "github:nix-community/home-manager",
      follows: { nixpkgs: "nixpkgs" },
    },
  },
  hosts: [
    host("my-host", platforms.nixos({ stateVersion: "25.05" }), [
      rawModule("./hardware-configuration.nix"),
      account.user("alice", () => ({ admin: true, shell: "zsh", stateVersion: "25.05" }))(),
      nixos.packages("git", "lazygit", "ripgrep"),
    ]),
  ],
});
```

- **The host name** is the machine's hostname: Winix sets it.
- **`stateVersion`** must be the one in your current
  `/etc/nixos/configuration.nix`. It isn't "the latest version"; it records
  which NixOS release this machine started on.
- **`account.user`** declares your Linux user and its Home Manager setup. Use
  your own user name.
- **On a NixOS machine** (not WSL), copy `/etc/nixos/hardware-configuration.nix`
  into the folder. `rawModule()` includes it as it is; without it the machine
  would not know its disks.
- **On WSL**, use `platforms.wsl({ stateVersion })` instead of
  `platforms.nixos(...)`, drop the `rawModule()` line, and add the NixOS-WSL
  input: `nixosWsl: { url: "github:nix-community/NixOS-WSL", follows: { nixpkgs: "nixpkgs" } }`.

## 3. Check it

```bash
winix check
```

`check` evaluates the config without touching the machine: type errors, a
package declared twice with different settings, a WSL host without its input.
Fix what it reports and run it again.

## 4. See what would change

```bash
winix plan
```

On Windows, `plan` checks each resource against the machine and lists only what
differs:

```text
Plan for DESKTOP: 3 changes, 0 unchanged
  + install  JesseDuffield.lazygit    0.56.0
  + install  BurntSushi.ripgrep.MSVC  14.1.1
  ~ apply    EDITOR=code --wait (user)
```

On NixOS and WSL, `plan` prints the `nixos-rebuild` command `switch` would run.
`winix apply --dry` shows the Nix Winix generated for it.

## 5. Apply it

```bash
winix switch
```

On Windows, `switch` applies the plan: it installs the packages and sets the
variable. Anything that needs administrator rights runs in one step with one
UAC prompt. The first switch also writes `winix-windows.lock` with the exact
package versions it installed.

On NixOS and WSL, run `winix update` once first: it writes `flake.lock`, which
pins nixpkgs and the other inputs to exact commits. Then `switch` generates the
flake and runs `sudo nixos-rebuild switch` with it.

Run `winix plan` again: nothing to change. On Windows, remove the ripgrep line
and plan again: it's marked `- remove`. Winix uninstalls packages it installed
once you delete their declaration, and asks first. A package that was already
there before Winix is never removed
([What Winix owns](../concepts/ownership.md)).

## 6. Commit it

```bash
git add .
git commit -m "My first Winix config"
```

Commit `winix-windows.lock` and `flake.lock` along with the config: they make
every machine install the same versions until you choose to
[update](../guides/keep-up-to-date.md).

## Where to go next

- **Split it into features.** Move each tool into its own file with
  `winix scaffold feature lazygit`, which writes a feature with a part for
  every platform: [Write a cross-platform feature](../guides/cross-platform-feature.md).
- **Understand what happened**:
  [How changes are applied](../concepts/applying-changes.md).
- **Bring in what's already installed** on a Windows PC:
  [Move a Windows machine to Winix](../guides/move-a-windows-machine.md).
- **Set up your next machine** from this repository:
  [Set up a new machine](new-machine.md).
