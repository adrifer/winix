# Winix specification

This directory is the durable home for Winix's design.

## Layout

| File / directory | What it is |
|---|---|
| [`SPEC.md`](./SPEC.md) | **The spec.** What Winix is and does today. Single source of truth for behavior. |
| [`ARCHITECTURE.md`](./ARCHITECTURE.md) | How Winix is built internally: evaluator passes, fragment graph, code generation, file layout under `src/`. |
| [`proposals/`](./proposals/) | Forward-looking designs for features that are not yet implemented (e.g. the Windows backend). |

## Where to look

- **"What does Winix do?"** → [`SPEC.md`](./SPEC.md)
- **"How does Winix do it?"** → [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- **"What about Windows / future backends?"** → [`proposals/`](./proposals/)

## Editing

- Add or change user-visible behavior → edit `SPEC.md`.
- Change internals without changing behavior → edit `ARCHITECTURE.md`.
- Propose a new backend, breaking API change, or major feature → add a file
  to `proposals/` following [`proposals/README.md`](./proposals/README.md).
- Bug fixes, internal refactors, and new helpers that fit existing patterns
  don't need a spec change.

## History

This directory previously held 24 numbered specs (`01-product-requirements.md`
through `24-program-helper.md`). They were consolidated into `SPEC.md` +
`ARCHITECTURE.md` + `proposals/`. The mapping was:

| Legacy spec | Replaced by |
|---|---|
| `01-product-requirements.md` | `SPEC.md` § 1 |
| `02-glossary.md` | `SPEC.md` § 2 |
| `03-existing-dotfiles-analysis.md` | (historical context only) |
| `04-dendritic-configuration.md` | `SPEC.md` § 4 |
| `05-domain-model.md` | `SPEC.md` § 3 |
| `06-evaluation-semantics.md` | `SPEC.md` § 5 |
| `07-activation-model.md` | `SPEC.md` § 9 + `ARCHITECTURE.md` § 6 |
| `08-intermediate-representation.md` | `ARCHITECTURE.md` § 4 (in-memory IR; JSON IR was dropped with the TS-only stack) |
| `09-frontend-backend-protocol.md` | Obsolete (no IPC boundary anymore) |
| `10-tech-stack.md` | `ARCHITECTURE.md` § 1 |
| `11-typescript-frontend.md` | `SPEC.md` § 6 |
| `12-typescript-dx.md` | `SPEC.md` § 12 |
| `13-cli.md` | `SPEC.md` § 9 |
| `14-backends.md` | `ARCHITECTURE.md` § 5 |
| `15-nix-backend.md` | `ARCHITECTURE.md` § 5 |
| `16-windows-backend.md` | `proposals/windows-backend.md` |
| `17-escape-hatches.md` | `SPEC.md` § 8 |
| `18-security.md` | `SPEC.md` § 11 |
| `19-agent-dx.md` | `SPEC.md` § 12 |
| `20-curated-helpers.md` | `SPEC.md` § 7 |
| `21-conformance.md` | `ARCHITECTURE.md` § 7 (testing strategy) |
| `22-traceability-matrix.md` | (historical; the migration from the original dotfiles is done) |
| `23-roadmap.md` | GitHub Issues + Releases |
| `24-program-helper.md` | `SPEC.md` § 7 (folded into `home.program()` docs) |

The original files are still in Git history (use `git log --follow` from any
of the new docs to walk back).

## Non-goals for v1

These are stated once and apply to everything in `SPEC.md`:

- Replacing Nix evaluation or the NixOS module system.
- Matching Nix-level reproducibility on Windows.
- Providing a GUI.
- Managing remote fleets.
- Hiding all platform-specific behavior.
- Allowing TypeScript specs to mutate the system directly.
