# Proposal: Windows backend

> **Status:** `draft`
> **Owner:** unassigned

## Motivation

Today Winix targets Nix-family systems only (NixOS, nix-darwin, Home Manager).
Many users — including the author — run Windows machines (often alongside WSL)
that they would like to manage with the same declarative TypeScript workspace.

A Windows backend lets a single `winix.config.ts` describe:

- Linux servers (NixOS)
- macOS workstations (nix-darwin)
- WSL distros (NixOS-WSL, already in scope)
- Native Windows hosts (this proposal)

## Reference: Microsoft's declarative stack

Windows already has the primitives needed to back a declarative model. This
proposal builds on what exists rather than reinventing it:

- **DSC v3** (Desired State Configuration v3): cross-platform, JSON Schema
  based, multiple resource providers. Stable schemas under
  `https://raw.githubusercontent.com/PowerShell/DSC/main/schemas/2024/04/`.
- **`winget configure`**: official runner that consumes a DSC v3 document
  (`configuration.winget`) and applies it. Ships with App Installer; enabled
  per-machine via `winget configure --enable`.
- **`Microsoft.WinGet/Package`**: DSC resource for package install/upgrade.
- **`Microsoft.DSC.Transitional/RunCommandOnSet`**: DSC resource for raw
  PowerShell with caller-supplied idempotency checks. The official escape
  hatch inside DSC.
- **[microsoft/WindowsDeveloperConfig]**: Microsoft's reference repo of
  opinionated `configuration.winget` files for dev box setup. Uses DSC v3
  end-to-end and confirms this is the path Microsoft is investing in.

[microsoft/WindowsDeveloperConfig]: https://github.com/microsoft/WindowsDeveloperConfig

Winix on Windows is the **TypeScript authoring frontend** for that stack:
fragments compose, types check, and the emitter writes a valid DSC v3
`configuration.winget` plus a thin `apply.ps1` that invokes
`winget configure`. No reimplementation of idempotency, elevation, or
install logic.

## Non-goals

- **Reproducibility parity with Nix.** Windows does not have content-addressed
  package storage. Winix on Windows is desired-state and best-effort, not
  reproducible-by-construction.
- **Replacing winget, DSC, or PowerShell.** Winix generates calls to these
  tools and emits DSC v3 documents; it does not reimplement them.
- **Cross-platform "logical packages"** (e.g. a single `pkg("git")` that
  resolves to Nixpkgs/Homebrew/Winget). Package identity stays
  backend-specific; a logical layer can be revisited later once real usage
  patterns emerge.

## MVP scope

The first usable Windows backend should cover:

- **Winget packages.** Install/upgrade/remove by id, via DSC v3
  `Microsoft.WinGet/Package`.
- **Raw PowerShell escape hatch** with optional idempotency test, via DSC v3
  `Microsoft.DSC.Transitional/RunCommandOnSet`.
- **Environment variables and PATH entries** at user and machine scope.
- **Dotfile / config file placement** (e.g. `komorebi.json`, `whkdrc`).
- **WSL host-side configuration** (`.wslconfig`, distro registration, default
  distro). The NixOS side of WSL is already handled by the Nix backend.
- **Generated DSC v3 types.** A build step pulls the DSC v3 JSON Schema and
  emits TypeScript types for the document, resource shapes, and known
  resource types. Same pattern as the NixOS option type generator.

## Future work

Once the MVP is real and patterns of use surface, the following can be
layered on top:

- **Full DSC v3 resource catalogue** (any resource discoverable via
  `dsc resource list`), not just the two transitional resources.
- **Registry keys and values** (typed helpers + raw escape hatch).
- **Services** (start/stop, startup type).
- **Scheduled tasks.**
- **Windows features and capabilities** (Hyper-V, sandboxes, optional
  features).
- **Fonts.**
- **Drift detection and reporting.** Use `dsc resource get` to read the
  current state, diff against the declared state, and report it from
  `winix check`. This is one of the genuine superpowers DSC v3 unlocks
  and it has no Nix equivalent on Windows. See "Drift detection" below.
- **Chocolatey / Scoop sources** for `windows.package(...)`. Plug in as
  additional `source:` values without changing the public API shape;
  deferred until community demand surfaces.

