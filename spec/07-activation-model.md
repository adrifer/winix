# Activation model

Activation resources model ordered operations that cannot be represented as static packages, files, or services.

## Requirements

Activation tasks must support:

- stable ID
- scope: system or user
- backend target
- command or backend-native body
- dependencies
- before/after edges
- idempotency declaration
- elevated privilege requirement
- failure behavior
- provenance

## Graph semantics

Activation tasks form a DAG. Cycles are fatal. Missing dependencies are fatal unless marked optional with a capability guard.

## Backend lowering

| Backend | Lowering |
|---|---|
| Home Manager | `home.activation` DAG entries |
| NixOS | `system.activationScripts` with ordering support |
| nix-darwin | activation scripts or native module options |
| Windows DSC | DSC resources where possible |
| Windows PowerShell | explicit PowerShell activation task |

## Idempotency

Activation tasks must declare one of:

- `idempotent`
- `check-then-run`
- `always-run`
- `unsafe`

`unsafe` tasks require explicit user opt-in and should produce warnings in plans.

