# Security

Winix manages sensitive system configuration and must be conservative.

## Threat model

Risks include:

- secrets committed to source control
- malicious TypeScript execution
- unsafe activation scripts
- untrusted modules
- package supply-chain compromise
- privilege escalation bugs

## Rules

- TypeScript evaluation must not mutate the system.
- Secrets should be references, not plaintext values.
- Raw scripts require explicit metadata and warnings.
- Privilege requirements must be shown in plans.
- JSON outputs must avoid leaking secret values.

## Secret integrations

Potential integrations:

- `sops-nix`
- `agenix`
- 1Password CLI
- Windows Credential Manager
- DPAPI
- environment-provided secret references

## Module trust

Remote modules are out of scope for v1 unless pinned and explicitly trusted.

