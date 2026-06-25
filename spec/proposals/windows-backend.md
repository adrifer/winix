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

## Implementation status

The **package vertical slice is implemented and validated end-to-end**
(2026-06-25), and the first Windows escape hatch is implemented:

- `platforms.windows()` exists as a third backend peer alongside
  `platforms.nixos()` / `platforms.darwin()`, emitting the `windows`
  fragment scope.
- `windows.package(...)` supports the bare-id, explicit-source,
  inline-version-pin, and `elevated` forms.
- `windows.raw(...)` emits ordered
  `Microsoft.DSC.Transitional/RunCommandOnSet` resources for arbitrary
  commands that run on every apply.
- The evaluator merges the `windows` scope with backend isolation (a
  Windows host does not pull in nixos/darwin fragments and vice versa).
- The Windows emitter (`src/backends/windows/`) generates a native DSC v3
  `configuration.winget` plus `apply.ps1`, matching Microsoft's
  WindowsDeveloperConfig document shape.
- Covered by `tests/windows-backend.test.ts` (helper, platform, evaluator,
  emitter + snapshot) and **confirmed to install a package via
  `winget configure` on Windows 11 25H2**.

See "Worked example (validated end-to-end)" under Backend strategy for the
exact emitted document and the contract notes learned from real-machine
validation. Everything else in this proposal (env/path/file/raw/dsc/wsl/
programs helpers, lockfile, drift, type generation) remains **proposed**,
not yet implemented. The slice is the mold the remaining helpers copy,
each gated by its own snapshot test.

## DSC v3 resource ecosystem

DSC v3 ships a broad catalogue of built-in resources out of the box, and
any executable that reads and writes JSON can act as a resource. Winix on
Windows is not limited to packages: anything DSC can manage, Winix can
emit. Helpers in this proposal cover the most common needs as a typed
surface, and `windows.dsc(...)` provides a typed escape hatch for the
rest of the catalogue without losing reproducibility.

The table below sketches the landscape so reviewers can see what the
Windows backend's authoring surface eventually grows to cover. Tier
labels are scoping commitments, not implementation status:

- **[MVP helper]** — typed helper shipped with the first usable version of
  the Windows backend
- **[Future helper]** — same catalogue surface, but typed helper deferred
  to a follow-up release; usable today via `windows.dsc(...)`
- **[Escape hatch only]** — no plans for a dedicated helper; expected to be
  rare enough that `windows.dsc(...)` is the right ergonomics

### Built-in DSC v3 resources (Microsoft)

| Resource type | Capability | Winix coverage |
|---|---|---|
| `Microsoft.WinGet/Package` | Install/remove winget packages | ✅ [MVP helper] `windows.package(...)` |
| `Microsoft.Windows/Registry` | Read/write/delete registry keys and values | 🛠️ [Future helper] `windows.registry(...)` |
| `Microsoft.Windows/Service` | Start/stop/configure Windows services | 🛠️ [Future helper] `windows.service(...)` |
| `Microsoft.Windows/FirewallRuleList` | Manage Windows Firewall rules | 🛠️ [Future helper] `windows.firewall(...)` |
| `Microsoft.Windows/OptionalFeatureList` | Enable/disable Windows optional features (WSL, Hyper-V, .NET) | 🛠️ [Future helper] `windows.optionalFeature(...)` |
| `Microsoft.Windows/FeatureOnDemandList` | Install/remove Features on Demand (RSAT, language packs) | ⬛ [Escape hatch only] via `windows.dsc(...)` |
| `Microsoft.Windows/WindowsPowerShell` | Adapter for the entire PSDSC v1/v2 module catalogue (IIS, AD, SQL Server, BitLocker, certificates, Hyper-V, etc.) | ⬛ [Escape hatch only] via `windows.dsc(...)` |
| `Microsoft.OpenSSH.SSHD/sshd_config` | Manage `sshd_config` declaratively | 🛠️ [Future helper] `windows.ssh(...)` |
| `Microsoft.OpenSSH.SSHD/Subsystem` and `SubsystemList` | Configure SSH subsystem entries (e.g. SFTP) | ⬛ [Escape hatch only] via `windows.dsc(...)` |
| `Microsoft.OpenSSH.SSHD/Windows` | Windows-specific SSH settings (default shell) | ⬛ [Escape hatch only] via `windows.dsc(...)` |
| `Microsoft.DSC.Transitional/RunCommandOnSet` | Run an arbitrary command on apply (`test` + `set`) | ✅ [MVP helper] `windows.raw({ test, apply })` |
| `Microsoft.Dsc/Include` | Compose a configuration from external DSC documents | ⬛ Used internally by the Winix codegen; not a user-facing helper |
| `Microsoft.Dsc/Assertion` | Validate preconditions before applying | ⬛ [Escape hatch only] via `windows.dsc(...)` |
| `Microsoft.Dsc/Group` | Group resources for ordered or conditional application | ⬛ Used internally by the Winix codegen; not a user-facing helper |
| _(composition over the above)_ | Install + configure a known program with one call (`windows.programs.git`, `windows.programs.vscode`, etc.) | ✅ [MVP helper] `windows.programs.*` (curated set; see "Proposed authoring API") |

