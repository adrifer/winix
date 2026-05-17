# Tech stack

## Recommendation

Use:

- Rust for the CLI and backend engine.
- TypeScript for user-authored system specs.
- Deno as the initial TypeScript evaluator.
- JSON IR as the boundary.
- Native backend tools for system changes.

## Rationale

Rust provides a strong foundation for a cross-platform CLI, process orchestration, typed validation, packaging, and diagnostics. TypeScript provides a better authoring experience than YAML/TOML for dendritic composition because it supports typed reusable functions, imports, autocomplete, and refactoring.

Deno is preferred initially because it runs TypeScript directly, ships as a single binary, works cross-platform, and has a permission model. Node can be supported later, but built-in TypeScript support is lightweight type stripping and not a full authoring environment without third-party tooling.

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

