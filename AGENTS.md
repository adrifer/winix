# AGENTS.md — Winix

Instructions for AI coding agents (Copilot, Claude Code, Cursor, etc.) working on Winix.

## Project Overview

Winix is a TypeScript-first system configuration tool that generates Nix (NixOS, nix-darwin, Home Manager) from composable TypeScript fragments.

**Pipeline:** `winix.config.ts` → Evaluator (two-pass) → Nix backend → `.winix/out/flake.nix` + host modules

## Architecture

```
src/
  core/types.ts          # All type definitions. Start here.
  sdk/index.ts           # User-facing API: feature(), profile(), host(), platforms.*, workspace()
  evaluator/index.ts     # Two-pass: collect IDs → resolve with context → deep merge
  backends/nix/index.ts  # Generates flake.nix + host .nix modules
  cli/
    index.ts             # CLI entry point (parseArgs)
    loader.ts            # Finds and imports winix.config.ts
    commands/apply.ts    # winix apply
    commands/check.ts    # winix check
```

## Key Concepts

### Fragment Pattern
Everything is a `Fragment | Fragment[]`. No inheritance, no classes. Just functions returning data. Bodies may also **declare by effect** through injected namespaces (`home.*`, `nixos.*`, `darwin.*`, `windows.*`), which auto-register without a return.

### Three Helpers
Distinct roles: a **feature declares** config, a **profile groups** features, and a **host** is the target.
- `feature(id, callback)` — **declares** config. N per host. Has `.isActive`. The callback receives an injected context; it can declare by effect and/or return fragments.
- `profile(id, entries[])` — **groups** features. **Array of entries only** (instantiated features/profiles and bare fragments). No callback: passing one is a compile error and a runtime `TypeError`. Has `.isActive`.
- `host(name, platform, entries[])` or `host(name, platform, callback)` — top-level target. Entries array **or** callback (effects + return). No `.isActive`.

Platforms are built through `platforms.*` (`platforms.nixos({...})`, `platforms.darwin({...})`, `platforms.windows()`) and passed as a host's second argument; they expose `.isActive` too (`platforms.nixos.isActive`).

### Context Injection & Effects
- `feature` and the callback form of `host` receive `{ home, nixos, darwin, windows, platforms }`. `nix`, `account`, and `overlay` are NOT injected (stay file-level imports).
- Declarations through an injected namespace **auto-register** (no return needed). Calling another `feature()`/`profile()` factory returns a lazy fragment that is **not** auto-collected and **must be returned** to compose it.
- Additive and back-compat: the return forms (one fragment, array, or after local logic) still work; an effect-only callback returning nothing type-checks (`AuthoringResult = FragmentResult | void`); imported globals still work (a global `home.*` call is not auto-registered, so it must be returned).

### Lazy Evaluation
`platform()` and `feature()` return `LazyFragment` descriptors (not resolved fragments). The evaluator:
1. **Pass 1:** Scans descriptors to collect IDs + resolve composites recursively to find nested IDs.
2. **Pass 2:** Sets implicit context (`_ctx`), then calls `__resolve()` on each lazy fragment. `.isActive` getters read from this context.
3. **Pass 3:** Deep merges all resolved fragments (arrays append, objects merge, scalars last-wins).

### Implicit Context
`.isActive` uses a module-level `_ctx` variable (like React hooks). Set by the evaluator before resolving fragments. `withContext()` is the testing escape hatch.

## Conventions

- **All TypeScript, no Rust.** Single language stack.
- **ESM modules** with `.ts` extensions in imports (Node `--experimental-transform-types`).
- **Vitest** for tests. Run `npx vitest run`.
- **No build step** for development. Source runs directly via Node.
- **Fragment keys match Nix option names.** Use `"experimental-features"` not `experimentalFeatures`. The backend does NOT auto-convert camelCase to kebab-case for option keys.
- **Input names** use camelCase in TS (`nixosWsl`), auto-converted to kebab-case for Nix (`nixos-wsl`).
- **Core npm workflows must stay shell-independent.** `npm run check`, `npm test`, `npm run build`, and `npm run clean` should work from PowerShell/cmd, WSL, Linux, and macOS. Use Node scripts instead of shell-specific commands like `rm -rf`, `cp`, or `mkdir -p`.

## Windows/WSL Compatibility

Winix development is supported from native Windows and WSL. Windows hosts emit DSC v3 configurations (`winget configure`) with package, raw, env, path, file, setting, dsc, startup, PowerShell module, optional-feature, and WSL helpers. Resource helpers return handles and accept `dependsOn`. `windows.knownFolder.documents()` and sibling methods resolve file targets during activation; copy/symlink sources are config-directory-relative (or absolute/environment paths/file URLs). `windows.startup.command()` manages current-user sign-in shortcuts without launching them during apply. PowerShell modules, NixOS-WSL x64/ARM64 images, and optional distro setup repository commits use separate pins in `winix-windows.lock`, alongside packages. WSL provisioning never restarts Windows, shuts down WSL, replaces conflicting distros, or deletes distro data. The same `windows.wsl.distro()` declaration creates an absent distro or adopts an untracked registration matching WSL 2, NixOS and the expected Linux hostname (`host`, defaulting to `setup.host`). Adoption records GUID/location in Local AppData `Winix\wsl-registrations`, preserves actual location/defaults, skips setup permanently, and leaves Linux activation manual; it does not inspect Git, checkouts, config or accounts. Distro `setup` opts Winix-created distros into trusted first-run Linux repository/npm preparation and account/full-host activation; omitting it keeps Linux activation manual. Setup selects an already-declared Linux account, resumes recorded stages, and never resets dirty checkouts or updates completed setups. Fresh-image activation remains unverified; curated program helpers remain pending. See `spec/proposals/windows-backend.md` for the full plan.

