# Domain model

The domain model describes what TypeScript authors create and what backends consume.

## Core entities

| Entity | Description |
|---|---|
| Workspace | Root project containing hosts, branches, modules, and settings. |
| Branch | Reusable configuration unit with resources and dependencies. |
| Host | Concrete target composed from branches. |
| User | User-scoped configuration target. |
| Resource | Desired-state item with stable ID, kind, scope, platform, and provenance. |
| Backend | Platform adapter with declared capabilities. |
| Plan | Ordered set of backend operations with diagnostics. |

## Resource kinds

Initial universal kinds:

- package
- service
- file
- directory
- symlink
- dotfile link (out-of-store symlink from repo path to XDG/config target)
- environment variable
- PATH entry
- shell alias
- shell function
- shell init snippet
- activation task
- secret reference
- backend module import
- backend raw block

Windows-specific kinds:

- Winget package
- DSC resource
- registry key/value
- Windows feature/capability
- scheduled task
- service configuration
- PowerShell task

Nix-specific kinds:

- flake input
- overlay
- nixpkgs config
- NixOS module
- nix-darwin module
- Home Manager module
- Nix package
- activation script

## Resource IDs

Resource IDs must be stable, deterministic, and require zero manual effort from the user.

**Strategy: structural IDs derived from import paths.**

The SDK generates a stable ID from the module path + export name + resource kind. For example:

```ts
// File: winix/features/git.ts
export const git = feature("git", { ... });
// Generated ID: "features/git/git"

// File: winix/packages/nix/nodejs.ts
export const nodejs = pkg({ version: "22" });
// Generated ID: "packages/nix/nodejs"
```

Rules:

- IDs are derived from the workspace-relative file path + export name.
- Users may override with an explicit `id` field when the default is inadequate.
- Renaming a file or export changes the ID (this is intentional: renames are breaking changes that should be visible).
- Platform is structural: `packages/nix/*` vs `packages/winget/*` vs `packages/brew/*`.
- No hidden ID generation from content hashing or runtime state.

## Required metadata

Every resource should carry:

- stable ID
- kind
- scope
- target platforms
- source branch
- source location when available
- reason or description
- merge strategy
- backend capability requirements

