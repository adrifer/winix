# Roadmap

## Phase 0: Specification

- Complete markdown specs.
- Inventory current dotfiles.
- Define traceability matrix.
- Choose initial stack and boundaries.

## Phase 1: CLI skeleton

- Rust workspace.
- `winix --help`.
- `winix check` placeholder.
- config discovery.

## Phase 2: Dendritic composition and merge semantics

- Branch graph model.
- Merge strategies with sensible defaults per resource kind.
- Override/default/force behavior.
- Conflict detection and diagnostics.
- Precedence rules.
- Provenance tracking through merges.

## Phase 3: TypeScript evaluator prototype

- Subprocess integration (runtime TBD: Bun, Node, or Deno).
- TypeScript SDK prototype with structural resource IDs.
- JSON IR emission.
- Source provenance basics.

## Phase 4: IR and validation

- Rust IR types.
- JSON Schema generation.
- Semantic validation.
- Diagnostics model.
- Capability checking.

## Phase 5: Nix backend prototype

- Generate/import Nix modules.
- Support one migrated host scenario (WSL personal).
- Flake check integration.
- Dry-run diff against current generated output.

## Phase 6: Full Nix coverage

- All four hosts (WSL, WSL-work, macbook-pro, syncthing-lxc).
- Activation DAG generation.
- Platform conditionals.
- Dotfile link resource kind.
- Raw module escape hatches.

## Phase 7: Conformance

- Fixtures from current dotfiles.
- Golden IR snapshots.
- Traceability coverage checks.

## Phase 8: Windows backend (v1.5)

- Winget package planning.
- Environment variables and PATH.
- Dotfile/config placement.
- WSL host-side config.
- PowerShell escape hatch.

## Phase 9: Stabilization

- Docs.
- Examples.
- Agent commands.
- Migration guide.
- Cross-platform diff/plan UX.

