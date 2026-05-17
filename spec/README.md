# Winix specification

Winix is a cross-platform system specification tool. It aims to let users describe Linux, NixOS, nix-darwin, macOS, WSL, LXC, and Windows machines through a high-quality TypeScript authoring experience while delegating actual system changes to proven platform backends.

The initial architecture is:

```text
TypeScript workspace
  -> Winix IR JSON
  -> Rust CLI validation, planning, diagnostics, and backend dispatch
  -> Nix / NixOS / nix-darwin / Home Manager / DSC / Winget / PowerShell
```

## Design priorities

1. Human-friendly TypeScript specs with strong IDE support.
2. Agent-friendly specs that are explicit, searchable, and safe to edit.
3. Dendritic configuration: shared roots branch into platforms, roles, hosts, users, and features.
4. Faithful migration coverage for `/home/adrifer/dotfiles/nixos`.
5. Native backend leverage instead of replacing Nix, DSC, Winget, or PowerShell.
6. Clear diagnostics, provenance, dry-runs, plans, and JSON outputs.

## Specification map

Read in this order:

1. `01-product-requirements.md`
2. `02-glossary.md`
3. `03-existing-dotfiles-analysis.md`
4. `04-dendritic-configuration.md`
5. `05-domain-model.md`
6. `06-evaluation-semantics.md`
7. `07-activation-model.md`
8. `08-intermediate-representation.md`
9. `09-frontend-backend-protocol.md`
10. `10-tech-stack.md`
11. `11-typescript-frontend.md`
12. `12-typescript-dx.md`
13. `13-cli.md`
14. `14-backends.md`
15. `15-nix-backend.md`
16. `16-windows-backend.md`
17. `17-escape-hatches.md`
18. `18-security.md`
19. `19-agent-dx.md`
20. `20-conformance.md`
21. `21-traceability-matrix.md`
22. `22-roadmap.md`

## Non-goals for v1

- Replacing Nix evaluation or the NixOS module system.
- Matching Nix-level reproducibility on Windows.
- Providing a GUI.
- Managing remote fleets.
- Hiding all platform-specific behavior.
- Allowing TypeScript specs to mutate the system directly.
