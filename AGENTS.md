# AGENTS.md — Winix

Instructions for AI coding agents (Copilot, Claude Code, Cursor, etc.) working on Winix.

## Project overview

Winix is a TypeScript-first configuration tool for Windows, NixOS, WSL and macOS.
Configs are composable TypeScript fragments:

- **Nix hosts** (NixOS, NixOS-WSL, nix-darwin, Home Manager): `winix.config.ts`
  → evaluator → Nix backend → `.winix/out/flake.nix` + host modules, applied by
  `nixos-rebuild`/`darwin-rebuild`.
- **Windows hosts**: evaluator → Windows backend → `.winix/out/<host>/resources.json`,
  checked against the machine and applied by Winix's own plan-then-apply executor.

## Architecture

```
src/
  core/types.ts             All core type definitions. Start here.
  sdk/index.ts              Authoring API: feature(), profile(), host(), platforms.*, workspace()
  evaluator/index.ts        Passes: collect IDs → resolve with context → deep merge
  helpers/                  home.*, nixos.*, darwin.*, windows.*, nix.* helpers
  backends/nix/             flake.nix + host modules
  backends/windows/         resources.json, lockfile, WSL provisioning and setup, fonts, feeds
  runtime.ts                Standalone-executable metadata (version, Linux assets, editor types)
  skill.ts                  What `winix --skill` prints for agents
  cli/
    index.ts                Entry point (parseArgs) and command dispatch
    loader.ts               Finds and imports winix.config.ts
    analysis.ts             Per-host fragment analysis (inspect, check warnings, conflicts)
    windows-plan.ts / windows-apply.ts / windows-state.ts   Windows plan, apply, ownership
    editor-types.ts         .winix/types for editors
    progress.ts / style.ts  Spinner and colours
    commands/               apply, check, switch (plan), update, inspect, init, bootstrap, scaffold, ...
scripts/                    bootstrap-windows.ps1, bootstrap-linux.sh, release and build scripts
```

## Key concepts

### Fragment pattern
Everything is a `Fragment | Fragment[]`. No inheritance, no classes. Just functions returning data. Bodies may also **declare by effect** through injected namespaces (`home.*`, `nixos.*`, `darwin.*`, `windows.*`), which auto-register without a return.

### Three helpers
Distinct roles: a **feature declares** config, a **profile groups** features, and a **host** is the target.
- `feature(id, callback)` — **declares** config. N per host. Has `.isActive`. The callback receives an injected context; it can declare by effect and/or return fragments.
- `profile(id, entries[])` — **groups** features. **Array of entries only** (instantiated features/profiles and bare fragments). No callback: passing one is a compile error and a runtime `TypeError`. Has `.isActive`. Results are marked `__group`, so `inspect --matrix` groups by profile and `check` does not warn about members that don't apply to a platform.
- `host(name, platform, entries[])` or `host(name, platform, callback)` — top-level target. Entries array **or** callback (effects + return). No `.isActive`.

Platforms are built through `platforms.*` (`platforms.nixos({...})`, `platforms.wsl({...})`, `platforms.darwin({...})`, `platforms.windows()`) and passed as a host's second argument; they expose `.isActive` too (`platforms.nixos.isActive`). `platforms.wsl()` is a NixOS variant (platform id `nixos`, context `variant: "wsl"`), so both `platforms.nixos.isActive` and `platforms.wsl.isActive` are true on WSL hosts. The CLI evaluates with `evaluate(workspace, { configDir })`; config-relative helpers (`home.symlink("./x")`, WSL setup `repository: "self"`) read it from the eval context.

### Context injection and effects
- `feature` and the callback form of `host` receive `{ home, nixos, darwin, windows, platforms }`. `nix`, `account`, and `overlay` are NOT injected (stay file-level imports).
- Declarations through an injected namespace **auto-register** (no return needed). Calling another `feature()`/`profile()` factory returns a lazy fragment that is **not** auto-collected and **must be returned** to compose it.
- The return forms (one fragment, array) still work; an effect-only callback returning nothing type-checks; a global (imported) `home.*` call is not auto-registered, so it must be returned.

