# TypeScript frontend

The TypeScript frontend is the user-facing language for Winix system specs.

## Design goals

- Declarative by default.
- Pure and deterministic.
- Strongly typed.
- Easy to split into small files.
- Friendly to IDEs and agents.
- Able to express dendritic composition.
- Able to produce normalized IR without system mutation.
- Trivially extensible by third parties.
- LLM/agent-friendly: flat structure, consistent patterns, discoverable.

## Recommended layout

```text
winix.config.ts
winix/
  hosts/
  fragments/
  packages/
```

## Core concept: Fragments

The fundamental building block is the **fragment**: a pure function that returns configuration data. Everything in Winix is a fragment: platforms, users, roles, features, packages, services. There is no structural distinction between them at the API level.

A fragment is any function with the signature:

```ts
(...args) => Fragment | Fragment[]
```

A host is simply a name plus a flat list of fragments:

```ts
host("wsl-work", [
  nixos(),
  user("adrifer"),
  wsl(),
  workSysctl(),
  packages(["socat", "bubblewrap"]),
]);
```

The compiler resolves where each fragment's data belongs (NixOS config, Home Manager, boot, etc.) based on the fragment's return value. Users never need to think about nesting depth or option paths.

## API style

Prefer flat fragment composition:

```ts
host("wsl-work", [
  nixos(),
  user("adrifer"),
  wsl({ defaultUser: "adrifer" }),
  sysctl({ "fs.inotify.max_user_watches": 1048576 }),
  nixLd({ libraries: ["icu", "zlib", "openssl"] }),
  packages(["wl-clipboard", "socat"]),
  homePackages(["wslu"]),
  git.credentialHelper("git-credential-manager-windows"),
]);
```

Avoid mutation-heavy builders and hidden global state.

## Fragment anatomy

A fragment function returns a `Fragment` object describing its contribution:

```ts
import { type Fragment } from "winix";

export function sysctl(values: Record<string, number | string>): Fragment {
  return {
    nixos: {
      boot: { kernel: { sysctl: values } },
    },
  };
}
```

Fragments may target different scopes:

```ts
export function wsl(opts?: WslOpts): Fragment {
  return {
    nixos: {
      wsl: { enable: true, ...opts },
      packages: ["wl-clipboard"],
      programs: { nixLd: { enable: true } },
    },
    home: {
      packages: ["wslu"],
      shell: { env: { BROWSER: "wslview" } },
    },
  };
}
```

## Composite fragments

A fragment may return an array of other fragments for composition:

```ts
export function devServer(): Fragment[] {
  return [
    docker(),
    postgres({ port: 5432 }),
    redis(),
    caddy({ reverseProxy: "localhost:3000" }),
  ];
}
```

This replaces the previous `extends` and `roles` concepts. A "role" is just a composite fragment:

```ts
export function developer(): Fragment[] {
  return [
    packages(["git", "nodejs", "ripgrep"]),
    neovim(),
    starship(),
    fzf(),
    zoxide(),
  ];
}
```

## Platform conditionals

Fragments may need platform-specific behavior. Use `when()` to conditionally include configuration based on the host's platform:

```ts
import { when, Platform } from "winix";

export function zsh(): Fragment[] {
  return [
    // Shared across all platforms
    {
      home: {
        programs: {
          zsh: {
            enable: true,
            aliases: { ls: "eza -lh", g: "lazygit", n: "nvim" },
          },
        },
      },
    },

    // Only included on Linux/NixOS hosts
    when(Platform.linux, {
      home: {
        programs: {
          zsh: {
            aliases: {
              i: "sudo nixos-rebuild switch --flake /etc/nixos",
              gc: "sudo nix-collect-garbage -d",
            },
          },
        },
      },
    }),

    // Only included on macOS/darwin hosts
    when(Platform.darwin, {
      home: {
        programs: {
          zsh: {
            aliases: {
              i: "sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
              gc: "nix-collect-garbage -d",
            },
          },
        },
      },
    }),
  ];
}
```