The `Microsoft.Windows/WindowsPowerShell` adapter row is worth calling out
separately: it unlocks **every existing PSDSC v1/v2 module** (a decade of
third-party and Microsoft-authored resources for IIS, Active Directory,
SQL Server, certificates, BitLocker, Hyper-V, and so on). Winix does not
plan to add typed helpers for any of these in MVP, but a Winix user can
reach all of them today via `windows.dsc(...)` with a typed shape against
the adapter's schema.

### Resources from any language

DSC v3 treats a resource as "any executable that reads JSON on stdin and
writes JSON on stdout, with a manifest describing its schema". Resources
can be written in PowerShell, Python, Bash, Go, Rust, C#, or anything
else. This is out of scope for this proposal, but it matters as a future
direction: Winix users can ship custom resources alongside their Winix
config and reach them through `windows.dsc(...)` without any change to
Winix itself.

### Implication for MVP scope

The MVP intentionally ships only `windows.package(...)`, `windows.raw(...)`,
`windows.dsc(...)`, and the small set of helpers listed in [MVP scope](#mvp-scope).
Everything else in the table above is reachable today via
`windows.dsc(...)` and is a candidate for a typed helper as real usage
demands it. The structure is deliberate: ship the smallest typed surface
that covers the 80% case, keep the typed escape hatch correct against the
DSC v3 schema for the long tail, and let observed usage drive which
helpers get promoted next.

## Architectural fit

Windows is a third backend peer to Nix and Darwin, not an add-on. The
integration follows the same three-level pattern already established in
[SPEC.md](../SPEC.md):

1. **Platform.** `platforms.windows({ ... })` joins `platforms.nixos` and
   `platforms.darwin` as a third option. Extends the `PlatformsHelper`
   interface in `src/helpers/platforms.ts`. Exactly one platform per host,
   same rule as today.
2. **Fragment key.** `windows?: WindowsOptions` becomes a new optional key
   on the `Fragment` type, alongside `nixos?`, `darwin?`, and `home?`.
   Each backend consumes only its own key.
3. **Helper namespace.** `windows.*` (with `windows.package`, `windows.raw`,
   `windows.dsc`, `windows.env`, `windows.path`, `windows.file`,
   `windows.wsl`) mirrors `nixos.*` and `darwin.*` in shape and naming
   conventions.

### Cross-backend features come for free

Because each backend reads only its own fragment key, a single feature can
declare fragments for every backend it cares about and let the host's
platform decide what actually applies:

```ts
// features/git.ts
import { feature, nixos, darwin, windows, home } from "@adrifer/winix";

export const git = feature("git", () => [
  // NixOS hosts: install via Nixpkgs
  nixos.package("git"),

  // Darwin hosts: install via Nixpkgs (or Homebrew if the host opts in)
  darwin.package("git"),

  // Windows hosts: install via winget, pinned
  windows.package({ id: "Git.Git", version: "2.44.0" }),

  // Home Manager is transversal to NixOS and Darwin (not Windows):
  // configure git declaratively where Home Manager runs
  home.programs.git({
    enable: true,
    userName: "Adri",
    userEmail: "adri@example.com",
  }),
]);
```

Loaded into a Windows host, only `windows.package(...)` contributes to the
emitted `configuration.winget`. The other fragments are a no-op for that
backend, not an error. The same model already works between NixOS and
nix-darwin in the reference dotfiles; Windows extends it naturally.

This is the **primary pattern** for writing portable features. Declare
what each backend should do, side by side, in one place.

### `windows.isActive` for the cases the primary pattern can't cover

The primary pattern handles fragments that compose side by side. It does
not handle cases where **values inside a single object** need to differ by
platform (for example, a dictionary that has different keys per OS, or a
path that uses different conventions per OS).

For those, `windows.isActive` joins `nixos.isActive` and `darwin.isActive`
with identical semantics. Used the same way the reference dotfiles already
use the existing two:

```ts
// features/git.ts, continued: the gitconfig path differs per OS
export const git = feature("git", () => {
  const gitconfigPath = windows.isActive
    ? "%USERPROFILE%\\.gitconfig"
    : "~/.gitconfig";

  return [
    nixos.package("git"),
    darwin.package("git"),
    windows.package({ id: "Git.Git", version: "2.44.0" }),

    // Home Manager renders the file on NixOS/Darwin
    ...(!windows.isActive
      ? [home.programs.git({ enable: true, userName: "Adri", userEmail: "adri@example.com" })]
      : []),

    // On Windows there is no Home Manager: drop the file directly
    ...(windows.isActive
      ? [windows.file(gitconfigPath, gitconfigContent)]
      : []),
  ];
});
```

This is the same pattern `examples/reference/features/zsh.ts` already uses
to give the `i` alias different commands on `platforms.darwin.isActive` vs.
`platforms.nixos.isActive`, and the same pattern
`examples/reference/features/dotfiles.ts` uses to add a `ghostty` config
entry only when `platforms.darwin.isActive`. `windows.isActive` extends
that existing tool, it does not introduce a new mechanism.

Prefer the primary pattern (side-by-side fragments) by default; reach for
`*.isActive` only when a single value's shape genuinely depends on the
platform.

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
- **Per-package version pinning via `winix-windows.lock`.** A Winix-owned
  lockfile that records the resolved version of each declared package, so
  `winix apply` produces the same `configuration.winget` on different
  machines and at different times. See "Versioning and lockfile" below.
- **Raw PowerShell escape hatch** with optional idempotency test, via DSC v3
  `Microsoft.DSC.Transitional/RunCommandOnSet`.
- **Environment variables and PATH entries** at user and machine scope.
- **Dotfile / config file placement** (e.g. `komorebi.json`, `whkdrc`).
- **WSL host-side configuration** (`.wslconfig`, distro registration, default
  distro). The NixOS side of WSL is already handled by the Nix backend.
- **Curated `windows.programs.*` helpers** for a small initial set of common
  developer programs (e.g. `git`, `vscode`, `starship`, `powershell`,
  `windowsTerminal`). Each helper bundles the package install plus the
  idiomatic config-file generation for that program. Same pattern as
  `home.programs.*` in Home Manager, surfaced to Windows. See "Proposed
  authoring API" for details.
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
- **Extended lockfile metadata.** Beyond per-package version, also lock the
  DSC v3 schema revision used to generate the document, the resolved
  versions of any PowerShell modules referenced by raw resources, and
  package checksums where winget exposes them.
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
// Floats: version resolved at `winix update` time, recorded in winix-windows.lock
windows.package("Git.Git")

// Explicit source for non-winget catalogues
windows.package({ source: "msstore", id: "9NKSQGP7F2NH" })

// Pinned: this exact version, always. See "Pinning a version inline" below.
windows.package({ source: "winget", id: "Git.Git", version: "2.44.0" })

// Elevated: install in an admin security context (machine-wide installers,
// drivers, system services). Default is non-elevated; see note below.
windows.package({ id: "Some.Driver", elevated: true })
```

Sources known at the MVP: `"winget"` (default), `"msstore"`. Additional
sources (`chocolatey`, `scoop`) can plug in later as new `source:` values
without changing the public API shape.

`windows.package(id)` is sugar for `windows.package({ source: "winget", id })`.

**Elevation.** `elevated` defaults to `false`. When `false`, the package is
emitted without a `metadata.winget.securityContext` block and installs in
the current user context, which is what `winget configure` expects from a
non-elevated shell. Set `elevated: true` only for packages that genuinely
need admin (machine-wide installers, drivers); doing so emits
`securityContext: elevated`. Defaulting to elevated is a trap: it makes
`winget configure` fail with internal error `-2146233079` from a
non-elevated shell even for ordinary per-user apps (validated on Windows 11).

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

### `windows.programs.<name>(...)` — install + configure in one call

For a curated set of common developer programs, Winix ships a
higher-level helper that bundles the package install with the idiomatic
config-file generation for that program. Same shape and intent as
`home.programs.<name>` in Home Manager, surfaced to Windows.

```ts
windows.programs.git({
  enable: true,
  userName: "Adri",
  userEmail: "adri@example.com",
  defaultBranch: "main",
  delta: { enable: true },
});

windows.programs.vscode({
  enable: true,
  extensions: ["ms-azuretools.vscode-docker", "esbenp.prettier-vscode"],
  userSettings: {
    "editor.fontFamily": "JetBrainsMono Nerd Font",
    "editor.formatOnSave": true,
  },
});
```

Under the hood each helper desugars to the lower-level primitives the
backend already needs (`windows.package`, `windows.file`, `windows.env`,
or `windows.dsc` as appropriate). There is no new primitive: `programs`
is composition over the existing surface, exactly like the curated
helpers in the Nix backend are composition over plain Nix attribute sets.

The value is twofold:

1. **Config-file generation is handled.** `windows.programs.git` knows how
   to serialise its options into a valid `.gitconfig` (INI). The user
   never writes INI or JSON config strings by hand. Same for VSCode
   settings (JSON), PowerShell profiles (.ps1), Windows Terminal
   (settings.json), etc.
2. **Symmetry with Home Manager.** When a feature targets multiple
   backends, the cross-platform shape stays readable because the per-
   backend lines line up visually:

```ts
export const git = feature("git", () => [
  nixos.package("git"),
  darwin.package("git"),

  // Windows: install via winget + render .gitconfig from typed options
  windows.programs.git({
    enable: true,
    userName: "Adri",
    userEmail: "adri@example.com",
  }),

  // NixOS + Darwin: same shape, rendered by Home Manager
  home.programs.git({
    enable: true,
    userName: "Adri",
    userEmail: "adri@example.com",
  }),
]);
```

Note that `windows.programs.*` and `home.programs.*` deliberately do
**not** share a type. They are independent surfaces that converge on a
similar shape by convention. Trying to share types would force the Nix
backend to depend on Windows specifics (or vice-versa) and re-introduce
the "logical package id" coupling that [non-goals](#non-goals) already
rejects. The convergence is at the human-readability level only.

#### Initial curated set (MVP)

MVP ships a small, opinionated shortlist of helpers covering the most
common developer-machine programs:

- `windows.programs.git` (cross-symmetric with `home.programs.git`)
- `windows.programs.vscode` (install + extensions + user settings)
- `windows.programs.starship` (cross-symmetric with `home.programs.starship`)
- `windows.programs.powershell` (profile + module install)
- `windows.programs.windowsTerminal` (`settings.json` generation)

More can be added incrementally without API churn. The criterion for
promoting a program from "users call `windows.package` + `windows.file`
themselves" to "shipped as `windows.programs.<name>`" is observed
demand plus a stable enough config format that the typed surface buys
more than it locks in.

#### Third-party programs

Third-party programs follow the same extensibility model as the rest of
Winix: a published npm package exports a function returning a `Fragment`
or `Fragment[]`. No core changes required.

```ts
// npm: winix-windows-fragment-foo
import { feature, windows } from "@adrifer/winix";

export const foo = feature("foo", (opts: FooOptions) => [
  windows.package({ id: "FooCo.Foo", version: opts.version }),
  windows.file("%LOCALAPPDATA%\\Foo\\config.json", JSON.stringify(opts.config)),
]);
```

`windows.programs.*` is the first-party curated set, not the only path.

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

## Versioning and lockfile

Winix on Windows commits to **reproducible-by-lockfile**: declared resources
are resolved to concrete versions once, written to a lockfile, and the
lockfile is the source of truth for what `winix apply` emits.

### Why a Winix-owned lockfile

`winget configure` has no native lockfile concept. By default it resolves
the "latest available" version of a package at apply time, which means two
machines applying the same `configuration.winget` a week apart can end up
on different versions. That violates the same guarantee the Nix backend
offers via `flake.lock`.

Winix fills the gap with `winix-windows.lock`. Same role as `flake.lock`
on the Nix side, different format because the upstream primitives are
different.

### Two lockfiles, by design

Nix and Windows keep **separate lockfiles** rather than sharing one:

| Backend | Lockfile | Owner |
|---|---|---|
| Nix | `flake.lock` | Nix (Winix shells out to `nix flake update`) |
| Windows | `winix-windows.lock` | Winix (no native winget equivalent) |

This split is intentional:

- `flake.lock` is owned by the Nix ecosystem. Wrapping it inside a
  Winix-flavored container would break direct `nix flake update`,
  `nix flake metadata`, and every other Nix tool the user already knows.
- The two formats are structurally different. `flake.lock` locks flake
  inputs (URLs, narHashes, git revisions). `winix-windows.lock` locks
  package ids against versions resolved from a registry. A merged file
  would be a thin JSON wrapper around two unrelated schemas.
- Diff and review stay clean. A PR that only updates Windows packages
  does not touch Nix inputs and vice versa.
- Merge conflicts stay local to the change.

The shared user-facing surface is **the CLI command**, not the file.

### `winix-windows.lock` format

JSON. Stable, hand-readable, diffable. Commit it to the repo.

```json
{
  "version": 1,
  "generatedAt": "2026-06-24T18:37:00Z",
  "packages": {
    "Git.Git": {
      "source": "winget",
      "version": "2.44.0",
      "resolvedAt": "2026-06-24T18:37:00Z"
    },
    "Microsoft.VisualStudioCode": {
      "source": "winget",
      "version": "1.90.1",
      "resolvedAt": "2026-06-24T18:37:00Z"
    }
  }
}
```

MVP locks only the package version per entry. Additional metadata (DSC
schema revision, PowerShell module versions, package checksums when winget
exposes them) is in Future work.

### CLI: `winix update` extended

The existing `winix update` command (today scoped to `nix flake update`)
gains a Windows path. The defaults stay friendly:

```bash
winix update                          # refresh every backend's lockfile
winix update --nix                    # only refresh flake.lock
winix update --windows                # only refresh winix-windows.lock
winix update --windows Git.Git Microsoft.VisualStudioCode
                                      # refresh only the listed packages
winix update --dry                    # show what would change, change nothing
```

Under the hood, `--windows` calls `winget show <id>` (or the equivalent
winget API) for each package in the workspace, takes the latest available
version, and writes it to `winix-windows.lock`. Errors surface clearly
when a package id no longer exists in the catalogue.

### How the lockfile is used by `apply`

`winix apply` and `winix switch` read `winix-windows.lock` and emit
`configuration.winget` with the locked version pinned per package:

```yaml
# .winix/out/desktop/configuration.winget (excerpt)
resources:
  - name: Git.Git
    type: Microsoft.WinGet/Package
    properties:
      id: Git.Git
      source: winget
      version: "2.44.0"   # <- from winix-windows.lock
```

If a package declared in `winix.config.ts` is missing from the lockfile,
`winix apply` fails with a clear message pointing at `winix update`.
Nothing implicit. Mirrors how Nix flakes refuse to evaluate without a
resolved lock.

### Pinning a version inline

`windows.package(...)` accepts an optional `version:` field. When present,
it acts as an **absolute pin**: that exact version is what gets emitted to
`configuration.winget` and applied to the host, regardless of what is
available upstream.

```ts
// Floats: latest at `winix update` time, lockfile resolves dynamically
windows.package("Git.Git")

// Pinned: this exact version, every apply, on every machine
windows.package({ id: "Git.Git", version: "2.44.0" })
windows.package({
  id: "Microsoft.VisualStudioCode",
  source: "winget",
  version: "1.90.1",
})
```

This pattern mirrors how Nix flake inputs work: an `inputs.nixpkgs.url`
with a git rev pinned is honoured literally; one without lets `flake.lock`
resolve and float. Same idea, different surface.

#### Interaction with `winix-windows.lock`

Pinned packages **still appear in the lockfile** with their pinned
version. The lockfile is the source of truth that `winix apply` reads, and
should reflect the complete intended state of the system without forcing
the Windows backend to re-parse the TypeScript config to know what version
to install. It also gives auditing tools a single file that describes
everything that will be applied.

The difference between pinned and floating is purely in how the entry got
there and what happens on update, not in what the lockfile records:

| Declaration | Lockfile entry | `winix update` behaviour |
|---|---|---|
| `windows.package("Git.Git")` | Floating: version resolved from upstream | Refreshes to latest available |
| `windows.package({ id, version: "2.44.0" })` | Pinned: version copied from the inline pin | Skipped; pin is the source of truth |

`winix update --windows Git.Git` on a pinned package is a no-op with a
clear message explaining the package is pinned in the config and pointing
at the file/line that declares it.

#### Divergence between pin and existing lock entry

The lockfile is **a resolution of the intent declared in code**. Inline
pins are part of that intent, so whenever a command is about to act on the
configuration, it reconciles inline pins into the lock first. This matches
how Nix behaves: changing a pinned input URL in `flake.nix` and running
`nix build` or `nixos-rebuild switch` updates `flake.lock` as part of the
build, without an explicit `nix flake update` step.

| Command | Reconciles inline pins into lock? |
|---|---|
| `winix apply` | Yes, before emitting `configuration.winget` |
| `winix switch` | Yes, before emitting `configuration.winget` |
| `winix update` | No, its job is the inverse (refresh floats from upstream) |
| `winix check` | No, but **reports** divergence as drift (see below) |
| `winix inspect` | No (read-only) |

If a user adds or changes an inline `version:` and the lockfile already had
a different version recorded, `winix apply` and `winix switch` reconcile in
favour of the inline pin and rewrite the lockfile entry, surfacing a
one-line notice in the plan output:

```text
~ Lockfile: Git.Git updated 2.43.0 -> 2.44.0 (inline pin)
```

`winix check` does not modify the lockfile, but the same divergence is
reported as part of its drift output so the user knows an apply will
rewrite the lock without surprise. This is consistent with how `winix
check` reports any other drift between declared and actual state.

This keeps the inline declaration as the unambiguous source of truth and
makes the lockfile rewrite visible in normal command output rather than
hidden behind a separate `winix update` invocation.

### Git semantics

Same as `flake.lock`:

- `winix-windows.lock` is **committed to source control**. It is the
  source of truth for resolved versions.
- `.winix/out/<host>/configuration.winget` stays **gitignored**. It is
  generated, recreated on every apply.

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

### Worked example (validated end-to-end)

This is the exact document the implemented MVP emits, byte-for-byte, and it
has been confirmed to apply successfully via `winget configure` on a real
Windows 11 machine. It is the authoritative contract for the emitter: any
change to the package-resource shape must update the snapshot test in
`tests/windows-backend.test.ts`.

Input:

```ts
workspace({
  inputs,
  hosts: [
    host("desktop", platforms.windows(), [
      windows.package("Fastfetch-cli.Fastfetch"),
      windows.package({ id: "Microsoft.VisualStudioCode", version: "1.90.1" }),
      windows.package({ id: "Some.Driver", elevated: true }),
    ]),
  ],
})
```

Output (`.winix/out/desktop/configuration.winget`):

```yaml
# yaml-language-server: $schema=https://raw.githubusercontent.com/PowerShell/DSC/main/schemas/2023/08/config/document.json
# Generated by Winix for host "desktop". Do not edit.
$schema: https://raw.githubusercontent.com/PowerShell/DSC/main/schemas/2023/08/config/document.json
metadata:
  winget:
    processor: dscv3
resources:
  - name: Fastfetch-cli.Fastfetch
    type: Microsoft.WinGet/Package
    properties:
      id: Fastfetch-cli.Fastfetch
      source: winget
      acceptAgreements: true
  - name: Microsoft.VisualStudioCode
    type: Microsoft.WinGet/Package
    properties:
      id: Microsoft.VisualStudioCode
      source: winget
      acceptAgreements: true
      version: "1.90.1"
  - name: Some.Driver
    type: Microsoft.WinGet/Package
    properties:
      id: Some.Driver
      source: winget
      acceptAgreements: true
    metadata:
      winget:
        securityContext: elevated
```

Contract notes, each learned from real-machine validation:

- **`metadata.winget.processor: dscv3`** is required to select the DSC v3
  engine. Without it, `winget configure` falls back to the legacy 0.2
  processor and the `type`/`properties` resource shape is not recognised.
- **`resources` is top-level**, not nested under `properties`. The legacy
  0.2 format (`properties.resources[].resource`/`settings`) is a different,
  incompatible document and must not be emitted.
- **`securityContext: elevated` is opt-in per package** (`elevated: true`),
  not the default. Emitting it unconditionally makes `winget configure`
  fail with internal error `-2146233079` when run from a non-elevated
  shell, even for per-user packages. Packages float without the `metadata`
  block unless elevation is explicitly requested.
- **`acceptAgreements: true`** is emitted on every package so unattended
  applies do not block on license prompts.
- Packages are **sorted by id** so the emitted document is deterministic
  regardless of fragment declaration/merge order.

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
   release and bump deliberately. The implemented MVP pins to **`2023/08`**,
   matching Microsoft's own WindowsDeveloperConfig workloads and confirmed
   working via `winget configure` on Windows 11 25H2. (Earlier draft said
   `2024/04`; corrected after real-machine validation.)
3. **Reboot handling.** Detect required reboot and prompt, vs. always
   continue and print a final summary. The MVP prints a summary and never
   reboots automatically. `winget configure` itself can resume after a
   sign-in via RunOnce when required, but Winix does not arm that behavior
   implicitly.
4. **Secrets.** Windows Credential Manager and DPAPI are obvious candidates,
   but secret integration is a cross-platform concern that should land in
   a separate proposal.
5. **Lockfile resolution source.** `winget show <id>` is the obvious way to
   resolve versions, but it requires winget to be available on the machine
   running `winix update`. Alternative paths (the public winget-pkgs
   manifest index, a hosted resolver, etc.) may be worth considering for
   CI environments without winget installed.