## Proposed authoring API

Mirrors the existing `nixos` / `darwin` namespaces in `SPEC.md` § 7.

```ts
import { feature, windows } from "@adrifer/winix";

export const baseline = feature("windows.baseline", () => [
  // Winget packages (typed against the bundled package id catalogue)
  windows.package("Git.Git"),
  windows.package("Microsoft.VisualStudioCode"),
  windows.package("Microsoft.PowerShell"),

  // Environment + PATH
  windows.env({ EDITOR: "nvim" }),
  windows.path("%USERPROFILE%\\.local\\bin"),

  // Config file placement
  windows.file("$env:APPDATA\\komorebi\\komorebi.json", {
    source: "configs/komorebi.json",
  }),

  // WSL host-side configuration
  windows.wsl({
    distro: "NixOS",
    default: true,
    config: {
      memory: "16GB",
      processors: 8,
    },
  }),

  // Escape hatch: re-runs every apply
  windows.raw(`
    Set-MpPreference -DisableRealtimeMonitoring $false
  `),

  // Escape hatch with idempotency test (recommended for non-idempotent ops)
  windows.raw({
    test: `Get-MpPreference | Where-Object { -not $_.DisableRealtimeMonitoring }`,
    apply: `Set-MpPreference -DisableRealtimeMonitoring $false`,
  }),

  // Direct DSC v3 resource for anything not yet wrapped by a helper
  windows.dsc({
    type: "Microsoft.WinGet/Package",
    properties: { id: "Microsoft.VisualStudio.2022.Community", source: "winget" },
    metadata: { winget: { securityContext: "elevated" } },
  }),
]);
```

### `windows.package(...)` — package authoring

Typed against the bundled winget catalogue (generated per release, same
pattern as the NixOS option types):

```ts
// Most common: winget source by default
windows.package("Git.Git")

// Explicit source for non-winget catalogues
windows.package({ source: "msstore",     id: "9NKSQGP7F2NH" })
windows.package({ source: "winget",      id: "Git.Git", version: "2.44.0" })
```

Sources known at the MVP: `"winget"` (default), `"msstore"`. Additional
sources (`chocolatey`, `scoop`) can plug in later as new `source:` values
without changing the public API shape.

`windows.package(id)` is sugar for `windows.package({ source: "winget", id })`.

### `windows.raw(...)` — escape hatch

Two shapes, both emit `Microsoft.DSC.Transitional/RunCommandOnSet` under the
hood:

```ts
// Simple form: re-runs every apply (capability tier: best-effort)
windows.raw(`Set-MpPreference -DisableRealtimeMonitoring $false`);

// With idempotency test (capability tier: idempotent)
windows.raw({
  test:  `Get-Command tsc -ErrorAction SilentlyContinue`,
  apply: `npm install --global typescript`,
});
```

When `test` is provided, the emitter wraps the apply script in a `dsc check`
preamble equivalent to:

```powershell
if (<test expression succeeds>) { exit 0 }
<apply script>
```

### `windows.dsc(...)` — direct DSC v3 resource

The lowest-level escape hatch on the typed side. Accepts any DSC v3 resource
shape (typed against the DSC v3 schema):

```ts
windows.dsc({
  type: "Microsoft.WinGet/Package",
  properties: { id: "Microsoft.VisualStudio.2022.Community" },
})
```

`windows.dsc()` is what `windows.package()`, `windows.env()`, etc. desugar
into. Users only reach for it when a helper does not exist yet.

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

Windows resources declare their capability tier explicitly so plans can
warn the user. DSC v3 already separates these concerns at the resource
level; Winix lifts them into the planning UI.

| Tier | Meaning | Example |
|---|---|---|
| `idempotent` | Safe to re-apply; converges to declared state | `windows.package("Git.Git")`, `windows.raw({ test, apply })` |
| `best-effort` | Re-applies the change; cannot verify drift | `windows.raw(scriptOnly)` |
| `requires-elevation` | Needs an admin shell | Most registry / service changes |
| `requires-reboot` | Activation completes only after reboot | Windows features |

The CLI surfaces these tiers before activation:

