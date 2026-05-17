# Nix backend

The Nix backend targets Nix, NixOS, nix-darwin, and Home Manager.

## Strategy

Winix should not replace Nix evaluation. It should generate or compose Nix modules and let Nix evaluate, build, activate, and roll back.

## Required support

- flakes
- inputs
- lockfiles
- overlays
- nixpkgs config
- `allowUnfree`
- multiple nixpkgs channels
- NixOS hosts
- nix-darwin hosts
- Home Manager user modules
- module imports
- raw Nix modules
- Home Manager activation DAGs
- system activation scripts
- platform conditionals
- default/override/force-style semantics

## Migration mode

Winix must support importing existing Nix modules during migration. A user should be able to wrap the current `/home/adrifer/dotfiles/nixos` style before replacing individual features with typed Winix resources.

## Generated output

Generated Nix should be readable, stable, and traceable back to Winix resource IDs.

## Validation

For Nix-family targets, `winix check` should be able to run equivalent Nix validation such as flake checks or dry builds when requested.

