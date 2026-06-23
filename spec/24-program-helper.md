# Spec 24 — Home Manager Program Helpers

## Overview

Home Manager programs and services are configured through the `home` namespace.
This replaces the older generic `program()` helper family.

## API

```ts
home.program(name: string, opts?: Record<string, unknown>): Fragment;
home.program<T>(name: string, opts?: T): Fragment;

home.service(name: string, opts?: Record<string, unknown>): Fragment;
home.service<T>(name: string, opts?: T): Fragment;
```

## Basic Usage

```ts
import { feature, home } from "@adrifer/winix";

export const starship = feature("starship", () =>
  home.program("starship")
);
// -> { homeManager: { programs: { starship: { enable: true } } } }

export const fzf = feature("fzf", () =>
  home.program("fzf", { enableZshIntegration: true })
);
// -> { homeManager: { programs: { fzf: { enable: true, enableZshIntegration: true } } } }

export const syncthing = feature("syncthing", () =>
  home.service("syncthing", { tray: true })
);
// -> { homeManager: { services: { syncthing: { enable: true, tray: true } } } }
```

`enable` is injected by default and can be explicitly overridden:

```ts
home.program("git", { enable: false })
// -> { homeManager: { programs: { git: { enable: false } } } }
```

## Scope Rules

| Function | Target path | Behavior |
|----------|-------------|----------|
| `home.program(name, opts)` | `homeManager.programs.<name>` | Adds `enable: true` by default |
| `home.service(name, opts)` | `homeManager.services.<name>` | Adds `enable: true` by default |

NixOS services use `nixos.service()`. Top-level NixOS and nix-darwin options can
use `nixos.raw()` / `darwin.raw()` or plain fragments:

```ts
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })

{ nixos: { nix: { settings: { "experimental-features": "nix-command flakes" } } } }
{ darwin: { homebrew: { enable: true } } }
```

## Removed Helpers

The following helpers are removed from the public API:

- `program()`
- `program.service()`
- `program.nixos()`
- `program.darwin()`
- `program.homeService()`
- `programs.enable()`

## Design Decisions

### Namespace-first API

`home.program("git")` clearly communicates both scope and target. The old
`program("git")` name hid that it wrote to Home Manager, and `program.nixos()`
was misleading because it wrote arbitrary top-level NixOS options.

### Auto-enable by default

Home Manager programs and services almost always need `enable = true`, so the
helper injects it by default while preserving explicit override behavior.

### Options are pass-through

The options object is merged directly into the target option set after
`enable: true`. No option keys are renamed.

## Testing

`tests/helpers.test.ts` covers:

1. `home.program("starship")` -> enabled Home Manager program
2. `home.program("zsh", { enable: false })` -> explicit override wins
3. `home.service("syncthing")` -> enabled Home Manager service
4. Composition through `profile()` and generated Nix output
