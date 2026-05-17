# Frontend/backend protocol

The frontend/backend boundary separates TypeScript authoring from Rust execution.

## Initial protocol

1. Rust CLI discovers `winix.config.ts`.
2. Rust invokes Deno as a subprocess.
3. Deno loads the TypeScript SDK and user config.
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

The evaluator should run with minimal permissions. Deno is preferred because permissions can be restricted and expanded intentionally.

## Future options

- Embedded evaluator.
- Node evaluator.
- Cached evaluation.
- Plugin protocol.
- WASM modules.

