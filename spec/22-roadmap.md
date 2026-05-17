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

## Phase 2: TypeScript evaluator prototype

- Deno subprocess.
- TypeScript SDK prototype.
- JSON IR emission.
- source provenance basics.

## Phase 3: IR and validation

- Rust IR types.
- JSON Schema generation.
- semantic validation.
- diagnostics model.

## Phase 4: Nix backend prototype

- generate/import Nix modules.
- support one migrated host scenario.
- flake check integration.

## Phase 5: Windows backend prototype

- Winget package planning.
- DSC resource export.
- PowerShell escape hatch.

## Phase 6: Dendritic composition

- branch graph.
- merge semantics.
- override/default/force behavior.
- provenance inspection.

## Phase 7: Conformance

- fixtures from current dotfiles.
- golden IR snapshots.
- traceability coverage checks.

## Phase 8: Stabilization

- docs.
- examples.
- agent commands.
- migration guide.

