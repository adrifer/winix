# Windows backend

The Windows backend should provide a Winix equivalent for desired-state system configuration using Windows-native tools.

## Versioning

Windows backend is scoped for **v1.5**, not v1. The v1 release focuses on Nix-family targets (NixOS, nix-darwin, Home Manager) where the author's existing setup lives.

## v1.5 scope (minimum viable Windows)

- Winget packages
- Environment variables and PATH entries
- Dotfile/config file placement (e.g., komorebi.json, whkdrc)
- WSL host-side configuration (wslconfig, distro registration)
- Raw PowerShell escape hatch

## v2 scope (full Windows)

- DSC v3 resources
- Registry keys and values
- Services
- Scheduled tasks
- Windows features/capabilities
- Fonts

## Strategy

Use capability tiers instead of pretending Windows has Nix-level reproducibility.

Preferred tools:

- Winget for packages.
- PowerShell for explicit activation and escape hatches.
- DSC v3 for declarative resources (v2).
- Registry APIs for registry resources (v2).

## Reboot and elevation

Plans must report:

- whether elevation is required
- whether reboot may be required
- whether a change can be tested before apply
- whether rollback is unavailable

## Limitations

Windows backend resources may be best-effort or idempotent rather than strictly reproducible. Unsupported Nix-only abstractions must fail clearly during planning.

## Cross-platform package identity

Package identity is backend-specific for v1.5. `git` in nixpkgs (`pkgs.git`), Winget (`Git.Git`), and Homebrew (`git`) are separate resources in separate namespace modules. A future "logical package" abstraction that resolves per-backend may be explored in v2 when real cross-platform usage patterns emerge.

