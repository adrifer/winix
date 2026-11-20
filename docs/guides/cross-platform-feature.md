---
title: Write a cross-platform feature
description: Declare a tool once and get it on Linux, WSL, macOS and Windows.
---

# Write a cross-platform feature

A feature can declare for every platform at once. Each namespace only applies
where it makes sense, and a host ignores the rest:

| Namespace | Applies on |
|---|---|
| `home.*` | NixOS, WSL and macOS hosts (Home Manager) |
| `nixos.*` | NixOS and WSL hosts |
| `darwin.*` | macOS hosts |
| `windows.*` | Windows hosts |

So for a tool you run on several platforms, the natural unit is **one feature
per tool**. If its Nix package sits in `packages.ts` and its Windows package and
config link in `windows-shell.ts`, the tool lives in two places that drift
apart: removing it or changing its config means remembering both.

### When to split instead

- **Platform-only things** (a Windows window manager, the PowerShell profile,
  WSL interop shims, NixOS services) have nothing to pair with. Give them their
  own features.
- **Setups that barely overlap.** If the Windows and Linux halves differ in
  config format, install method and options, one feature becomes a pile of
  `platforms.*.isActive` branches. Two features read better.
- **Different host sets.** A tool you want on every Windows machine but only on
  some Linux hosts is easier as two features attached separately.

To see everything one machine gets in one place, run `winix inspect --host <name>`;
`winix inspect --matrix` shows every feature against every host.

## The pattern

From [`examples/cross-platform/features/cli/lazygit.ts`](../../examples/cross-platform/features/cli/lazygit.ts):

```ts
import { feature } from "@adrifer/winix";

export const lazygit = feature("lazygit", ({ home, windows, platforms }) => {
  // Same program, two package managers: a nixpkgs attribute and a winget id.
  home.packages("lazygit");
  windows.package("JesseDuffield.lazygit");

  // Same config file from this checkout, linked live on both sides.
  // Sources starting with ./ or ../ are relative to winix.config.ts.
  const config = home.symlink("./dotfiles/lazygit/config.yml");
  if (platforms.darwin.isActive) {
    // lazygit reads Application Support on macOS.
    home.files({ "Library/Application Support/lazygit/config.yml": config });
  } else {
    home.configFiles({ "lazygit/config.yml": config });
  }
  windows.file.symlink(windows.knownFolder.localAppData("lazygit\\config.yml"), "./dotfiles/lazygit/config.yml");
});
```

Then put it on every machine, typically through a profile:

```ts
const everywhere = profile("everywhere", [git(), lazygit()]);

host("wsl-work", platforms.wsl({ stateVersion: "25.05" }), [alice(), everywhere()]);
host("macbook", platforms.darwin({ stateVersion: 6 }), [alice(), everywhere()]);
host("DESKTOP", platforms.windows(), [everywhere(), powershellTerminal()]);
```

## Rules of thumb

- **Package names differ.** `home.packages` takes nixpkgs attributes
  ([search.nixos.org](https://search.nixos.org/packages)); `windows.package`
  takes winget ids. Find those with `winix package search lazygit`.
- **Prefer `home.program` when Home Manager has a module** for the tool
  (`home.program("git", { settings })`); it installs the package and writes the
  config. Windows has no equivalent yet, so the Windows half installs the
  package and writes or links the file itself (see
  [Share git config](share-git-config.md)).
- **One copy of each config file.** Keep it in the checkout and link it from
  both sides. `home.symlink("./…")` and `windows.file.symlink(target, "./…")`
  resolve against the directory holding `winix.config.ts`, so both point at
  the same file and edits show up everywhere without a switch.
- **Platform differences go in `platforms.*.isActive`.**
  `platforms.darwin.isActive`, `platforms.wsl.isActive`,
  `platforms.nixos.isActive` (true on WSL too) and `platforms.windows.isActive`
  are evaluated per host.
- **Order Windows resources with handles.** Every `windows.*` helper returns a
  handle; pass it to another resource's `dependsOn`. Linux needs no ordering.
- **Single-platform features are fine** when the tool only exists on one
  side, like [PowerShell and Terminal](powershell-and-terminal.md) or the WSL
  [interop shims](pair-windows-and-wsl.md#reach-windows-from-wsl).

## Check what each host gets

`winix inspect --host <name>` lists every feature once, the scopes that apply
on that host, and the scopes it skips:

```text
macbook
  platform: darwin
  composition: account:user:alice > shell > starship > git > lazygit
  ...
  git  [homeManager]  (not on this platform: windows)
    homeManager: programs
  lazygit  [homeManager]  (not on this platform: windows)
    homeManager: home
```

On the Windows host the same feature lists its Windows resources instead:

```text
  lazygit  [windows]  (not on this platform: homeManager)
    package JesseDuffield.lazygit
    link localAppData\lazygit\config.yml -> ./dotfiles/lazygit/config.yml
```

`winix check` warns when everything a feature listed on a host targets other
platforms (for example a Linux-only feature added to a Windows host). Features
that come through a shared profile, such as the example's `everywhere` role, are
expected to span platforms and don't warn.

## Group features into roles

Because each feature carries every platform, a profile of them works on any
host. The example groups features into roles (`roles/everywhere.ts`,
`roles/dev.ts`) and gives each machine its roles in `machines/`:

```ts
export const everywhere = profile("everywhere", [shell(), starship(), git(), lazygit()]);
```

The Mac and the Windows PC both use `everywhere()`; each gets its own half of
every feature.

## Start from a template

```bash
winix scaffold feature lazygit
```

writes `features/lazygit.ts` next to `winix.config.ts`, with the Home Manager
and Windows halves side by side as commented TODOs, and prints the import line
to add. It refuses to overwrite an existing file unless you pass `--force`.
