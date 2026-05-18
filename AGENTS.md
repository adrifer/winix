# AGENTS.md — Winix

Instructions for AI coding agents (Copilot, Claude Code, Cursor, etc.) working on Winix.

## Project Overview

Winix is a TypeScript-first system configuration tool that generates Nix (NixOS, nix-darwin, Home Manager) from composable TypeScript fragments.

**Pipeline:** `winix.config.ts` → Evaluator (two-pass) → Nix backend → `.winix/out/flake.nix` + host modules

## Architecture

```
src/
  core/types.ts          # All type definitions. Start here.
  sdk/index.ts           # User-facing API: platform(), feature(), host(), workspace()
  evaluator/index.ts     # Two-pass: collect IDs → resolve with context → deep merge
  backends/nix/index.ts  # Generates flake.nix + host .nix modules
  cli/
    index.ts             # CLI entry point (parseArgs)
    loader.ts            # Finds and imports winix.config.ts
    commands/apply.ts    # winix apply
    commands/check.ts    # winix check
```

## Key Concepts

### Fragment Pattern
Everything is a `Fragment | Fragment[]`. No inheritance, no classes. Just functions returning data.

### Three Helpers
- `platform(id, factory)` — system base (NixOS, darwin). Only one per host. Has `.isActive`.
- `feature(id, factory)` — everything else. N per host. Has `.isActive`.
- `host(name, platform, fragments[])` — top-level target. No `.isActive`.

### Lazy Evaluation
`platform()` and `feature()` return `LazyFragment` descriptors (not resolved fragments). The evaluator:
1. **Pass 1:** Scans descriptors to collect IDs + resolve composites recursively to find nested IDs.
2. **Pass 2:** Sets implicit context (`_ctx`), then calls `__resolve()` on each lazy fragment. `.isActive` getters read from this context.
3. **Pass 3:** Deep merges all resolved fragments (arrays append, objects merge, scalars last-wins).

### Implicit Context
`.isActive` uses a module-level `_ctx` variable (like React hooks). Set by the evaluator before resolving fragments. `withContext()` is the testing escape hatch.

## Conventions

- **All TypeScript, no Rust.** Single language stack.
- **ESM modules** with `.ts` extensions in imports (Node `--experimental-transform-types`).
- **Vitest** for tests. Run `npx vitest run`.
- **No build step** for development. Source runs directly via Node.
- **Fragment keys match Nix option names.** Use `"experimental-features"` not `experimentalFeatures`. The backend does NOT auto-convert camelCase to kebab-case for option keys.
- **Input names** use camelCase in TS (`nixosWsl`), auto-converted to kebab-case for Nix (`nixos-wsl`).

## How to Add a Feature

1. If it's a new SDK helper or type: edit `src/core/types.ts` + `src/sdk/index.ts`.
2. If it's evaluator logic: edit `src/evaluator/index.ts`. Add a test.
3. If it's Nix output: edit `src/backends/nix/index.ts`. Check with `--dry` on test-config.
4. If it's a CLI command: add to `src/cli/commands/` and register in `src/cli/index.ts`.
5. Update `ROADMAP.md` when completing tasks.
6. Update `test-config/winix.config.ts` if the change affects output.

## Testing

```bash
npx vitest run                    # Unit tests
cd test-config && node --experimental-transform-types ../src/cli/index.ts apply --dry   # Integration
```

## Spec

Design specs live in `spec/`. Key ones:
- `spec/11-typescript-frontend.md` — Fragment pattern, helpers, inputs, conditionals, types
- `spec/06-evaluation-semantics.md` — Merge rules, conflict detection
- `spec/13-cli.md` — CLI commands
- `spec/15-nix-backend.md` — Nix code generation
- `spec/17-escape-hatches.md` — raw(), rawModule(), escape()

## Current State

Working end-to-end: config → eval → Nix output → `nixos-rebuild test` successful.
See `ROADMAP.md` for what's done and what's next (prioritized).

## Don'ts

- Don't add classes or inheritance. Fragments are plain objects from plain functions.
- Don't add global registries. Fragment discovery is by import, not registration.
- Don't auto-convert camelCase to kebab-case for Nix option keys. Users write the actual Nix key name.
- Don't add runtime dependencies unless absolutely necessary.
