# Winix — Roadmap & Tasks

## ✅ Completed

### Spec (2026-05-17)
- [x] Flat fragment pattern (spec 11)
- [x] `platform()` + `feature()` + `host()` helpers
- [x] `.isActive` conditionals with native TS (no DSL)
- [x] Inputs as leaf file (`inputs.ts`) with typed references
- [x] Type generation strategy from inputs (spec 11)
- [x] Escape hatches — 3 levels: `nixos.raw()` / `home.raw()` / `darwin.raw()`, `rawModule()`, `nix.expr()` (spec 17)
- [x] Merge semantics — last wins + modifiers (spec 06)
- [x] CLI design — init, check, apply, switch, types generate, etc. (spec 13)
- [x] Nix backend — output structure, mapping, lock management (spec 15)
- [x] All-TypeScript tech stack (spec 10)
- [x] Examples reorganized as `examples/reference/`

### Core (2026-05-17 → 2026-05-18)
- [x] Core types (`Fragment`, `LazyFragment`, `FragmentFactory`, etc.)
- [x] SDK (`platform()`, `feature()`, `host()`, `workspace()`, `defineInputs()`, `input()`)
- [x] Lazy evaluation (two-pass: collect IDs → resolve with context)
- [x] `.isActive` works without workarounds
- [x] Deep merge (arrays append, objects merge, scalars last-wins)
- [x] Composite fragment resolution (nested `Fragment[]` with lazy children)
- [x] Nix backend — generates `flake.nix` + host modules
- [x] Imports mapped to real module paths (home-manager, nixos-wsl)
- [x] Dotted path output (no inline attr sets)
- [x] Quoted keys for non-identifier path segments
- [x] `with pkgs;` for systemPackages
- [x] **nixos-rebuild switch successful** with generated Nix on real system 🎉

### Helpers (2026-05-18)
- [x] `rawModule()` / `rawModule.homeManager()` / `rawModule.darwin()` — incremental migration
- [x] Curated: `account()`, `nixos.*`, `darwin.*`, `home.*`
- [x] Namespace helpers: `home.program()`, `home.service()`, `home.env()`, `home.path()`, `nixos.service()`
- [x] `nix.expr()` — inline Nix expressions
- [x] `nixos.raw()` / `home.raw()` / `darwin.raw()` — verbatim Nix blocks
- [x] `nix.pkg()` — unquoted `pkgs.*` references
- [x] `nix.lib.mkDefault()`, `nix.lib.mkForce()`, `nix.lib.mkBefore()`, `nix.lib.mkAfter()` — lib option priority
- [x] `overlay.stable()`, `overlay.custom()` — nixpkgs overlays
- [x] camelCase → kebab-case auto-mapping for program/service names at known path prefixes

### CLI (2026-05-18)
- [x] `winix apply` (`--dry`, `--diff`, `--host`)
- [x] `winix switch` — apply + nixos-rebuild/darwin-rebuild (auto-detect platform)
- [x] `winix update` — nix flake update + copy lock back
- [x] `winix check` — conflict detection, `--strict`, `--escape-report`
- [x] `winix inspect` — fragment composition per host
- [x] `winix init` — scaffold new project
- [x] `winix types generate` — dynamic NixOS types from channel options.json
- [x] Package exports + bin (npm-ready)

### Types (2026-05-18)
- [x] Static types shipped in package (NixOS, HM, Darwin, Programs)
- [x] `Fragment` interface uses real typed options
- [x] Dynamic NixOS type generation from channel (24,438 options)

---

## 🔧 Current Priorities

### Priority 1 — DX: Reduce raw()/nix.expr() and simplify authoring

Goal: Make configs more readable and reduce boilerplate. Focus on the patterns that
currently force users into raw() blocks.

- [x] **Unified `nix.*` namespace** — `nix.expr`, `nix.pkg`, `nix.str`, `nix.script`, `nix.concat`, `nix.withPkgs`, `nix.lib.*`, `nix.optionalAttrs`, `nix.optionalString`
- [x] **Recursive profiles** — `profile()` composes fragments/profiles without spread boilerplate
- [x] **Built-in platform presets** — `platforms.nixos()` and `platforms.darwin()` cover common NixOS/nix-darwin bases
- [x] **Unified accounts** — `account()` configures Home Manager, NixOS/Darwin users, shells, admin groups, and WSL defaults
- [x] **Intent helpers** — `nixos.*`, `darwin.*`, `home.*`, and `nix.gc()` reduce nested Nix-shaped objects
- [x] **Activation helper** — `home.activation("name", { after: [...], script: "..." })` for `lib.hm.dag.entryAfter` pattern
- [x] **Improve error messages** — when a fragment fails, show which helper to use or how to fix it
- [x] **Audit existing config** — go through dotfiles/winix raw() blocks, find more patterns to abstract
- [x] **Real config migration** — `/home/adrifer/dotfiles/winix` uses the new profiles, platforms, account, `nix.*`, and intent helpers
- [x] **Clear Home Manager scope** — fragments use `homeManager` instead of ambiguous top-level `home`

