# Frontend/backend protocol

The frontend/backend boundary separates TypeScript authoring from Rust execution.

## Initial protocol

1. Rust CLI discovers `winix.config.ts`.
2. Rust invokes the TypeScript evaluator as a subprocess (runtime chosen at build/config time).
3. The evaluator loads the TypeScript SDK and user config.
4. The SDK emits IR JSON to stdout.
5. Diagnostics intended for humans go to structured JSON, not ad-hoc logs.
6. Rust validates the IR and owns all backend operations.

TypeScript must never apply system changes directly.

## Transport

- Batch JSON over stdout for v1.
- No streaming protocol required initially.
- Non-zero evaluator exit means evaluation failed.
- Rust should preserve evaluator stderr for diagnostics.

## Source spans

The SDK should attach source file and export metadata where possible. If exact line/column is unavailable initially, file and branch provenance are still required.

## Security

The evaluator runs as a subprocess with stdout/stderr captured by Rust. System mutation is prevented at the protocol level (Rust only reads JSON from stdout; it never executes evaluator-produced commands without validation). The Rust CLI is the single point of system interaction.

If the chosen runtime supports additional sandboxing (e.g., Deno permissions), that is a defense-in-depth bonus, not a requirement.

## Future options

- Embedded evaluator.
- Node evaluator.
- Cached evaluation.
- Plugin protocol.
- WASM modules.

