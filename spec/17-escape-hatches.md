# Escape hatches

Escape hatches allow Winix to represent backend-specific behavior before a typed abstraction exists.

## Supported escape hatches

- raw Nix module
- raw Home Manager module
- raw nix-darwin module
- raw DSC resource
- raw PowerShell task
- raw registry resource
- raw backend file generation

## Requirements

Every escape hatch must include:

- stable ID
- backend target
- reason
- portability warning
- source provenance
- explicit capability requirement

## Rules

- Escape hatches are never silently ignored.
- Unsupported escape hatches fail during planning.
- Escape hatches should be isolated to small files.
- Plans should show that a resource is raw/backend-specific.
- Raw code must not run during TypeScript evaluation.

## Example

```ts
nix.rawModule({
  id: "raw.nix.wsl-special-case",
  reason: "Migration bridge for existing WSL module",
  module: ./raw/wsl.nix,
});
```

