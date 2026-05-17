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

