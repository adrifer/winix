# Proposal: context injection, effect registration, and resource handles

> **Status:** `draft`
> **Owner:** unassigned
> **Target:** Winix v0.2
> **Unblocks:** `dependsOn` / resource ordering for the Windows backend, and
> typed cross-platform modules in general.

## Motivation

Today, configuration helpers (`home`, `nix`, `nixos`, `darwin`, `windows`,
`account`, `overlay`, `platforms`) are imported as **module-level globals**
and read an ambient evaluation context behind the scenes:

```ts
import { feature, home, nix, platforms } from "@adrifer/winix";

export const git = feature("git", () =>
  home.program("git", { /* ... */ })
);
```

`platforms.darwin.isActive`, `account.user(...)`, etc. all work by reading a
process-global `EvalContext` that the evaluator sets per host
(`setEvalContext` / `getEvalContext`, see `src/sdk/index.ts` and
`src/evaluator/index.ts`). The plumbing already exists and works; this
proposal does **not** invent a context system. It makes the context
**explicit** and uses that to unlock three things the global model cannot do
cleanly:

1. **Resource identity (`dependsOn`).** DSC v3 configs are dependency graphs:
   a resource has a `name`, and other resources reference it via `dependsOn`.
   To express "this `raw` runs after that `package`" type-safely, a helper
   call must return a **handle** with identity, and a later call must consume
   it. Globals make tracking "what did this unit declare" fragile.
2. **Multiple declarations per unit, ergonomically.** A cross-platform module
   often declares several things (`home.program(...)` + `windows.package(...)`
   + `windows.raw(...)`). The current `return`-based model forces returning an
   array and gets awkward as units grow.
3. **Per-platform type safety and testability.** An injected context can type
   `windows` as available in the right scope and be mocked in unit tests
   without touching global state.
