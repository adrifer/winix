# Winix architecture

> **Audience:** Winix maintainers and coding agents working on the
> implementation. End-user authoring is documented in [`SPEC.md`](./SPEC.md).

## 1. Overview

Winix is a pure TypeScript pipeline that turns user-authored fragments into
Nix code, then delegates activation to the platform's native tools:

```text
winix.config.ts (user)
      │
      ▼
  SDK (platform, feature, host, workspace)
      │  registers nodes in the dendritic graph
      ▼
  Evaluator (two-pass)
      │  resolves fragments → in-memory IR
      ▼
  Backend (nix)
      │  generates flake.nix + host modules
      ▼
  .winix/out/  (flake.nix, hosts/*.nix, modules/*.nix)
      │
      ▼
  nixos-rebuild / darwin-rebuild / home-manager  (winix switch only)
```

There is **no IPC boundary**. The CLI, evaluator, SDK, helpers, and backend
all run in one TypeScript process (Node ≥ 22 with native TS via
`--experimental-strip-types`).

## 2. Module layout

```text
src/
├── index.ts                  # public package barrel (@adrifer/winix)
├── core/
│   ├── types.ts              # All public type definitions (Fragment, Host, ...)
│   └── index.ts
├── sdk/
│   └── index.ts              # platform(), feature(), host(), workspace()
├── helpers/
│   ├── nixos.ts              # nixos(), nixos.program(), nixos.service(), ...
│   ├── darwin.ts             # darwin(), darwin.homebrew(), darwin.launchd, ...
│   ├── home.ts               # home(), home.program(), home.service(), ...
│   ├── account.ts            # account.user(), account.group()
│   ├── platforms.ts          # platforms.nixos(), platforms.darwin(), ...
│   ├── nix.ts                # nix.raw(), nix.pkg(), nix.script, ...
│   ├── overlay.ts            # overlay()
│   ├── options.ts            # typed options merge helpers
│   ├── utils.ts
│   └── index.ts
├── evaluator/
│   └── index.ts              # two-pass evaluator
├── backends/
│   └── nix/
│       └── index.ts          # IR → Nix string emission
└── cli/
    ├── index.ts              # CLI entry point (parseArgs)
    ├── loader.ts             # locates and imports winix.config.ts
    ├── run.ts                # subcommand dispatcher
    ├── activation.ts         # nixos-rebuild / darwin-rebuild invocation
    ├── analysis.ts           # diagnostic formatting
    ├── types-gen/            # internal support for type generation scripts
    └── commands/
        ├── init.ts
        ├── check.ts
        ├── apply.ts
        ├── switch.ts
        ├── inspect.ts
        └── update.ts
```

### Layering rules

- `core` depends on nothing.
- `sdk` and `helpers` depend on `core` only.
- `evaluator` depends on `core`.
- `backends/*` depend on `core` and the evaluator's in-memory IR.
- `cli` depends on everything else.
- Helpers must **never** call into the evaluator or the CLI.

## 3. Fragment lifecycle

A user fragment goes through four stages:

| Stage | Performed by | Output |
|---|---|---|
| **Authored** | User code | `Fragment` object or `LazyFragment` thunk |
| **Registered** | SDK constructors (`feature()`, `host()`, …) | Node in the dendritic graph |
| **Materialized** | Evaluator pass 1 | Concrete value tree per node |
| **Merged** | Evaluator pass 2 | Per-host in-memory IR |
| **Emitted** | Nix backend | Files in `.winix/out/` |

### LazyFragment

`feature(id, factory)` does **not** call `factory` at registration time. It
stores `factory` and a stable id. The evaluator invokes each factory exactly
once per host during pass 1, allowing fragments to be reused across hosts
without duplicating expensive computation per call.

### Stable IDs

Resource IDs are derived from `(importPath, exportName)`. Renaming an export
is a breaking change for downstream resource references; this is intentional —
agents can find every reference with grep, and provenance diagnostics quote the
exact path.

## 4. Evaluator

The evaluator runs in two passes per host. Both passes are pure: they never
write files or touch the system.

### Pass 1: materialize

For each host:

1. Resolve the host's `platform` baseline to its underlying `LazyFragment`.
2. Walk the host's fragment list. For each lazy fragment, call its factory.
3. Recursively materialize nested fragments (`feature` factories may return
   other fragments).
4. Annotate every materialized fragment with provenance
   (`{ source, importPath, exportName, branchPath }`).

The result is a list of fully materialized fragments per host, each tagged
with provenance.

### Pass 2: merge

Materialized fragments are merged into the host's IR using the rules in
`SPEC.md` § 5.2:

| Type | Strategy |
|---|---|
| Scalars (string, number, boolean) | last-wins, with a diagnostic when types collide |
| `string[]` | append, then dedupe preserving first occurrence |
| `Record<string, T>` | recursive deep merge |
| `null` / `undefined` | skip |

When a scalar is overwritten, the evaluator records a `conflict` diagnostic
with both source files. Conflicts are warnings by default and errors under
`winix check --strict`.

`override(value)` and `force(value)` are marker wrappers. The merger detects
them and lowers them to `lib.mkForce` / `lib.mkDefault` at the Nix backend
boundary.

### In-memory IR

The IR is **not** serialized to JSON in v1. It is a TypeScript object that
lives in process memory:

```ts
interface HostIR {
  name: string;
  platform: PlatformId;       // "nixos" | "darwin" | "homeManager"
  resources: ResourceTree;    // nested record matching backend option paths
  provenance: ProvenanceMap;  // resourceId → source file(s)
  diagnostics: Diagnostic[];
}
```

