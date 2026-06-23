# Tech stack

## Recommendation

Use TypeScript end-to-end:

- TypeScript for the CLI, evaluator, backends, and code generation.
- TypeScript for user-authored system specs.
- Native backend tools for system changes (nixos-rebuild, darwin-rebuild, etc.).

## Rationale

A single-language stack simplifies the project:

- The evaluator **must** be TypeScript (it executes user fragments).
- The SDK, evaluator, and backends share types directly (no JSON IR boundary needed).
- One toolchain to learn, one build system, one test framework.
- Startup time is irrelevant: `winix switch` is dominated by `nixos-rebuild` (minutes), not CLI startup (milliseconds).

Rust was originally considered for CLI startup speed and cross-platform packaging. In practice, the TS evaluator would still be required as a subprocess, adding complexity. A pure TS stack eliminates the IPC boundary entirely.

If startup time becomes a concern in the future, the CLI entry point can be extracted to a compiled language as a thin wrapper that invokes the TS evaluator. The architecture supports this without breaking changes.

## TypeScript runtime

Candidate runtimes (in order of pragmatism):

1. **Node** (v22+): `--experimental-strip-types` gives native TS execution without a build step. Widest ecosystem. Already required for most dev environments.
2. **Bun**: native TypeScript execution, fastest startup, single binary. Already in the author's toolchain.
3. **Deno**: built-in permission model, native TS, single binary.

The choice should be deferred until the CLI is more mature. The evaluator and SDK are runtime-agnostic TypeScript.

## Key dependencies

- `vitest` for testing.
- `commander` or `citty` for CLI parsing.
- Standard Node APIs for file I/O and process spawning.

## Backend tools

- `nix`, `nixos-rebuild`, `darwin-rebuild`, and Home Manager for Nix-family targets.
- DSC v3 for declarative Windows configuration (future).
- Winget for Windows packages (future).
- PowerShell for Windows escape hatches (future).