```text
winix switch --host desktop

Plan:
  + Winget: Git.Git
  + Winget: Microsoft.VisualStudioCode
  ! Requires elevation: 2 changes
  ! Requires reboot:    0 changes
  ? Best-effort raw:    1 change   (no idempotency test declared)
```

Unsupported Nix-only abstractions (e.g. `nixos.imports(...)` referenced from
a Windows host) must fail clearly during `winix check` with a pointer to the
incompatible resource.

## Drift detection

DSC v3 supports a `get` operation per resource that reads the current state
of the system. The Windows backend uses this for `winix check`:

```text
winix check --host desktop

Drift detected:
  ~ Winget: Git.Git
      declared: 2.44.0
      actual:   2.43.0
  ! PATH (user)
      declared: 3 entries
      actual:   4 entries (extra: C:\Users\tony\some-tool\bin)
  ✓ All other resources match.
```

This has no NixOS equivalent because Nix is reproducible-by-construction;
drift detection is a Windows-specific affordance the backend can offer
because DSC v3 makes it cheap. Deferred to future work; the MVP only stubs
the command behind a "not implemented" message.

## Backend strategy

The backend generates a self-contained activation bundle under
`.winix/out/<host>/`:

```text
.winix/out/desktop/
├── manifest.json                # ordered list of resources + capability tiers
├── configuration.winget         # DSC v3 document (consumed by winget configure)
├── apply.ps1                    # thin entry point that invokes winget configure
├── files/                       # config files to copy into place
└── scripts/                     # raw PowerShell escape hatches (referenced
                                 # by RunCommandOnSet entries in configuration.winget)
```

`apply.ps1` is intentionally thin:

```powershell
# Generated by Winix. Do not edit.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

winget configure `
    -f .\configuration.winget `
    --accept-configuration-agreements `
    --disable-interactivity
```

Idempotency, elevation prompts, ordering of `dependsOn`, and error reporting
all live inside `winget configure` and DSC v3. Winix's job is to emit a
correct document; Microsoft's stack runs it.

`winix switch --host desktop` invokes `pwsh -File apply.ps1` and surfaces
the output unchanged.

## DSC v3 type generation

The Winix release pipeline pulls the DSC v3 JSON Schema and emits bundled
TypeScript types for:

- The DSC v3 configuration document shape (top-level structure).
- The base resource shape (`{ name, type, properties, metadata, dependsOn }`).
- A known resource catalogue (initially: `Microsoft.WinGet/Package`,
  `Microsoft.DSC.Transitional/RunCommandOnSet`, expanded as more typed
  helpers land).

Same pattern as `static-types.test.ts > examples` for NixOS options.

The winget catalogue (~6000+ package ids) is generated as a string-union
`WinGetPackageId` so `windows.package(...)` autocompletes valid ids and
flags typos. Sourced from the public winget-pkgs manifest index, regenerated
nightly against the index.

## Relationship to the Nix backend

The Windows backend is **additive**. The Nix backend stays the source of
truth for NixOS / nix-darwin / Home Manager hosts. A single workspace can mix
host types:

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

A note on the WSL story: a Windows host running `platforms.windows()` is
responsible for `.wslconfig`, registering the distro, and choosing the
default. Its declared NixOS sibling host (e.g. `wsl-work` on
`platforms.nixos()`) is responsible for everything inside the distro
(packages, dotfiles, shell, Home Manager). The two hosts coexist in the
same workspace and are configured by the same `winix switch`, each through
its own backend.

## Open questions

1. **Source of the winget catalogue for type generation.** Pulling the full
   winget-pkgs manifest index nightly is the obvious answer; a smaller
   curated "popular packages" subset may be more pragmatic to start, until
   the type generator handles ~6k union members cleanly.
2. **DSC v3 schema pinning.** The schema versions itself by date
   (`2023/08`, `2023/10`, `2024/04`). Winix should pin to one version per
   release and bump deliberately. Default: `2024/04`.
3. **Reboot handling.** Detect required reboot and prompt, vs. always
   continue and print a final summary. The MVP prints a summary and never
   reboots automatically. `winget configure` itself can resume after a
   sign-in via RunOnce when required, but Winix does not arm that behavior
   implicitly.
4. **Secrets.** Windows Credential Manager and DPAPI are obvious candidates,
   but secret integration is a cross-platform concern that should land in
   a separate proposal.