`ResourceTree` is the merged shape under the platform's namespace
(`nixos`, `home-manager`, `darwin`, …). The Nix backend walks this tree.

If a stable on-disk IR is ever needed (CI diffing, external tools), it can
be added without changing the in-memory representation.

## 5. Nix backend

Located in `src/backends/nix/`. Responsible for:

1. Emitting `flake.nix` with the workspace's inputs.
2. Emitting one module per host under `hosts/`.
3. Emitting shared modules under `modules/` when fragments are reused.
4. Writing `flake.lock` (preserved across runs when present).
5. Embedding provenance comments so generated lines can be attributed back
   to their source fragment.

### Generated `flake.nix` shape

```nix
# Generated by Winix. Do not edit by hand.
{
  description = "Winix workspace";
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.05";
    home-manager.url = "github:nix-community/home-manager/release-25.05";
    # ...user-declared inputs...
  };
  outputs = { self, nixpkgs, home-manager, ... }@inputs:
    let
      lib = nixpkgs.lib;
    in {
      nixosConfigurations = {
        wsl-work = lib.nixosSystem {
          system = "x86_64-linux";
          modules = [ ./hosts/wsl-work.nix ];
        };
        # ...
      };
      darwinConfigurations = { /* nix-darwin hosts */ };
      homeConfigurations = { /* home-manager-only hosts */ };
    };
}
```

### Generated host module shape

```nix
# Generated by Winix from:
#   workspace: ./winix.config.ts
#   host: wsl-work
{ config, pkgs, lib, inputs, ... }:
{
  imports = [
    inputs.nixos-wsl.nixosModules.default
    # ...
  ];

  # Source: features/git.ts (export "git")
  programs.git.enable = true;
  programs.git.userName = "Adrian Fernandez Garcia";

  # Source: features/zsh.ts (export "zsh")
  programs.zsh.enable = true;
  # ...
}
```

Provenance comments are stable: agents can diff generated output and
attribute each line to a source fragment.

### Output structure

```text
.winix/out/
├── flake.nix
├── flake.lock          # preserved if it already exists
├── hosts/
│   ├── wsl-work.nix
│   └── macbook-pro.nix
└── modules/
    └── shared/        # only when fragments dedupe to a shared module
```

`.winix/out/` is **fully regenerated** on every `apply`. Manual edits are
overwritten. The directory is gitignored by default; users can commit it for
CI scenarios that want a deterministic snapshot.

### Determinism

The backend sorts:

- Imports lexicographically.
- Top-level option keys lexicographically.
- Package lists alphabetically.

This guarantees that the same fragment list produces byte-identical Nix
between runs (modulo provenance comments, which depend on import paths and
are therefore also stable for an unchanged workspace).

## 6. CLI

All commands share the same loader:

1. `loader.ts` walks up from `cwd` to find `winix.config.ts`.
2. It imports the workspace (`workspace({ inputs, hosts: [...] })`) via
   `--experimental-strip-types`.
3. The evaluator runs against the workspace.
4. The subcommand decides what to do with the resulting IR.

### Command roles

| Command | Reads workspace? | Writes files? | Touches system? |
|---|---|---|---|
| `init` | No | yes (`winix.config.ts`, `package.json`, …) | No |
| `check` | Yes | No | No |
| `apply` | Yes | yes (`.winix/out/**`) | No |
| `switch` | Yes | yes (`.winix/out/**`) | **Yes** (nixos-rebuild / darwin-rebuild) |
| `inspect` | Yes | No | No |
| `update` | Yes | yes (`flake.lock`) | runs `nix flake update` as a subprocess |

### `winix switch` activation

`switch` is the only command that mutates the system. It calls
`activation.ts` which:

1. Runs `apply` to refresh `.winix/out/`.
2. Validates Nix can see all required files (Git staging check).
3. Invokes the platform tool:
   - NixOS → `sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#<host>`
   - Darwin → `sudo darwin-rebuild switch --flake path:$(pwd)/.winix/out#<host>`
   - Home Manager only → `home-manager switch --flake path:$(pwd)/.winix/out#<host>`
4. Streams stderr/stdout transparently so users see the underlying tool's
   output unchanged.

If activation fails, Winix exits with the underlying tool's exit code and
prints a one-line hint pointing at the relevant log.

## 7. Testing strategy

- Unit tests (vitest) for each helper, evaluator pass, and backend emitter.
- Snapshot tests for generated Nix using `examples/reference/`.
- CLI smoke tests under `tests/cli.test.ts` that invoke commands via the
  exported `run(argv)` API (no child processes for speed).
- End-to-end tests run `winix check` and `winix apply` against the reference
  examples and diff generated output.

The reference workspace under `examples/reference/` doubles as the
conformance fixture: any new feature should add or update an example there
and update its golden snapshot.

## 8. Versioning and releases

- Public package: `@adrifer/winix` on npm.
- SemVer; pre-release tags are `vX.Y.Z-preview.N`.
- Release script: `scripts/release.mjs` (`stable | preview | --dry-run`).
- GitHub Releases are auto-generated from labeled PRs via
  `.github/release.yml`.
- The init command pins the user's installed Winix version into the
  scaffold's `package.json` so `winix init` and the resulting workspace are
  always version-consistent.

Breaking changes are signalled by a major bump and called out in the release
notes' "💥 Breaking changes" section.
