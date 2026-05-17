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
winix diff --against <path-or-ref>
winix doctor
winix inspect graph --json
winix inspect resources --json
winix inspect provenance <resource-id> --json
```

## Diff and dry-run

`winix diff` compares the current desired state (evaluated IR) against:

1. **Previously generated backend output** (e.g., last generated Nix modules). This is the default: "what changed in my config since last apply?"
2. **A git ref or path** (`--against main`, `--against ./snapshots/last-known-good`): useful for reviewing changes before merging.
3. **Current system state** (stretch goal): for backends that support state querying (Nix store, Winget list), show drift between desired and actual.

For Nix backends, the primary diff target is the generated `.nix` files. For Windows backends (v1.5+), diff compares desired resources against `winget list` output or registry queries where possible.

`winix plan` remains the pre-apply safety check showing what backend operations would run.

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