### Lazy evaluation
`platform()` and `feature()` return `LazyFragment` descriptors. The evaluator:
1. **Pass 1:** scans descriptors to collect IDs, resolving composites recursively to find nested IDs.
2. **Pass 2:** sets the implicit context (`_ctx`), then calls `__resolve()` on each lazy fragment. `.isActive` getters read this context.
3. **Pass 3:** deep merges all resolved fragments (arrays append, objects merge, scalars last-wins).

`.isActive` uses a module-level `_ctx` (like React hooks); `withContext()` is the testing escape hatch.

## Conventions

- **All TypeScript, no Rust.** Single language stack.
- **ESM modules** with `.ts` extensions in imports (Node `--experimental-transform-types`).
- **Vitest** for tests: `npx vitest run`.
- **No build step** for development. Source runs directly via Node.
- **Fragment keys match Nix option names.** Use `"experimental-features"`, not `experimentalFeatures`; the backend never converts option keys.
- **Input names** use camelCase in TS (`nixosWsl`), converted to kebab-case for Nix (`nixos-wsl`).
- **Core npm workflows stay shell-independent.** `npm run check`, `npm test`, `npm run build` and `npm run clean` work from PowerShell/cmd, WSL, Linux and macOS. Use Node scripts, not `rm -rf`, `cp`, or `mkdir -p`.
- **Don't add runtime dependencies** unless absolutely necessary.

## Windows and WSL

The rules and guarantees are in `spec/SPEC.md` §9 (Windows backend); usage is in `docs/reference/windows/` and `docs/reference/wsl.md`, with the model in `docs/concepts/`. The essentials when changing this code:

- **Plan, then apply.** Every resource has a test and a set; `winix plan` (= `switch --dry`) reports what differs, `switch` applies only that. Elevated work is batched into one UAC prompt. Package inventory is one `winget export` per switch (DSC confirms what it doesn't list), reused by the plan, activation and reconciliation.
- **Handles and order.** Resource helpers return handles accepted by `dependsOn`; cross-host handles are an error.
- **Locks.** Packages, PowerShell modules, fonts, NixOS-WSL images and WSL setup commits are pinned in `winix-windows.lock`. `version: "any"` packages are presence-only and never locked. Dry runs and `--offline`/`--locked` never write pins.
- **Ownership.** Only resources Winix created are removed when their declaration goes away; adopted or pre-existing ones are never touched. Losing state never infers deletion rights. Removals need confirmation (or `--yes`).
- **Files.** Differing targets move to `.bak` by default (`backup: !force`); sources are config-directory-relative.
- **WSL safety.** Provisioning never restarts Windows, shuts down WSL, replaces or unregisters a distro, or deletes distro data. A distro declaration creates an absent distro or adopts a matching one (WSL 2, NixOS, expected hostname); adopted distros never run setup.
- **WSL setup** runs once (resumable on failure, never resets dirty checkouts). Afterwards the distro is managed from inside WSL; a later change to the setup declaration only prints a note. Keep fingerprints of existing setups byte-identical; inferred refs (`repository: "self"`) are excluded from the fingerprint.
- **Standalone executables** embed one SDK/evaluator instance (virtual `@adrifer/winix` module); never load an independent SDK copy. The `winix` command runs the checkout's pinned release, downloading and verifying it on Windows and Linux (NixOS through a pinned Nix loader); `node_modules` never changes what it runs, `WINIX_SDK` does explicitly.

### Paths and platforms
- **Separate filesystem paths from generated Nix paths.** Use `node:path` for real filesystem paths; `node:path.posix` or explicit POSIX formatting for generated Nix paths. Never let Windows backslashes leak into generated Nix files or flake refs.
- **On native Windows:** `check`, `apply`, `plan` and `switch` work for Windows hosts; for Nix hosts, `switch --dry` prints the command without `sudo` and with forward-slash flake refs (`path:D:/repo/...#host`), and real activation or `winix update` (Nix CLI) fails clearly.
- **On WSL/Linux/macOS:** `switch --dry` keeps POSIX paths (`path:/home/...#host`) and prefixes `sudo` when not root.
- **Test both path surfaces** when adding commands or output: Windows paths may contain `\`, drive letters and spaces; Nix paths and flake refs use `/`.

## API shape rules

Use these rules when adding or reviewing SDK helpers:

1. **Mirror the parent Nix namespace by default.** For pure config passthrough under `networking.*`, `boot.*`, `security.*`, etc., prefer one parent helper with an object: `nixos.networking({ firewall, nat })`, `nixos.boot({ loader, initrd })`.
2. **Avoid root-level aliases for nested options** (`nixos.firewall()`, `nixos.nat()`) unless the helper is a major Winix concept.
3. **Use named helpers for keyed collections or awkward workflows** (systemd units, launchd agents, Home Manager files, OCI containers).
4. **Put keyed helpers under the owning namespace**: `nixos.systemd.service()`, `darwin.launchd.agent()`, `nixos.virtualisation.ociContainer()`.
5. **Keep justified ergonomic exceptions explicit** (`nixos.sysctl()` for `boot.kernel.sysctl`), and document them.

## How to add a feature

1. New SDK helper or type: `src/core/types.ts` + `src/sdk/index.ts` (or `src/helpers/`).
2. Evaluator logic: `src/evaluator/index.ts`, with a test.
3. Nix output: `src/backends/nix/`; Windows output: `src/backends/windows/`. Check with `apply --dry` on `test-config/`.
4. A CLI command: `src/cli/commands/`, registered in `src/cli/index.ts`.
5. Document it (below), and add a CHANGELOG entry for user-visible changes.

## Testing

```bash
npm run check
npx vitest run
npm run build
cd test-config && node --experimental-transform-types --no-warnings ../src/cli/index.ts check
```

- Standalone builds use Bun 1.4.0 (`npm run build:standalone`, which runs `npm run build` first for the embedded editor types). The Windows build embeds the Linux hashes, so release builds build all targets in order. `WINIX_STANDALONE_TEST_BINARY=<path>` runs `tests/standalone.test.ts` against a compiled binary (CI does this on Linux and Windows).
- Native DSC integration tests are opt-in and need `dsc`, `winget` and PowerShell 7: in PowerShell, `$env:WINIX_DSC_INTEGRATION = '1'; npx vitest run tests\windows-shell.test.ts`. Symlink cases need Developer Mode or elevation.
- Never test activation, bootstrap or WSL setup on the shared machine; use dry runs, temporary directories and mocks.
- When touching CLI paths, activation, output layout or npm scripts, verify from native Windows and WSL when possible.

## Docs

- `README.md` is the front door: pitch, quick start, layout, links. Keep it short.
- `docs/` is organised as the reader's path: `start/` (introduction, install, first config, new machine), `concepts/` (the model, explained once), `guides/` (task recipes) and `reference/` (every helper and option; Windows split by topic in `reference/windows/`). Explain an idea in its concept page and link to it, rather than repeating it in reference pages. Every page needs `title` and `description` front matter, and `sidebar.order` for its place in the section.
- `site/` renders `docs/` as the documentation site (Starlight, its own `package.json`; see `site/README.md`). Keep pages plain Markdown with relative `.md` links so they also read on GitHub; the site rewrites them, and its build fails on a broken link.
- Guide code is quoted from `examples/cross-platform` (machines/ → roles/ → features/); `tests/cross-platform-example.test.ts` evaluates and generates it, with a Nix snapshot. Change the example and the guides together, and keep the example small.
- `src/skill.ts` is what agents read (`winix --skill`); update it with user-facing CLI or authoring changes.
- `CHANGELOG.md` records shipped changes; `ROADMAP.md` holds what's next and ideas.

## Spec

- `spec/SPEC.md` — the contract: model, merge semantics, Windows backend rules (§9), CLI, security, agent DX.
- `spec/ARCHITECTURE.md` — internals: evaluator passes, fragment lifecycle, backends, file layout.
- `spec/proposals/` — designs for big changes before they are built (none open).

## Don'ts

- Don't add classes or inheritance. Fragments are plain objects from plain functions.
- Don't add global registries. Fragment discovery is by import, not registration.
- Don't auto-convert camelCase to kebab-case for Nix option keys.
- Don't add runtime dependencies unless absolutely necessary.
