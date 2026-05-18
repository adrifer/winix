# Winix — Roadmap & Tasks

## ✅ Completed (2026-05-17)

### Spec
- [x] Flat fragment pattern (spec 11)
- [x] `platform()` + `feature()` + `host()` helpers
- [x] `.isActive` conditionals with native TS (no DSL)
- [x] Inputs as leaf file (`inputs.ts`) with typed references
- [x] Type generation strategy from inputs (spec 11)
- [x] Escape hatches — 3 levels: `raw()`, `rawModule()`, `escape()` (spec 17)
- [x] Merge semantics — last wins + modifiers (spec 06)
- [x] CLI design — init, check, apply, switch, types generate, etc. (spec 13)
- [x] Nix backend — output structure, mapping, lock management (spec 15)
- [x] All-TypeScript tech stack (spec 10)
- [x] Examples reorganized as `examples/reference/`

### Code
- [x] Core types (`Fragment`, `LazyFragment`, `FragmentFactory`, etc.)
- [x] SDK (`platform()`, `feature()`, `host()`, `workspace()`, `defineInputs()`, `input()`)
- [x] Lazy evaluation (two-pass: collect IDs → resolve with context)
- [x] `.isActive` works without workarounds
- [x] Deep merge (arrays append, objects merge, scalars last-wins)
- [x] Composite fragment resolution (nested `Fragment[]` with lazy children)
- [x] Nix backend — generates `flake.nix` + host modules
- [x] Imports mapped to real module paths (home-manager, nixos-wsl)
- [x] Dotted path output (no inline attr sets)
- [x] Quoted keys for sysctl-style paths
- [x] `with pkgs;` for systemPackages
- [x] CLI (`winix apply`, `--dry`, `--diff`, `--host`)
- [x] **nixos-rebuild test successful** with generated Nix 🎉

## 🔧 In Progress

- [ ] Dynamic type generation from NixOS channel `options.json`

## 📋 Next Up (Priority Order)

### P0 — Core functionality
- [x] Home Manager output: packages should use `home.packages = with pkgs; [ ... ];`
- [x] Home Manager output: programs should map correctly (e.g., `programs.git.enable`)
- [x] `rawModule()` support — import existing .nix files for incremental migration
- [x] **Curated authoring helpers** — `packages()`, `user()`, `git()`, `zsh()`, `shell()`, `sysctl()` (spec 20)
- [x] Generic `program()` helper for Home Manager, NixOS, and nix-darwin options (spec 24)
- [x] `escape()` support — inline Nix expressions within typed fragments
- [x] `raw.nixos()` / `raw.home()` — top-level raw Nix fragments
- [x] camelCase → kebab-case mapping for known Nix option paths
- [x] System arch from platform fragment (not hardcoded x86_64-linux)
- [x] Input validation (warn if darwin host exists without nix-darwin input)

### P0.5 — Expression & lib helpers
- [x] `pkg()` helper for explicit unquoted `pkgs.*` references
- [x] `mkDefault()`, `mkForce()`, `mkBefore()`, and `mkAfter()` helpers for `lib.mk*` option priority calls
- [x] Backend quotes any attr path segment that is not a valid Nix identifier
- [x] `overlay.stable()` and `overlay.custom()` helpers for nixpkgs overlays
- [x] Host modules include `config`, `lib`, `pkgs`, and `inputs` in module arguments

### P1 — CLI & DX
- [x] `winix check` — conflict detection, `--strict` mode
- [x] `winix switch` — apply + nixos-rebuild in one command
- [x] `winix init` — scaffold new project
- [x] `winix update` — update flake.lock inputs
- [x] `winix inspect` — fragment graph, host composition, provenance
- [x] `winix check --escape-report` — escape hatch debt report
- [x] Package as npm module so configs can `import { ... } from "winix"`
- [x] `winix` CLI binary (npm bin or npx)

### P2 — Type system
- [ ] `winix types generate` dynamic type extraction from NixOS channel `options.json`
- [x] Hand-written types for top 20 options (git, zsh, packages, sysctl, wsl, etc.)
- [x] Fragment type uses shipped static option types (`nixos?: NixosOptions`)

### P3 — Advanced features
- [ ] Merge modifiers: `override()`, `prepend()`, `replace()`, `without()`, `force()`
- [ ] Provenance comments in generated Nix output
- [ ] `winix migrate` — suggest converting rawModules to typed fragments
- [ ] Multiple nixpkgs channels (`stable()` helper for packages)
- [ ] Overlays support
- [ ] nix-darwin backend
- [ ] Home Manager standalone (no NixOS) backend
- [ ] `winix dev` — watch mode

### P4 — Future
- [ ] Windows backend (DSC, winget, registry, PowerShell)
- [ ] Fragment registry (auto-generated for agent discovery)
- [ ] Third-party fragment ecosystem (npm packages)
- [ ] `winix` VS Code extension / LSP

## 🐛 Known Issues

- `winix.config.ts` must use relative imports (no `"winix"` package yet)
- Needs `node --experimental-transform-types` for native .ts execution
- Home Manager config output is basic (inline in host module, not split file)

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
