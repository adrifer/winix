# Conformance

Conformance prevents the spec from drifting away from real migration needs.

## Required fixture sources

The initial fixture set should be derived from `/home/adrifer/dotfiles/nixos` scenarios:

- WSL host
- WSL work host
- macOS host
- Syncthing LXC host
- shared developer packages
- shell configuration
- activation DAGs
- Nix GC defaults and overrides
- dual nixpkgs channels
- raw Nix migration bridge

## Golden outputs

The project should eventually maintain:

- golden IR snapshots
- golden diagnostics
- generated Nix module snapshots
- generated Windows DSC/Winget examples where applicable

## Acceptance gate

A scenario is covered only if:

1. It has a traceability row.
2. It has a Winix concept.
3. It has a backend target or documented limitation.
4. It can be represented in TypeScript.
5. It has expected IR shape.

