# Proposal: Windows backend

> **Status:** `draft`
> **Owner:** unassigned
> **Target:** Winix v1.5 (minimum viable) → v2 (full Windows)

## Motivation

Today Winix targets Nix-family systems only (NixOS, nix-darwin, Home Manager).
Many users — including the author — run Windows machines (often alongside WSL)
that they would like to manage with the same declarative TypeScript workspace.

A Windows backend lets a single `winix.config.ts` describe:

- Linux servers (NixOS)
- macOS workstations (nix-darwin)
- WSL distros (NixOS-WSL, already in scope)
- Native Windows hosts (this proposal)

## Non-goals

- **Reproducibility parity with Nix.** Windows does not have content-addressed
  package storage. Winix on Windows is desired-state and best-effort, not
  reproducible-by-construction.
- **Replacing winget, DSC, or PowerShell.** Winix should generate calls to
  these tools, not reimplement them.
- **Cross-platform "logical packages"** (e.g. a single `pkg("git")` that
  resolves to Nixpkgs/Homebrew/Winget). Package identity stays backend-specific
  for v1.5; a logical layer can be revisited in v2 once real usage patterns
  emerge.

## v1.5 scope (minimum viable Windows)

The first usable Windows backend should cover:

- **Winget packages.** Install/upgrade/remove by id.
- **Environment variables and PATH entries** at user and machine scope.
- **Dotfile / config file placement** (e.g. `komorebi.json`, `whkdrc`).
- **WSL host-side configuration** (`.wslconfig`, distro registration, default
  distro). The NixOS side of WSL is already handled by the Nix backend.
- **Raw PowerShell escape hatch** (`windows.raw(script)`) for anything not
  yet typed.

## v2 scope (full Windows)

Once v1.5 is real, the following can be layered on top:

- **DSC v3 resources** for declarative configuration.
- **Registry keys and values** (typed helpers + raw escape hatch).
- **Services** (start/stop, startup type).
- **Scheduled tasks.**
- **Windows features and capabilities** (Hyper-V, sandboxes, optional features).
- **Fonts.**

## Proposed authoring API

Mirrors the existing `nixos` / `darwin` namespaces in `SPEC.md` § 7.

```ts
import { feature, windows } from "@adrifer/winix";

export const baseline = feature("windows.baseline", () => [
  windows.winget("Git.Git"),
  windows.winget("Microsoft.VisualStudioCode"),

  windows.env({ EDITOR: "nvim" }),
  windows.path("%USERPROFILE%\\.local\\bin"),

  windows.file("$env:APPDATA\\komorebi\\komorebi.json", {
    source: "configs/komorebi.json",
  }),

  windows.wsl({
    distro: "NixOS",
    default: true,
    config: {
      memory: "16GB",
      processors: 8,
    },
  }),

  // Escape hatch
  windows.raw(`
    Set-MpPreference -DisableRealtimeMonitoring $false
  `),
]);
```

### Platform baseline

```ts
import { platforms, host } from "@adrifer/winix";

export const desktop = host("desktop", platforms.windows(), [
  baseline(),
]);
```

`platforms.windows()` returns a baseline fragment in the same shape as
`platforms.nixos()` / `platforms.darwin()`.

## Capability tiers and diagnostics

Windows resources should declare their capability tier explicitly so plans
can warn the user:

| Tier | Meaning | Example |
|---|---|---|
| `idempotent` | Safe to re-apply; converges to declared state | `windows.winget("Git.Git")` |
| `best-effort` | Re-applies the change; cannot verify drift | `windows.raw(script)` |
| `requires-elevation` | Needs an admin shell | Most registry / service changes |
| `requires-reboot` | Activation completes only after reboot | Windows features |

The CLI must surface these tiers before activation:

```text
winix switch --host desktop

Plan:
  + Winget: Git.Git
  + Winget: Microsoft.VisualStudioCode
  ! Requires elevation: 2 changes
  ! Requires reboot: 0 changes
```

Unsupported Nix-only abstractions (e.g. `nixos.imports(...)` referenced from
a Windows host) must fail clearly during `winix check` with a pointer to the
incompatible resource.

## Backend strategy

The backend generates a self-contained activation bundle under
`.winix/out/<host>/`:

```text
.winix/out/desktop/
├── manifest.json          # ordered list of resources + capability tiers
├── winget.json            # winget configuration export
├── apply.ps1              # entry point for activation
├── files/                 # config files to copy into place
└── scripts/               # raw PowerShell escape hatches
```

`winix switch` on Windows would invoke `pwsh -File apply.ps1`, elevating with
`Start-Process -Verb RunAs` when the manifest requires it.

## Open questions

1. **Driver for `apply.ps1`.** Hand-rolled PowerShell vs. DSC v3 invocation
   vs. a small TypeScript runtime that shells out to each tool. v1.5 leans
   toward hand-rolled for simplicity.
2. **Idempotency for raw scripts.** Should `windows.raw()` require the user
   to declare a `test:` predicate, or accept "re-runs every apply"? v1.5
   proposes the latter with a clear capability tier.
3. **Reboot handling.** Detect required reboot and prompt, vs. always
   continue and print a final summary. v1.5 proposes "print a summary; never
   reboot automatically."
4. **Secrets.** Windows Credential Manager and DPAPI are obvious candidates,
   but secret integration is a cross-platform concern that should land in a
   separate proposal.

## Relationship to the Nix backend

The Windows backend is **additive**. The Nix backend stays the source of truth
for NixOS / nix-darwin / Home Manager hosts. A single workspace can mix host
types:

```ts
export default workspace({
  inputs,
  hosts: [
    host("desktop",     platforms.windows(), [ /* … */ ]),
    host("macbook-pro", platforms.darwin(),  [ /* … */ ]),
    host("wsl-work",    platforms.nixos(),   [ /* … */ ]),
  ],
});
```

The evaluator and CLI already support per-host backend dispatch via the
platform baseline; this proposal slots in as a new `platforms.windows()` and
a new emitter under `src/backends/windows/`.
