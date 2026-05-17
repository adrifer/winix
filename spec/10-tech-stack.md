# Tech stack

## Recommendation

Use:

- Rust for the CLI and backend engine.
- TypeScript for user-authored system specs.
- Evaluator-agnostic TypeScript execution (see below).
- JSON IR as the boundary.
- Native backend tools for system changes.

## Rationale

Rust provides a strong foundation for a cross-platform CLI, process orchestration, typed validation, packaging, and diagnostics. TypeScript provides a better authoring experience than YAML/TOML for dendritic composition because it supports typed reusable functions, imports, autocomplete, and refactoring.

## TypeScript evaluator

The evaluator runs as a subprocess controlled by the Rust CLI. Since Rust already sandboxes the subprocess (captured stdout, no system mutation allowed), the evaluator itself does not need a built-in permission model.

Candidate runtimes (in order of pragmatism):

1. **Bun**: native TypeScript execution, fastest startup, single binary, cross-platform. Already in the author's toolchain.
2. **Node** (v23+): `--experimental-strip-types` gives native TS execution without a build step. Widest ecosystem.
3. **Deno**: built-in permission model (redundant given Rust subprocess control), native TS, single binary.

The choice should be deferred until Phase 2 (evaluator prototype). The IR contract is evaluator-independent, so switching later has no downstream impact. The spec should not couple to a specific runtime.

## Rust libraries

- `clap` for CLI parsing.
- `serde` and `serde_json` for IR.
- `schemars` for JSON Schema generation.
- `thiserror` and `miette` for errors.
- `tracing` for logs.
- `tokio` for process orchestration where async is useful.
- `camino` for UTF-8 paths.
- `windows` and `winreg` for Windows integration.

## Backend tools

- `nix`, `nixos-rebuild`, `darwin-rebuild`, and Home Manager for Nix-family targets.
- DSC v3 for declarative Windows configuration.
- Winget for Windows packages.
- PowerShell for Windows escape hatches.

