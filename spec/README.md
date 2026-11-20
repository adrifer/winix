# Winix specification

| File | What it is |
|---|---|
| [`SPEC.md`](./SPEC.md) | **The contract**: the model, merge semantics, guarantees and rules Winix keeps. Changes to these are deliberate. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How Winix is built: evaluator passes, fragment lifecycle, backends, file layout under `src/`. |
| [`proposals/`](./proposals/) | Designs for big changes before they are built. |

How to *use* each feature is documented for users in [`docs/`](../docs/) (the
reference and guides); `SPEC.md` links there rather than repeating it.

## Editing

- New or changed user-visible behavior: update the relevant `docs/` page, and
  `SPEC.md` when it changes a rule or guarantee.
- Internals without behavior changes: `ARCHITECTURE.md`.
- A new backend, a breaking API change or a major feature: a proposal first
  ([`proposals/README.md`](./proposals/README.md)).
- Bug fixes, refactors and helpers that fit existing patterns need no spec
  change.

## Non-goals

- Replacing Nix evaluation or the NixOS module system.
- Matching Nix-level reproducibility on Windows.
- Providing a GUI.
- Managing remote fleets.
- Hiding all platform-specific behavior.
- Allowing TypeScript configs to mutate the system directly.
