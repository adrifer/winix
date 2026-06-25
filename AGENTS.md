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
- **Core npm workflows must stay shell-independent.** `npm run check`, `npm test`, `npm run build`, and `npm run clean` should work from PowerShell/cmd, WSL, Linux, and macOS. Use Node scripts instead of shell-specific commands like `rm -rf`, `cp`, or `mkdir -p`.

## Windows/WSL Compatibility

Winix development is supported from native Windows and WSL, even before the native Windows backend is implemented.

- **Separate filesystem paths from generated Nix paths.**
  - Use `node:path` for real filesystem paths (`.winix/out`, copying raw modules, loading configs).
  - Use `node:path.posix` or explicit POSIX formatting for generated Nix paths (`./hosts/foo.nix`, `../raw-modules/foo.nix`).
  - Never let Windows backslashes leak into generated Nix files or Nix flake refs.
- **CLI behavior on native Windows:**
  - `winix check` and `winix apply --dry` should work.
  - `winix switch --dry` should print the command without `sudo` and with forward-slash flake refs (`path:D:/repo/...#host`).
  - Real `winix switch` should fail clearly until native Windows activation exists.
  - Real `winix update` should fail clearly because it requires the Nix CLI; users should run it from WSL, Linux, or macOS.
- **CLI behavior on WSL/Linux/macOS:**
  - `winix switch --dry` should keep POSIX paths (`path:/home/...#host`) and prefix `sudo` when not root.
  - NixOS and nix-darwin activation commands should remain unchanged outside native Windows.
- **When adding commands or backend output, test both path surfaces.**
  - Windows filesystem paths may contain `\`, drive letters, and spaces.
  - Nix paths and flake refs should use `/`.

## API Shape Rules

Use these rules when adding or reviewing Winix SDK helpers:

1. **Mirror the parent Nix namespace by default.** If a Nix option is pure config passthrough under `networking.*`, `boot.*`, `security.*`, etc., prefer one parent helper with an object: `nixos.networking({ firewall, nat })`, `nixos.boot({ loader, initrd })`, `nixos.security({ pam, sudo })`.
2. **Avoid root-level aliases for nested options.** Do not add helpers like `nixos.firewall()`, `nixos.networkmanager()`, or `nixos.nat()` unless the helper represents a major Winix concept rather than a shortcut to a nested Nix path.
3. **Use named helpers for keyed collections or awkward workflows.** Options like systemd units, launchd agents, Home Manager files, and OCI containers are keyed by name and verbose as raw objects, so helpers are justified.
4. **Put keyed helpers under the owning namespace when possible.** Prefer `nixos.systemd.service()`, `darwin.launchd.agent()`, and `nixos.virtualisation.ociContainer()` over unrelated root helpers.
5. **Keep justified ergonomic exceptions explicit.** Helpers like `nixos.sysctl()` are acceptable when the concept is commonly discussed independently from its Nix path (`boot.kernel.sysctl`), but document them as exceptions.

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

When touching CLI paths, activation, output layout, or npm scripts, also verify from native Windows and WSL when possible:

```bash
npm run check
npm test -- --run
npm run build
cd test-config
node --experimental-transform-types --no-warnings ../src/cli/index.ts check
node --experimental-transform-types --no-warnings ../src/cli/index.ts apply --dry
node --experimental-transform-types --no-warnings ../src/cli/index.ts switch --dry
```

## Spec

Design lives in `spec/`:
- `spec/SPEC.md` — Single source of truth for what Winix is and does (product, model, evaluation, API, CLI, escape hatches, security, agent DX).
- `spec/ARCHITECTURE.md` — Internals: evaluator passes, fragment graph, Nix code generation, file layout under `src/`.
- `spec/proposals/` — Forward-looking designs (e.g. Windows backend) that are not yet implemented.

## Current State

Working end-to-end: config → eval → Nix output → `nixos-rebuild test` successful.
See `ROADMAP.md` for what's done and what's next (prioritized).

## Don'ts

- Don't add classes or inheritance. Fragments are plain objects from plain functions.
- Don't add global registries. Fragment discovery is by import, not registration.
- Don't auto-convert camelCase to kebab-case for Nix option keys. Users write the actual Nix key name.
- Don't add runtime dependencies unless absolutely necessary.