`when()` is evaluated statically at compile time (the compiler knows each host's platform). The conditional fragment is either included in the merge or skipped entirely.

Multiple conditions can be combined:

```ts
// Include only on WSL hosts (platform + feature check)
when([Platform.linux, Feature.wsl], {
  home: { shell: { env: { BROWSER: "wslview" } } },
})

// Negation
when(not(Platform.darwin), {
  nixos: { packages: ["wl-clipboard"] },
})
```

`when()` returns a `Fragment` — it composes like everything else in the host list.

## Workspace and inputs

Inputs (flake dependencies) are declared in a dedicated leaf file to avoid circular imports:

```ts
// inputs.ts (leaf node — imports nothing from the project)
import { defineInputs, input } from "winix";

export const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});
```

`defineInputs` returns a typed object. Fragments that need to reference an input import from this file:

```ts
// fragments/wsl.ts
import { inputs } from "../inputs";

export function wsl(): Fragment {
  return {
    nixos: { imports: [inputs.nixosWsl] },  // typed, autocomplete, refactor-safe
  };
}
```

The workspace config imports both:

```ts
// winix.config.ts
import { workspace, host } from "winix";
import { inputs } from "./inputs";
import { wsl } from "./fragments/wsl";

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", [
      nixos(),
      wsl({ defaultUser: "adrifer" }),
    ]),
  ],
});
```

Simple inputs are a URL string. Inputs with `follows` or other options use the `input()` helper. The separation into a leaf file prevents circular imports (fragments import inputs, workspace imports both, but inputs imports nothing from the project).

## Third-party extensibility

Creating a third-party fragment requires no plugin system, hooks, or registration:

```ts
// npm: winix-fragment-tailscale
import { type Fragment } from "winix";

export function tailscale(opts?: { exitNode?: boolean }): Fragment {
  return {
    nixos: { services: { tailscale: { enable: true, ...opts } } },
  };
}
```

Usage:

```ts
import { tailscale } from "winix-fragment-tailscale";

host("server", [
  nixos(),
  tailscale({ exitNode: true }),
]);
```

The contract is just: export a function that returns `Fragment | Fragment[]`. No base classes, no interfaces to implement, no lifecycle hooks.

## Fragment metadata

Fragments may include metadata for discoverability and agent DX:

```ts
/**
 * @description Enable WSL integration with NixOS-WSL module
 * @example wsl({ defaultUser: "adrifer" })
 * @category platform
 */
export function wsl(opts?: WslOpts): Fragment { ... }
```

A fragment registry file can be auto-generated for agent consumption:

```ts
// fragments.registry.ts (autogenerated)
export const FRAGMENTS = {
  wsl: { description: "WSL support", params: ["defaultUser?"], category: "platform" },
  sysctl: { description: "Kernel sysctl tuning", params: ["Record<string, number>"], category: "system" },
  docker: { description: "Docker/OCI runtime", params: ["storageDriver?"], category: "service" },
};
```

## Safe subset

Prefer:

- explicit imports
- `export const` / `export function`
- plain objects
- arrays
- pure functions
- simple conditionals
- local constants

Discourage:

- network calls during evaluation
- arbitrary filesystem reads
- global mutable state
- decorators
- reflection-heavy APIs
- proxies
- dynamic imports for core config
- time-dependent values

## Typing strategy (v1 requirement)

Autocomplete-while-typing is non-negotiable for v1 DX.

### Type generation from inputs

Types are derived from **declared inputs**, not from user configuration files. A user starting from scratch gets full autocomplete immediately because the options come from the inputs (nixpkgs, home-manager, etc.), which are published packages with self-documented option trees.

```bash
# After winix init or after changing inputs:
winix types generate

# What it does:
# 1. Reads inputs.ts → knows which flake inputs you have
# 2. For each input, extracts its declared NixOS/HM options
# 3. Merges into a unified type tree
# 4. Writes generated/nixos.d.ts + generated/home-manager.d.ts
```

Adding a new input (e.g., `nixos-wsl`) makes its options (`wsl.enable`, `wsl.defaultUser`, etc.) appear in types after the next `winix types generate`.

### Nix type to TypeScript mapping

| Nix type | TypeScript |
|----------|------------|
| `bool` | `boolean` |
| `str` | `string` |
| `int` | `number` |
| `listOf str` | `string[]` |
| `attrsOf str` | `Record<string, string>` |
| `nullOr str` | `string \| null` |
| `enum ["a" "b"]` | `"a" \| "b"` |
| `submodule { ... }` | nested interface |

### Generated output

```ts
// generated/nixos.d.ts (auto-generated, do not edit)
export interface NixosOptions {
  boot?: {
    kernel?: {
      sysctl?: Record<string, string | number | boolean>;
    };
  };
  programs?: {
    git?: { enable?: boolean; settings?: Record<string, unknown> };
    nixLd?: { enable?: boolean; libraries?: string[] };
  };
  services?: {
    tailscale?: { enable?: boolean; extraUpFlags?: string[] };
  };
  wsl?: {
    enable?: boolean;
    defaultUser?: string;
  };
}
```

The `Fragment` type references generated types:

```ts
import type { NixosOptions } from "./generated/nixos";
import type { HomeOptions } from "./generated/home-manager";

interface Fragment {
  nixos?: NixosOptions;
  home?: HomeOptions;
  darwin?: DarwinOptions;
}
```

### Automation

Type generation can be triggered automatically:

- `prepare` script in package.json (runs on install)
- LSP/IDE plugin detects `inputs.ts` changes and regenerates
- `winix init` runs it as part of project scaffolding

### Scope control

```bash
# Generate types only for options used in current fragments (smaller output)
winix types generate --scope used

# Generate full option tree (all available NixOS + HM options)
winix types generate --scope full

# Add types for a specific module on demand
winix types generate --add services.tailscale
```

### Phased delivery

**Phase 1 (v1 launch):** Ship hand-written typed interfaces for the top ~20 options in active use as a fallback/baseline. Run `winix types generate` to get full coverage from inputs.

**Phase 2:** Fully automated. `winix types generate` is the primary source. Hand-written types serve only as overrides for better JSDoc or narrower types.

The compiler validates all fragment output against the actual NixOS/HM module system at generation time, regardless of TypeScript type coverage. Types are for DX (autocomplete, error squiggles); the compiler is the source of truth.

## Dotfile links

Dotfile linking is expressed as a fragment:

```ts
import { dotfiles } from "winix";

host("wsl-work", [
  nixos(),
  dotfiles({
    "./nvim/.config/nvim": "~/.config/nvim",
    "./ghostty/.config/ghostty": "~/.config/ghostty",
  }),
]);
```

Or as individual link fragments for conditional use:

```ts
import { dotfileLink } from "winix";

export function nvimConfig(): Fragment {
  return dotfileLink({
    source: "./nvim/.config/nvim",
    target: "~/.config/nvim",
    recursive: true,
  });
}
```

This maps to Home Manager's `mkOutOfStoreSymlink` on Nix targets and native symlinks/junctions on Windows. The resource kind is `dotfile-link`, distinct from generic `symlink` because:

- Source is always workspace-relative (repo is source of truth).
- Target is always user-scoped (XDG or platform equivalent).
- Backend can choose the best linking strategy per platform.

