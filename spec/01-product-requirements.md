# Product requirements

Winix should improve the developer experience of declaring personal and workstation systems without discarding the strengths of Nix or Windows-native management tooling.

## Primary users

- Users with existing NixOS, nix-darwin, Home Manager, or dotfiles setups.
- Users who want one mental model across Linux, macOS, WSL, LXC, and Windows.
- Humans and coding agents editing system specs over time.

## Core workflows

Winix must support:

- initializing a workspace
- defining hosts, users, roles, features, and platforms
- evaluating TypeScript into a backend-neutral IR
- validating configuration without applying changes
- producing a human-readable and JSON plan
- applying changes through backend tools
- inspecting provenance for any generated resource
- diffing desired state vs generated backend output where possible
- migrating current NixOS/dotfiles scenarios incrementally

## Required commands

```sh
winix init
winix check
winix eval --json
winix plan
winix plan --json
winix apply
winix inspect graph --json
winix inspect resources --json
winix inspect provenance <resource-id> --json
winix doctor
```

## Quality requirements

- Deterministic evaluation from the same inputs.
- Stable resource IDs.
- Source provenance for generated resources.
- Excellent error messages with suggested fixes.
- Explicit unsupported-capability diagnostics.
- No system mutation during TypeScript evaluation.
- Dry-run/check workflows before apply.
- Strict schema versioning.

## Backend expectations

Nix-family backends may be highly reproducible. Windows backends are desired-state and capability-based; the product must report limitations instead of pretending equivalent guarantees exist.