- **Separate filesystem paths from generated Nix paths.**
  - Use `node:path` for real filesystem paths (`.winix/out`, copying raw modules, loading configs).
  - Use `node:path.posix` or explicit POSIX formatting for generated Nix paths (`./hosts/foo.nix`, `../raw-modules/foo.nix`).
  - Never let Windows backslashes leak into generated Nix files or Nix flake refs.
- **CLI behavior on native Windows:**
  - `winix check` and `winix apply --dry` should work.
  - `winix switch --dry` should print the command without `sudo` and with forward-slash flake refs (`path:D:/repo/...#host`).
  - Real `winix switch` should fail clearly until native Windows activation exists.
  - Real `winix update` should fail clearly because it requires the Nix CLI; users should run it from WSL, Linux, or macOS.
- **CLI behavior on WSL/Linux/macOS:**
  - `winix switch --dry` should keep POSIX paths (`path:/home/...#host`) and prefix `sudo` when not root.
  - NixOS and nix-darwin activation commands should remain unchanged outside native Windows.
- **When adding commands or backend output, test both path surfaces.**
  - Windows filesystem paths may contain `\`, drive letters, and spaces.
  - Nix paths and flake refs should use `/`.

## API Shape Rules

Use these rules when adding or reviewing Winix SDK helpers:

1. **Mirror the parent Nix namespace by default.** If a Nix option is pure config passthrough under `networking.*`, `boot.*`, `security.*`, etc., prefer one parent helper with an object: `nixos.networking({ firewall, nat })`, `nixos.boot({ loader, initrd })`, `nixos.security({ pam, sudo })`.
2. **Avoid root-level aliases for nested options.** Do not add helpers like `nixos.firewall()`, `nixos.networkmanager()`, or `nixos.nat()` unless the helper represents a major Winix concept rather than a shortcut to a nested Nix path.
3. **Use named helpers for keyed collections or awkward workflows.** Options like systemd units, launchd agents, Home Manager files, and OCI containers are keyed by name and verbose as raw objects, so helpers are justified.
4. **Put keyed helpers under the owning namespace when possible.** Prefer `nixos.systemd.service()`, `darwin.launchd.agent()`, and `nixos.virtualisation.ociContainer()` over unrelated root helpers.
5. **Keep justified ergonomic exceptions explicit.** Helpers like `nixos.sysctl()` are acceptable when the concept is commonly discussed independently from its Nix path (`boot.kernel.sysctl`), but document them as exceptions.

## How to Add a Feature

1. If it's a new SDK helper or type: edit `src/core/types.ts` + `src/sdk/index.ts`.
2. If it's evaluator logic: edit `src/evaluator/index.ts`. Add a test.
3. If it's Nix output: edit `src/backends/nix/index.ts`. Check with `--dry` on test-config.
4. If it's a CLI command: add to `src/cli/commands/` and register in `src/cli/index.ts`.
5. Update `ROADMAP.md` when completing tasks.
6. Update `test-config/winix.config.ts` if the change affects output.

## Testing

Standalone builds use Bun 1.4.0 (`npm run build:standalone`), producing Windows
and glibc Linux x64/ARM64 assets in `artifacts/`. The Windows build embeds the
Linux hashes, so release builds must build all targets in order. Runtime SDK
imports are virtual modules sharing the bundled evaluator's context; do not
load an independent SDK copy. Automatic npm installation is disabled.
Set `WINIX_STANDALONE_TEST_BINARY` to run `tests/standalone.test.ts` against a
compiled binary. WSL standalone setup verifies the release binary before
launching it through a private, pinned Nix runtime linker/library environment;
never test it by activating the shared machine.

```bash
npx vitest run                    # Unit tests
cd test-config && node --experimental-transform-types ../src/cli/index.ts apply --dry   # Integration
```

Native DSC integration tests are opt-in and require `dsc`, `winget`, and PowerShell 7
on PATH. In PowerShell, run
`$env:WINIX_DSC_INTEGRATION = '1'; npx vitest run tests\windows-shell.test.ts`.
They exercise temporary files/symlinks and uniquely named user environment values,
cleaned up afterward; symlink creation requires Developer Mode or elevation.

When touching CLI paths, activation, output layout, or npm scripts, also verify from native Windows and WSL when possible:

```bash
npm run check
npm test -- --run
npm run build
cd test-config
node --experimental-transform-types --no-warnings ../src/cli/index.ts check
node --experimental-transform-types --no-warnings ../src/cli/index.ts apply --dry
node --experimental-transform-types --no-warnings ../src/cli/index.ts switch --dry
```

## Spec

Design lives in `spec/`:
- `spec/SPEC.md` — Single source of truth for what Winix is and does (product, model, evaluation, API, CLI, escape hatches, security, agent DX).
- `spec/ARCHITECTURE.md` — Internals: evaluator passes, fragment graph, Nix code generation, file layout under `src/`.
- `spec/proposals/` — Forward-looking designs (e.g. Windows backend) that are not yet implemented.

## Current State

Working end-to-end: config → eval → Nix output → `nixos-rebuild test` successful.
See `ROADMAP.md` for what's done and what's next (prioritized).

## Don'ts

- Don't add classes or inheritance. Fragments are plain objects from plain functions.
- Don't add global registries. Fragment discovery is by import, not registration.
- Don't auto-convert camelCase to kebab-case for Nix option keys. Users write the actual Nix key name.
- Don't add runtime dependencies unless absolutely necessary.
