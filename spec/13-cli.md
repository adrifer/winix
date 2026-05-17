# CLI

The Rust CLI owns evaluation orchestration, validation, planning, applying, and diagnostics.

## Commands

```sh
winix init
winix check
winix eval
winix eval --json
winix plan
winix plan --json
winix apply
winix diff
winix doctor
winix inspect graph --json
winix inspect resources --json
winix inspect provenance <resource-id> --json
```

## Responsibilities

- discover workspace config
- invoke TypeScript evaluator
- validate IR
- detect host/platform
- detect backend capabilities
- produce plans
- dispatch backends
- handle elevation
- report diagnostics
- expose stable JSON output for agents

## Git and Nix flakes

When using Nix flakes, Winix must detect new untracked files that would be invisible to Nix evaluation. It should warn or fail with a clear message and suggested command rather than producing confusing backend errors.

## Exit codes

- `0`: success
- `1`: validation or apply failure
- `2`: usage error
- `3`: unsupported capability
- `4`: evaluator failure

