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

## Recommended layout

```text
winix.config.ts
winix/
  hosts/
  users/
  roles/
  platforms/
  features/
  packages/
```

## API style

Prefer plain objects and pure functions:

```ts
export const developer = role("developer", {
  packages: [
    pkg.git({ id: "package.git" }),
    pkg.nodejs({ id: "package.nodejs", version: "22" }),
  ],
});
```

Avoid mutation-heavy builders and hidden global state.

## Safe subset

Prefer:

- explicit imports
- `export const`
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

## Example

```ts
export default workspace({
  hosts: [
    host("wsl-work", {
      extends: [platforms.nixos, roles.developer, users.adrifer],
      features: [features.wsl(), features.workSysctl()],
    }),
  ],
});
```

## Dotfile links

A common pattern is symlinking config directories from the repo into `XDG_CONFIG_HOME`. Winix provides a first-class helper:

```ts
import { dotfileLink } from "winix/sdk";

export const nvimConfig = dotfileLink({
  source: "./nvim/.config/nvim",    // relative to workspace root
  target: "~/.config/nvim",          // expands per-user
  recursive: true,
});

// Platform-conditional dotfile:
export const ghosttyConfig = dotfileLink({
  source: "./ghostty/.config/ghostty",
  target: "~/.config/ghostty",
  platforms: ["darwin"],  // only on macOS
});
```

This maps to Home Manager's `mkOutOfStoreSymlink` on Nix targets and native symlinks/junctions on Windows. The resource kind is `dotfile-link`, distinct from generic `symlink` because:

- Source is always workspace-relative (repo is source of truth).
- Target is always user-scoped (XDG or platform equivalent).
- Backend can choose the best linking strategy per platform.

