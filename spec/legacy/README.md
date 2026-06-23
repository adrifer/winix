# Legacy specs

These numbered specs are **archived**. The behavior they describe is now
covered by [`../SPEC.md`](../SPEC.md) (the living spec) and
[`../ARCHITECTURE.md`](../ARCHITECTURE.md) (internals).

They're kept here for historical context: design rationale, earlier
trade-offs, and traceability for migrations from the original dotfiles.

## What changed

The new structure (`SPEC.md` + `ARCHITECTURE.md` + `proposals/`) replaces the
24-document numbered series. Highlights:

- **Single spec.** `SPEC.md` consolidates product, model, evaluation,
  authoring API, CLI, escape hatches, security, and agent DX.
- **Tech stack updated.** The legacy specs predate the move to pure
  TypeScript; references to a Rust CLI, IR JSON over stdout, and a
  frontend/backend subprocess protocol are obsolete. See `ARCHITECTURE.md`.
- **Windows backend moved to `proposals/`.** It's a v1.5/v2 design, not
  current behavior. See `proposals/windows-backend.md`.
- **Roadmap removed.** GitHub Issues + Releases track work now.

## Mapping

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

## Do not extend

New design work goes in `proposals/`. New behavior gets documented in
`SPEC.md`. Files in this directory are read-only history.
