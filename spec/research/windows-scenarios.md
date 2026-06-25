# Windows scenarios — research from microsoft/WindowsDeveloperConfig

> Source: https://github.com/microsoft/WindowsDeveloperConfig (Microsoft's official
> DSC v3 dev-box configs). Studied 2026-06-25 to find real-world patterns worth
> supporting as typed Winix helpers. External upstream; treat as reference.

## What Microsoft's real configs actually use

Workloads inspected: dotnet, go, java, php, python, rust, typescript, winforms, winui.
All emit DSC v3 (`processor: dscv3`, schema `2023/08`), exactly what Winix emits today.

Beyond `Microsoft.WinGet/Package`, the real configs use these DSC resource types:

| DSC resource type | Used for | Winix support today |
|---|---|---|
| `Microsoft.WinGet/Package` | Install packages | ✅ `windows.package()` |
| `Microsoft.DSC.Transitional/RunCommandOnSet` | Run arbitrary commands | ✅ `windows.raw()` (PR #42) |
| `Microsoft.Windows.Settings/WindowsSettings` | OS settings (Developer Mode, etc.) | ❌ |
| `Microsoft.Windows.Developer/OsVersion` | Assert minimum OS version | ❌ |
| PSDSC modules (ensure-installed pattern) | Bootstrap DSC modules before use | ❌ |

Plus two **structural** features used heavily that Winix's emitter does NOT support yet:

1. **`dependsOn`** — resources declare ordering deps (e.g. "install toolchain AFTER
   build tools"). Rust, winui, typescript all use it. This is the single most
   common feature after `Package`.
2. **`metadata.description`** per resource — human-readable label shown during apply.
   Every resource in every MS workload has one.

## Concrete patterns observed

### Rust workload (the richest)
- `Rustup` package (elevated)
- `VisualStudio.2022.BuildTools` package (elevated)
- `RunCommandOnSet` to add the VCTools workload via the VS bootstrapper, `dependsOn` BuildTools
- `RunCommandOnSet` to `rustup default stable`, `dependsOn` Rustup + VCTools
- **Lesson:** real setups are DAGs, not flat lists. `dependsOn` is load-bearing.

### WinUI workload
- Installs PowerShell7, .NET SDK, VS 2026, Windows App SDK CLI, App Runtime
- `Microsoft.Windows.Developer/OsVersion` → asserts Windows 10 1809+
- `Microsoft.Windows.Settings/WindowsSettings` with `DeveloperMode: true` → **enables Developer Mode**
- Ensures `Microsoft.Windows.Settings` / `Microsoft.Windows.Developer` PS modules exist first (via RunCommandOnSet), then uses them, chained with `dependsOn`
- **Lesson:** "enable Developer Mode" and "require min OS version" are extremely
  common dev-box needs with clean native DSC resources.

### TypeScript / Go / Java / PHP / Python
- Mostly `Package` + a `RunCommandOnSet` post-install step (e.g. `npm i -g typescript`)
- **Lesson:** "install package, then run a setup command that depends on it" is the
  bread-and-butter combo. Needs `dependsOn` to be correct.

## Recommended Winix helpers to add (priority order)

These are ranked by (value × how-clean-the-DSC-primitive-is × demo appeal).

### Tier 1 — high value, clean native DSC primitive, low risk

1. **`dependsOn` support on resources** (structural, not a new helper).
   Let `windows.package()` / `windows.raw()` accept an optional `dependsOn` / `name`
   so users can order them. Without this, multi-step setups (the majority) can't be
   expressed correctly. **This is the highest-leverage addition.** It's emitter +
   type work, no new external primitive.

2. **`windows.setting({ DeveloperMode: true })`** → `Microsoft.Windows.Settings/WindowsSettings`.
   Enables Developer Mode and other OS settings. Hugely common dev-box need, clean
   native resource, great demo ("one line of TS flips Developer Mode"). Caveat:
   requires the `Microsoft.Windows.Settings` DSC module to be present; the emitter
   should auto-emit the ensure-module RunCommandOnSet + `dependsOn` (the pattern MS
   uses) OR document the prerequisite.

3. **`metadata.description` on resources** (structural). Let any helper take a
   `description?` that maps to `metadata.description`. Tiny change, big UX win in
   apply output. Pairs naturally with #1.

### Tier 2 — valuable, slightly more involved

4. **`windows.requireOsVersion("10.0.17763")`** → `Microsoft.Windows.Developer/OsVersion`.
   Assert a minimum OS build before applying. Good guardrail, clean resource.

5. **`windows.dsc({ type, name, properties, dependsOn })`** — the typed escape hatch
   to ANY DSC resource. This is already in the spec (line ~78). It would let power
   users hit `WindowsSettings`, `OsVersion`, registry, SSH, etc. WITHOUT waiting for
   a typed helper. Strategically this might even come BEFORE #2/#4, because it
   unblocks every resource at once, and the typed helpers (#2, #4) become thin
   sugar over it.

### Tier 3 — known-hard / lower ROI for now

6. **`windows.env()` / `windows.path()`** — NO clean native DSC resource exists.
   MS does PATH/env manipulation via `RunCommandOnSet` + `[Environment]::SetEnvironmentVariable`,
   not a declarative resource. So these would be sugar over `windows.raw()`, not a
   real declarative helper. Doable but honest framing: it's codegen'd PowerShell,
   not idempotent DSC. Defer until `raw` + `dependsOn` land.

7. **`windows.programs.*`** (curated helpers like `windows.programs.git`) — nice demo
   sugar but lower architectural value than the structural features above. The spec
   already scopes these; they're sugar over `package` + convention.

## Strategic recommendation

The thing that unlocks the most real-world configs with the least new surface is
**`dependsOn` + `name` + `description` as structural resource options**, shared by
`package` and `raw`. Microsoft's own configs are DAGs; without ordering, Winix can
only express trivial flat setups. Do that next (after the lockfile), then
`windows.dsc()` as the universal typed escape hatch, then sugar helpers
(`setting`, `requireOsVersion`) on top.

`windows.env/path` are the trap: they LOOK fundamental but have no clean DSC
primitive, so they're just `raw` in a trenchcoat. Be honest about that in the API.