### Priority 2 — LLM-friendly: Make AI agents excellent at writing Winix configs

Goal: An LLM with access to the repo/docs can generate correct, idiomatic Winix configs
from a natural language description without trial and error.

- [ ] **AGENTS.md** in repo root — clear instructions for LLMs: available helpers, patterns, how to create features, common pitfalls
- [ ] **Fragment catalog** — machine-readable registry of all helpers with signatures, options, and usage examples (JSON or structured Markdown)
- [ ] **`winix scaffold feature <name>`** — generate a feature template that an LLM just fills in
- [ ] **Golden examples** — canonical configs for common setups (minimal, WSL, darwin, multi-host, migration) that serve as few-shot examples for LLMs
- [ ] **`winix explain <host>`** — natural-language summary of what a host config does (useful for LLM context)
- [ ] **Inline JSDoc on all helpers** — complete `@description`, `@example`, `@param` for editor hover + LLM extraction
- [ ] **Error output as guidance** — errors should suggest the correct helper/pattern, not just report what went wrong

### Priority 3 — Windows backend

Goal: Manage Windows system configuration (DSC, winget, registry, scheduled tasks,
PowerShell) using the same fragment/helper model.

- [ ] **Windows backend design** — spec the output format (DSC? PowerShell scripts? winget export? Registry .reg?)
- [ ] **`platform("windows", ...)`** — Windows platform fragment with `windows: {}` scope
- [ ] **Windows-specific helpers** — `winget([...])`, `registry(path, values)`, `scheduledTask(...)`, `envVar(...)`, `windowsFeature(...)`
- [ ] **`winix apply` on Windows** — generates PowerShell/DSC output in `.winix/out/`
- [ ] **`winix switch` on Windows** — executes the generated config (elevated PowerShell)
- [ ] **Cross-platform fragments** — fragments that target both NixOS and Windows (e.g., package lists that map to `winget` on Windows)
- [ ] **Windows type generation** — types for DSC resources, registry keys, winget packages

---

## 📋 Backlog (no priority assigned)

### Type system
- [x] Dynamic type generation for Home Manager (local nix eval)
- [x] Dynamic type generation for nix-darwin (local nix eval)

### Advanced Nix features
- [ ] Merge modifiers: `override()`, `prepend()`, `replace()`, `without()`, `force()`
- [ ] Provenance comments in generated Nix output
- [ ] `winix migrate` — suggest converting rawModules to typed fragments
- [ ] Home Manager standalone (no NixOS) backend
- [ ] nix-darwin standalone backend

### Developer experience
- [ ] `winix dev` — watch mode (auto-apply on save)
- [ ] `winix diff` — standalone diff command (currently `winix apply --diff`)
- [ ] npm publish to registry
- [ ] README rewrite with real usage examples

### Future vision
- [ ] VS Code extension / LSP (completions, hover, diagnostics)
- [ ] Fragment registry (auto-generated for agent discovery)
- [ ] Third-party fragment ecosystem (npm packages)
- [ ] Multi-machine orchestration

## 🐛 Known Issues

- Needs `node --experimental-transform-types` for native .ts execution (Node limitation)
- Home Manager config is inline in host module (not split file) — design choice for now

## 📝 Design Decisions Log

| Decision | Rationale | Date |
|---|---|---|
| Flat fragments | Everything is a fragment in a flat list. Simple, composable, LLM-friendly. | 2026-05-17 |
| `.isActive` over `when()` DSL | Native TS > custom DSL. Less API to learn. | 2026-05-17 |
| Lazy evaluation | Fragments return descriptors, resolved with context. Makes `.isActive` work. | 2026-05-17 |
| All TypeScript | No Rust. Single language. Evaluator must be TS anyway. | 2026-05-17 |
| Lock in project root | Committed to git. Ensures reproducibility across hosts. | 2026-05-17 |
| `.winix/out/` gitignored | Generated output is per-machine. Not source of truth. | 2026-05-17 |
| `path:` prefix for nixos-rebuild | Bypasses git tracking requirement for gitignored output. | 2026-05-17 |
| Fragment keys match Nix option names | Use `"experimental-features"` not `experimentalFeatures`. Avoids mapping bugs. | 2026-05-17 |
| Namespace-first helpers | Prefer scoped helpers like `home.program()` and `nixos.service()` over ambiguous generic helpers. | 2026-05-18 |
| Static types + dynamic generation | Ship hand-written types for instant DX; generate full types from channel for complete coverage. | 2026-05-18 |
| LLM-first design | Fragments, helpers, and docs should be optimized for AI agents to discover and use correctly. | 2026-05-18 |
| Unified Nix expression namespace | Public raw expression helpers live under `nix.*` to reduce import sprawl and make escape hatches discoverable. | 2026-05-19 |
| Presets over boilerplate | Common systems should start from `platforms.*`, `account()`, and intent helpers; low-level fragments remain available for advanced cases. | 2026-05-19 |
