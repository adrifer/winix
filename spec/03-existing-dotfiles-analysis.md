# Existing dotfiles analysis

Winix must cover the current behavior of `/home/adrifer/dotfiles/nixos`. The existing setup uses a dendritic Nix flake architecture: cross-cutting features are defined once and publish platform-specific outputs that are composed by profiles and hosts.

## Observed architecture

- Nix flake-based workspace.
- `flake-parts`-style composition.
- Import-tree pattern to load features once.
- Features can publish Home Manager, Darwin, and NixOS modules from one concern-oriented file.
- Hosts compose profiles, features, inputs, and backend modules.
- Current validation uses `nix flake check --no-build`, host builds, and manual verification.

## Platform and host patterns

The setup includes Linux/NixOS, nix-darwin/macOS, WSL, and LXC-style host concerns.

Known examples to preserve:

- WSL interop with `.exe` registration enabled.
- WSL path sync through shell hooks.
- WSL Git Credential Manager wrapper invoking Windows Git.
- Work WSL sysctl tuning for low ports and file watchers.
- Syncthing LXC with service, timer, storage paths, versioning, and operational setup.
- macOS rebuild aliases using `darwin-rebuild`.
- NixOS rebuild aliases using `nixos-rebuild`.

## Required Nix concepts

Winix must represent:

- flakes and inputs
- dual nixpkgs channels
- overlays
- `allowUnfree`
- NixOS modules
- nix-darwin modules
- Home Manager modules
- `lib.mkDefault` and force-style overrides
- platform conditionals using `pkgs.stdenv`
- activation DAGs
- system activation scripts
- `nix.gc` defaults and host overrides
- package availability differences by platform
- raw Nix module escape hatches

## User and shell configuration

The current setup uses:

- Home Manager packages for user tools.
- System packages for server/LXC tools where appropriate.
- `home.sessionVariables`.
- `home.sessionPath`.
- `programs.zsh.initContent`.
- platform-specific shell aliases.
- functions for tools such as yazi, zoxide, WSL path sync, and rebuilds.

Winix must preserve separate resource kinds for session variables, PATH entries, shell init snippets, aliases, and functions.

## Activation requirements

Current Home Manager activation uses ordered DAG entries, for example creating writable npm config before installing global npm packages. NixOS system activation uses dependency ordering such as `lib.stringAfter`.

Winix must model activation as a dependency graph with explicit ordering, idempotency requirements, failure behavior, and backend-specific lowering.

## Operational foot-guns

Nix flakes only see files tracked or staged by Git. Winix must detect unstaged new files when generating Nix flakes or warn clearly before evaluation.

## Migration requirements

Winix should support incremental adoption:

1. Wrap/import existing Nix modules.
2. Generate equivalent Nix modules for new Winix resources.
3. Preserve raw Nix until typed abstractions exist.
4. Provide traceability from current dotfiles scenario to Winix concept.

