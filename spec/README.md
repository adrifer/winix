# Winix specification

This directory is the durable home for Winix's design.

## Layout

| File / directory | What it is |
|---|---|
| [`SPEC.md`](./SPEC.md) | **The spec.** What Winix is and does today. Single source of truth for behavior. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How Winix is built internally: evaluator passes, fragment graph, code generation, file layout under `src/`. |
| [`proposals/`](./proposals/) | Forward-looking designs for features that are not yet implemented (e.g. the Windows backend). |
| [`legacy/`](./legacy/) | Earlier numbered specs (`01-…` to `24-…`) kept for historical context. Superseded by `SPEC.md`. |

## Where to look

- **"What does Winix do?"** → [`SPEC.md`](./SPEC.md)
- **"How does Winix do it?"** → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **"What about Windows / future backends?"** → [`proposals/`](./proposals/)
- **"Why was X decided that way?"** → [`legacy/`](./legacy/) plus the
  relevant PR / release notes.

## Editing

- Add or change user-visible behavior → edit `SPEC.md`.
- Change internals without changing behavior → edit `ARCHITECTURE.md`.
- Propose a new backend, breaking API change, or major feature → add a file
  to `proposals/` following [`proposals/README.md`](./proposals/README.md).
- Bug fixes, internal refactors, and new helpers that fit existing patterns
  don't need a spec change.

## Non-goals for v1

These are stated once and apply to everything in `SPEC.md`:

- Replacing Nix evaluation or the NixOS module system.
- Matching Nix-level reproducibility on Windows.
- Providing a GUI.
- Managing remote fleets.
- Hiding all platform-specific behavior.
- Allowing TypeScript specs to mutate the system directly.
