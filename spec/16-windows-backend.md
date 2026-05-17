# Windows backend

The Windows backend should provide a Winix equivalent for desired-state system configuration using Windows-native tools.

## Strategy

Use capability tiers instead of pretending Windows has Nix-level reproducibility.

Preferred tools:

- DSC v3 for declarative resources.
- Winget for packages.
- PowerShell for explicit activation and escape hatches.
- Registry APIs for registry resources.
- Windows APIs for services, environment variables, and tasks where appropriate.

## Required resource coverage

- Winget packages
- DSC resources
- registry keys and values
- environment variables
- PATH entries
- services
- scheduled tasks
- Windows features/capabilities
- fonts
- PowerShell activation tasks
- WSL integration hooks

## Reboot and elevation

Plans must report:

- whether elevation is required
- whether reboot may be required
- whether a change can be tested before apply
- whether rollback is unavailable

## Limitations

Windows backend resources may be best-effort or idempotent rather than strictly reproducible. Unsupported Nix-only abstractions must fail clearly during planning.

