---
title: Organising a config
description: Machines, roles and features - a layout that keeps "what does each machine get?" easy to answer as a config grows.
sidebar:
  order: 2
---

# Organising a config

`winix init` starts with one file, and a small config can stay that way. Once
you have a few machines and operating systems, this layout keeps every question
answerable by opening one file:

```text
winix.config.ts     inputs + the list of machines
machines/           one file per computer: its roles and anything only it needs
                    (a Windows PC and its WSL distro are one machine, two hosts)
roles/              profiles for kinds of machines (everywhere, dev, work...),
                    spanning operating systems
features/           one file per tool, declaring every OS it supports
dotfiles/           the config files those features link
```

| Question | Where to look |
|---|---|
| What does this machine get? | `machines/<machine>.ts` |
| What does every dev machine get? | `roles/dev.ts` |
| How is lazygit set up, anywhere? | `features/lazygit.ts` |

[`examples/cross-platform`](../../examples/cross-platform) is a small, runnable
config in this layout, with a Windows PC, its NixOS-WSL distro and a Mac. The
guides quote it.

## Features: one file per tool

A feature declares its tool for every platform it runs on, so adding, changing
or removing a tool happens in one place:

```ts
// features/cli/lazygit.ts
export const lazygit = feature("lazygit", ({ home, windows }) => {
  home.packages("lazygit");
  windows.package("JesseDuffield.lazygit");
  home.configFiles({ "lazygit/config.yml": home.symlink("./dotfiles/lazygit/config.yml") });
  windows.file.symlink(windows.knownFolder.localAppData("lazygit\\config.yml"), "./dotfiles/lazygit/config.yml");
});
```

When to split a tool into per-platform features instead:
[Write a cross-platform feature](../guides/cross-platform-feature.md#when-to-split-instead).

## Roles: kinds of machines

A role is a profile of features that belong together on a kind of machine. A
role isn't tied to an operating system: each host takes its own half of every
feature in it.

```ts
// roles/everywhere.ts: every machine, on every OS
export const everywhere = profile("everywhere", [shell(), starship(), git(), lazygit()]);

// roles/dev.ts: machines I develop on
export const dev = profile("dev", [node()]);

// roles/windows-desktop.ts: a role can be single-OS too
export const windowsDesktop = profile("windows-desktop", [windowsTerminal()]);
```

## Machines: one file per computer

A machine file lists its roles, plus whatever only that machine needs. A
Windows PC and the distro in its WSL are one machine with two hosts, so they
live together:

```ts
// machines/desktop.ts
const linux = host("wsl-work", platforms.wsl({ stateVersion: "25.05" }), [
  alice(), everywhere(), dev(), windowsInterop(),
]);

const windows = host("DESKTOP", platforms.windows(), [
  everywhere(), dev(), windowsDesktop(), nixosWsl(linux),
]);

export const desktop = [windows, linux];
```

`winix.config.ts` then only holds the inputs and the machines:

```ts
export default workspace({ inputs, hosts: [...desktop, macbook] });
```

## Seeing the result

`winix inspect --matrix` prints every feature against every host, grouped by
the role it comes through:

```text
                      DESKTOP  wsl-work  macbook
everywhere
  shell                  ●        ●         ●
  starship               ●        ●         ●
  git                    ●        ●         ●
  lazygit                ●        ●         ●
dev
  node                   ●        ●
windows-desktop
  windows-terminal       ●
listed on the host
  nixos-wsl              ●
  account:user:alice              ●         ●
  windows-interop                 ●

● applies   · included, nothing for this platform   (blank) not included
```

`winix inspect --host <name>` goes one level deeper: what each feature declares
on that host, and which of its parts it skips.

`winix check` warns when a feature listed directly on a host does nothing there,
such as a Linux-only feature added to a Windows host: usually a mistake. Features
that arrive through a role are expected to span platforms, so they don't warn.
