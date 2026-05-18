# Spec 24 — Generic `program()` Helper

## Overview

A generic helper that wraps any Home Manager or NixOS program/service into a fragment
without requiring a dedicated named helper. Sits between the curated helpers (spec 20)
and raw fragment objects in the abstraction ladder:

1. **Curated helpers** (`git()`, `zsh()`) — max ergonomics, limited scope
2. **`program()`** — generic, any program, still cleaner than raw fragments
3. **Raw fragments** — full control, verbose

## API

```ts
function program(name: string, opts?: Record<string, unknown>): Fragment;
function program<T>(name: string, opts?: T): Fragment;
```

### Basic Usage

```ts
import { program } from "winix";

// Home Manager program (default scope)
program("starship", { enable: true })
// → { home: { programs: { starship: { enable: true } } } }

program("tmux", {
  enable: true,
  terminal: "tmux-256color",
  keyMode: "vi",
  plugins: ["tmux-sensible", "tmux-yank"],
})
// → { home: { programs: { tmux: { enable: true, terminal: ..., ... } } } }

// NixOS service
program.service("openssh", { enable: true, settings: { PermitRootLogin: "no" } })
// → { nixos: { services: { openssh: { enable: true, settings: { ... } } } } }

// NixOS program
program.nixos("nix", { settings: { "experimental-features": "nix-command flakes" } })
// → { nixos: { nix: { settings: { ... } } } }
```

## Scope Variants

| Function | Target path | Use case |
|----------|-------------|----------|
| `program(name, opts)` | `home.programs.<name>` | Home Manager programs (default) |
| `program.service(name, opts)` | `nixos.services.<name>` | NixOS services |
| `program.nixos(name, opts)` | `nixos.<name>` | Top-level NixOS options (nix, networking, etc.) |
| `program.darwin(name, opts)` | `darwin.<name>` | Top-level nix-darwin options |
| `program.homeService(name, opts)` | `home.services.<name>` | Home Manager services |

## Design Decisions

### Why not just raw fragments?

Compare:
```ts
// Raw fragment (37 chars of nesting boilerplate)
{ home: { programs: { starship: { enable: true } } } }

// program() (immediately clear what it does)
program("starship", { enable: true })
```

The value increases with deeper nesting:
```ts
// Raw
{ nixos: { services: { openssh: { enable: true, settings: { PermitRootLogin: "no" } } } } }

// program.service()
program.service("openssh", { enable: true, settings: { PermitRootLogin: "no" } })
```

### `enable: true` is NOT implicit

Many Nix programs require `enable = true`, but not all options objects need it.
The helper does NOT auto-inject `enable: true` — users write it explicitly.
This keeps the mapping 1:1 with Nix and avoids surprises.

### Options are pass-through

The `opts` object is placed directly at the target path without transformation.
No camelCase mapping, no key renaming. What you write is what you get.
This makes it predictable and debuggable.

Future: when generated types land (P2), `program<ZshOptions>("zsh", { ... })`
gives full autocomplete without any runtime cost.

## Type Parameter (Future)

```ts
// Without types (works today)
program("tmux", { enable: true, keyMode: "vi" })

// With generated types (P2, future)
import type { TmuxOptions } from "winix/types";
program<TmuxOptions>("tmux", { enable: true, keyMode: "vi" })
// ^ full autocomplete + type checking
```

The type parameter is optional and doesn't change runtime behavior.
It's purely for DX when types are available.

## Implementation

### File: `src/helpers/program.ts`

```ts
import type { Fragment } from "../core/types.ts";

export interface ProgramHelper {
  (name: string, opts?: Record<string, unknown>): Fragment;
  service(name: string, opts?: Record<string, unknown>): Fragment;
  nixos(name: string, opts?: Record<string, unknown>): Fragment;
  darwin(name: string, opts?: Record<string, unknown>): Fragment;
  homeService(name: string, opts?: Record<string, unknown>): Fragment;
}

export const program: ProgramHelper = Object.assign(
  (name: string, opts: Record<string, unknown> = {}): Fragment => ({
    home: { programs: { [name]: opts } },
  }),
  {
    service: (name: string, opts: Record<string, unknown> = {}): Fragment => ({
      nixos: { services: { [name]: opts } },
    }),
    nixos: (name: string, opts: Record<string, unknown> = {}): Fragment => ({
      nixos: { [name]: opts },
    }),
    darwin: (name: string, opts: Record<string, unknown> = {}): Fragment => ({
      darwin: { [name]: opts },
    }),
    homeService: (name: string, opts: Record<string, unknown> = {}): Fragment => ({
      home: { services: { [name]: opts } },
    }),
  }
);
```

### Export from `src/helpers/index.ts` and `src/index.ts`

Add `program` to the public API exports.

## Testing

`tests/helpers.test.ts` (append to existing):

1. `program("starship", { enable: true })` → correct fragment shape
2. `program.service("openssh", { ... })` → nixos.services path
3. `program.nixos("nix", { ... })` → nixos top-level
4. `program.darwin("homebrew", { ... })` → darwin top-level
5. `program.homeService("syncthing", { ... })` → home.services path
6. Composition test: `program()` + curated helper in same host, verify Nix output
7. Empty opts: `program("foo")` → `{ home: { programs: { foo: {} } } }`

## Migration of Examples

After implementing, optionally update `examples/reference/features/` to show
`program()` for simpler cases like starship, fzf, zoxide:

```ts
// Before
export const starship = feature("starship", () => ({
  home: { programs: { starship: { enable: true } } },
}));

// After
export const starship = feature("starship", () => program("starship", { enable: true }));
```

## Non-Goals

- Auto-injecting `enable: true`
- camelCase → kebab-case transformation (separate spec)
- Type generation (P2, separate spec)
- Validation of option names against nixpkgs schema
