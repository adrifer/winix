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

Fragment return types use a phased approach:

**Phase 1 (v1 launch):** Ship typed interfaces for the top ~20 NixOS/Home Manager options in active use (git, zsh, programs.*, packages, boot.kernel, services.*, wsl.*). Hand-written, tested, good JSDoc. Fragment output is generic:

```ts
function feature<T extends NixosOptions>(config: { nixos?: T; home?: HomeOptions }): Fragment;
```

This gives autocomplete for `home: { programs: { git: { |` immediately.

**Phase 2:** `winix types generate` CLI command that reads the current NixOS/HM option tree (via `nixos-option --json`) and generates/updates type definitions. Run once after updating inputs, like `prisma generate`.

**Phase 3:** Auto-generation integrated into the build pipeline. Full option coverage.

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