4. **Third-party extensibility.** Because the context is an assembled object,
   a plugin can contribute an additional namespace without changing the core.
   This is the foundation for a future ecosystem (see
   [Future: third-party namespaces](#future-third-party-namespaces)); globals
   offer no clean, public extension point.

This is the single most important API decision in Winix, because it shapes how
every `feature`, `profile`, and `host` body is written. It must be designed
once, deliberately, and remain backward compatible with existing dotfiles.

## Guiding principle: imperative guards, declarative namespaces

Winix has **already chosen** an imperative-with-guards style in real use, and
this proposal keeps it. It is not pure-Nix `mkIf` laziness; it is ordinary
TypeScript control flow over declarative namespaces:

```ts
if (platforms.wsl.isActive) {
  // windows-only / wsl-only block
}
```

This is intuitive for programmers and matches the existing dotfiles. The
proposal changes **where the namespaces come from** (injected, not imported)
and **how declarations are collected** (by effect, not by return), without
changing this mental model.

## Two kinds of API, and where each lives

The current package surface splits cleanly in two:

| Kind | Members | Role | After this proposal |
|---|---|---|---|
| **Structure constructors** | `workspace`, `host`, `profile`, `feature`, `input`, `defineInputs`, `rawModule` | Build the project tree | Imported from the package, top-level. `host`/`profile`/`feature` gain a callback form. |
| **Declaration namespaces** | `home`, `nix`, `nixos`, `darwin`, `windows`, `account`, `overlay`, `platforms` | Declare/query within the current host | Injected into the callback of `feature`/`profile`/`host`. Still importable as globals (back-compat). |

`platforms` is special: it is both a **constructor** (`platforms.nixos({...})`
as the second arg to `host`) and a **query** (`platforms.darwin.isActive`
inside a body). The constructor use stays top-level; the query use is part of
the injected context.

## Proposed API

### 1. Context injection

`feature`, `profile`, and `host` accept a callback that receives the
declaration namespaces destructured:

```ts
import { feature } from "@adrifer/winix";

export const git = feature("git", ({ home, nix }) => {
  home.program("git", { /* ... */ });
});
```

The injected context object exposes:

```ts
interface WinixContext {
  home: HomeHelper;
  nix: NixNamespace;
  nixos: NixosHelper;
  darwin: DarwinHelper;
  windows: WindowsHelper;
  account: AccountNamespace;
  overlay: OverlayHelper;
  platforms: PlatformsHelper; // query side: platforms.darwin.isActive, etc.
}
```

`host` receives the same context in its body, because a host can hold inline
declarations (not just features):

```ts
host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), ({ nixos, home }) => {
  linuxProfile();          // a feature/profile: called for effect
  wsl();                   // ditto
  nixos.sysctl({ /* ... */ });   // inline declaration, uses host context
  azureDevCli();
  home.packages("socat", "bubblewrap");
});
```

The name (`"wsl-work"`) and platform (`platforms.nixos({...})`) remain
positional structural arguments and are **not** part of the context.

### 2. Effect registration (declare by calling, not by returning)

A declaration is registered the moment its helper is called. No `return` is
required. This makes multiple declarations natural:

```ts
export const gitEverywhere = feature("git", ({ home, windows, platforms }) => {
  home.program("git", { userName: "Adri", userEmail: "adri@example.com" });

  if (platforms.windows.isActive) {
    const git = windows.package("Git.Git");
    windows.raw(
      { test: "git config --global user.name", apply: "git config --global user.name Adri" },
      { dependsOn: [git] }
    );
  }
});
```

#### Backward compatibility (required)

Existing dotfiles use the **return** form extensively, in three shapes that
must all keep working:

- **Return one helper** (most features today):
  `feature("git", () => home.program("git", {...}))`
- **Return an array of declarations** (e.g. `wsl.ts`):
  `feature("wsl", () => [nixos.imports(...), nixos({...}), playwright()])`
- **Return after local logic** (e.g. `zsh.ts`):
  `feature("zsh", () => { const parts = [...]; return home.program("zsh", {...}); })`

The collector therefore supports **both** modes: if the callback returns a
fragment or array of fragments, those are registered (current behavior); if it
returns nothing, whatever was registered by effect is used. The two can even
be combined during migration. Globals continue to read `getEvalContext()`
exactly as today, so a file that imports `home` from the package and never
destructures the context behaves identically.

### 3. Resource handles and `dependsOn`

Declaration helpers return a **handle** with identity. Capturing it is
optional: ignore the return for the common case, capture it only when another
resource must depend on it.

```ts
// Simple case: ignore the handle, reads exactly like today.
windows.package("Fastfetch-cli.Fastfetch");

// Ordered case: capture and reference.
const node = windows.package("OpenJS.NodeJS");
windows.raw(
  { test: "Get-Command tsc -ErrorAction SilentlyContinue", apply: "npm install --global typescript" },
  { dependsOn: node }            // single handle or array of handles
);
```

`dependsOn` accepts a single handle or an array (`Handle | Handle[]`).

#### Emitted output (Windows backend)

The emitter assigns each resource a stable `name` and translates captured
handles into `dependsOn` strings:

```yaml
resources:
  - type: Microsoft.WinGet/Package
    name: OpenJS.NodeJS                # name = package id (decided below)
    properties:
      id: OpenJS.NodeJS
      version: "20.11.0"               # from winix-windows.lock (Phase 2)

  - type: Microsoft.DSC.Transitional/RunCommandOnSet
    name: raw-1                        # generated name for id-less resources
    dependsOn:
      - OpenJS.NodeJS
    properties: { /* ... */ }
```

**Naming rules:**

- **Packages:** `name` = the package `id` (`Git.Git`, `OpenJS.NodeJS`). One
  obvious, stable, human-readable identifier. If the same id is declared twice
  in one host, the generator raises a clear error rather than emitting
  duplicate `name`s (declaring the same package twice is already a mistake).
- **Resources without a natural id** (`raw`, `setting`, …): a generated name
  from the resource type plus a per-host counter (`raw-1`, `setting-1`). The
  user never types these; they exist only in the emitted YAML and in
  `dependsOn` wiring, which is driven by handles, not strings.

**Validation at generation time:** every handle referenced by `dependsOn`
must belong to the same host. Dangling references and dependency cycles are
detected and reported with a clear error before any file is written, never
surfaced as an opaque `winget configure` failure on the Windows machine.

## How existing dotfiles map (validated against real configs)

Every pattern in the author's dotfiles maps cleanly, and every one keeps
working unchanged under back-compat:

| Pattern (today) | Example | Under the new model |
|---|---|---|
| Return one helper | `git`, `packages`, `fzf` | `({ home }) => { home.program(...) }` or keep the return |
| Return array of N | `wsl` | `({ nixos }) => { nixos.imports(...); nixos({...}); ... }` |
| Logic + `return` | `zsh` | same body, `({ home, nix, platforms })`, drop final return |
| Conditional spread | `dotfiles` | identical; `platforms` from context |
| `account.user(name, cb)` | `adrifer` | callback gains the context arg so it is genuinely context-aware |
| `profile([...])` with inline `nixos.*` | `lxcProfile` | array stays valid; callback form available for inline decls |
| `workspace({ inputs, hosts })` | root config | unchanged (pure structure) |

`account.user` already takes a `() => ({...})` callback documented as
"context-aware"; this proposal feeds it the same context object so the promise
is real instead of relying on the ambient global.

## Migration strategy

1. Ship context injection + effect registration **additively**: callbacks may
   destructure the context, but globals still work and the return forms still
   register. No existing file breaks.
2. Land `dependsOn` and handles as the first feature that genuinely needs the
   new model (Windows resource ordering, Phase 3 of the Windows backend).
3. Optionally migrate the reference dotfiles in `examples/reference/` to the
   injected style as living documentation.
4. Globals can be soft-deprecated later (a lint/docs nudge), but there is no
   hard removal in this proposal.

## Future: third-party namespaces

The injected context is also the natural **extension point** for the ecosystem.
This proposal does not specify a plugin system, but it is designed so one can be
added later without reworking the core.

Today the namespaces are fixed package exports (`home`, `nix`, `windows`, ...).
Under context injection, the context object is **assembled** before being passed
to a callback. A third-party namespace therefore becomes a single additional
entry in that assembly rather than a change to the core:

```ts
// Future plugin system (separate proposal): register at the workspace level.
workspace({
  plugins: [dockerPlugin],
  hosts: [/* ... */],
});

// The plugin's namespace then appears in every callback's context:
feature("my-stack", ({ home, docker }) => {
  home.program("git", { /* ... */ });
  const db = docker.container("postgres", { /* ... */ });
  docker.container("app", { /* ... */ }, { dependsOn: db });
});
```

Why the context model makes this clean:

- **Small, public contract.** A namespace only needs to (a) produce `Fragment`s
  (the existing `core/types.ts` type) and (b) optionally return handles for
  `dependsOn`. That is a contract that can be published and versioned; today
  everything is internal and there is nothing stable to extend against.
- **Cross-plugin `dependsOn` for free.** Handles carry identity and the graph
  is resolved in the emitter, so a resource from one plugin can depend on a
  resource from another (or from the core) without the plugins knowing about
  each other. Interoperability falls out of the handle machinery.
- **Isolated and testable.** A plugin is exercised by passing a mock context,
  with no global state and without booting the full evaluator.

The parts a dedicated plugin-system proposal must still settle: how plugins are
registered (`workspace({ plugins })` is the obvious shape), which backend(s)
consume a given namespace's fragments (routing), and the stable public contract
(`definePlugin({ name, namespace, emit })` or similar). The contract must be
treated carefully because, once third parties depend on it, it cannot break
lightly. It is intentionally kept **out of this proposal** so the context change
can be reviewed and built on its own, while the structure-vs-declaration split
above already guarantees that adding a namespace stays a clean, additive
operation.

## Non-goals

- **Not removing the global helpers.** They keep working; this is additive.
- **Not specifying the plugin system.** Third-party namespaces are enabled (see
  above) but the registration mechanism, routing, and public contract are a
  separate proposal.
- **Not pure-Nix lazy evaluation.** Winix stays imperative-with-guards; no
  `mkIf` thunk semantics.
- **Not auto-inferred dependencies.** `dependsOn` is explicit via handles.
  Automatic inference (e.g. `windows.programs.git` knowing it needs `Git.Git`)
  is layered later on top of curated helpers (Windows backend Phase 4), reusing
  the same handle machinery.
- **Not changing `workspace`/`input` structure.** Those stay as plain
  top-level constructors.

## Resolved decisions

1. **Single context shape for all three containers.** `feature`, `profile`,
   and `host` receive the same `WinixContext`. No namespace is hidden in any of
   them; they all just "contain declarations", so one shared shape is the
   simplest and most consistent design.
2. **Cross-host references are out of scope.** In-host `dependsOn` is the only
   supported form. A handle from another host is a hard error, reported clearly
   at generation time ("`dependsOn` cannot reference a resource from another
   host") rather than producing invalid output. Cross-host ordering stays
   impossible by design.
3. **Generated names use a per-host counter.** Id-less resources (`raw`,
   `setting`) get deterministic names like `raw-1`, `setting-1` from the
   resource type plus a per-host counter. Readable, stable diffs as long as
   ordering is stable. A content-hash alternative is noted only as a fallback to
   revisit if reordering churn ever becomes a problem; not adopted now.
