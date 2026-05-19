# API Cleanup Plan — Helpers Consolidation

## Problem

We have too many ways to do the same thing:

| What you want | Current options | Problem |
|---------------|----------------|---------|
| HM program with enable | `git(opts)`, `zsh(opts)`, `program("git", opts)` + manual enable, `programs.enable("git", opts)` | 3-4 ways, confusing |
| NixOS service with enable | `program.service("X", opts)` + manual enable, `services.enable("X", opts)` | 2 ways |
| HM program without enable | `program("X", opts)` | Fine, but when would you want this? |

A new user asks: "How do I add git?" and the answer shouldn't be "well, there are 4 options..."

## Decision: Namespace-first API

Follow the new DX pattern established in PR #21: everything under clear namespaces.

### Final API (what we keep):

```ts
// Home Manager programs — the ONE way
home.program("git", { ... })        // auto enable: true
home.program("fzf", { enableZshIntegration: true })
home.program("git", { enable: false, ... })  // explicit override

// Home Manager services
home.service("syncthing", { ... })  // auto enable: true

// Home Manager other
home.packages("pkg1", "pkg2")
home.env({ EDITOR: "nvim" })
home.path("/usr/local/bin", "~/.local/bin")
home.configFile("nvim", { source: ... })

// NixOS services — already good
services.enable("openssh", { ... })

// NixOS other
packages("pkg1", "pkg2")            // system packages
sysctl({ ... })
firewall.tcp(8080)

// Nix expressions
nix.pkg("neovim")
nix.str`...`
nix.script`...`
nix.lib.mkDefault(...)

// Composition
platforms.nixos({ ... })
platforms.darwin({ ... })
account("username", { ... })
profile("name", [...])
feature("name", () => ...)
```

### What to remove:

| Helper | Replacement | Action |
|--------|-------------|--------|
| `program("X", opts)` | `home.program("X", opts)` | Remove |
| `program.service("X", opts)` | `services.enable("X", opts)` | Remove |
| `program.nixos("X", opts)` | Inline `{ nixos: { X: opts } }` | Remove (rare use case) |
| `program.darwin("X", opts)` | Inline `{ darwin: { X: opts } }` | Remove (rare use case) |
| `program.homeService("X", opts)` | `home.service("X", opts)` | Remove |
| `programs.enable("X", opts)` | `home.program("X", opts)` | Remove |
| `git(opts)` | `home.program("git", opts)` | Remove (no added value) |
| `zsh(opts)` | Keep IF it adds real defaults | Evaluate |
| `user(name, opts)` | `account(name, opts)` | Remove |
| `shell(opts)` | `home.env()` + `home.path()` | Remove |

### Curated helpers — keep only if they add real value:

**Keep `zsh(opts)`** — has opinionated defaults:
- `autosuggestions: true` by default
- `completion: true` by default  
- `syntaxHighlighting: true` by default
- Plugin name → HM plugin object mapping

**Remove `git(opts)`** — doesn't add value over `home.program("git", { ... })`:
- The "shortcuts" (userName, difftool) are rarely used because real configs have complex settings anyway
- No defaults beyond `enable: true`

### `home.program()` implementation:

```ts
// In src/helpers/home.ts
program(name: string, opts: Record<string, unknown> = {}): Fragment {
  return {
    homeManager: {
      programs: {
        [name]: { enable: true, ...opts },
      },
    },
  };
}
```

Override `enable` by passing it explicitly:
```ts
home.program("git", { enable: false })  // → { enable: false }
```

### Migration path:

1. Add `home.program()` and `home.service()` to the `home` namespace
2. Update dotfiles to use new API
3. Remove old helpers and exports
4. Use plain fragments for former `program.nixos()` and `program.darwin()` cases

## Before/After for dotfiles:

```ts
// Before
import { feature, git as gitProgram, programs } from "winix";

export const fzf = feature("fzf", () =>
  programs.enable("fzf", { enableZshIntegration: true })
);

export const git = feature("git", () =>
  gitProgram({ settings: { ... }, includes: [...] })
);

// After
import { feature, home } from "winix";

export const fzf = feature("fzf", () =>
  home.program("fzf", { enableZshIntegration: true })
);

export const git = feature("git", () =>
  home.program("git", { settings: { ... }, includes: [...] })
);
```

Consistent, one import (`home`), one pattern.

## Decisions:

1. `home.program()` emits under `homeManager.programs`.
2. The generic `program()` family is removed.
3. `zsh()` stays as a curated helper because it adds defaults and plugin mapping.
