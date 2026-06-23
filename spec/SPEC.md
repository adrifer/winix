# Winix Specification

> **Status:** Living spec for what Winix **is and does today**.
> Anything aspirational or unimplemented lives in [`proposals/`](./proposals/).
> Internal implementation details (evaluator passes, fragment graph, code generation)
> live in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Table of contents

1. [Product](#1-product)
2. [Glossary](#2-glossary)
3. [Core model: fragments](#3-core-model-fragments)
4. [Composition: dendritic graph](#4-composition-dendritic-graph)
5. [Evaluation semantics](#5-evaluation-semantics)
6. [Authoring API](#6-authoring-api)
7. [Curated helpers](#7-curated-helpers)
8. [Escape hatches](#8-escape-hatches)
9. [CLI](#9-cli)
10. [Quality requirements](#10-quality-requirements)
11. [Security](#11-security)
12. [Agent DX](#12-agent-dx)

## 1. Product

Winix is a TypeScript-first system configuration tool that generates Nix
(NixOS, nix-darwin, Home Manager) from composable TypeScript fragments. It
gives users a single mental model for declaring Linux, macOS, NixOS,
nix-darwin, WSL, and LXC machines without giving up Nix-level reproducibility.

### Primary users

- People with existing NixOS, nix-darwin, Home Manager, or dotfiles setups.
- People who want one consistent way to describe several machines.
- Humans and coding agents editing system specs over time.

### Design priorities

1. **TypeScript-first DX.** Strongly typed, IDE-friendly, autocomplete on every
   option.
2. **Agent-friendly.** Explicit, searchable, safe to edit, deterministic.
3. **Dendritic composition.** Shared roots branch into platforms, users,
   features, and hosts. No directory scanning.
4. **Native backend leverage.** Generate Nix; let `nixos-rebuild` /
   `darwin-rebuild` / Home Manager do what they already do well.
5. **Clear diagnostics.** Provenance, dry-runs, plans, JSON outputs.
6. **No system mutation during evaluation.** TypeScript only emits intent.

### Non-goals for v1

- Replacing Nix evaluation or the NixOS module system.
- A GUI.
- Managing remote fleets.
- Hiding all platform-specific behavior.
- Allowing TypeScript specs to mutate the system directly.

## 2. Glossary

| Term | Meaning |
|---|---|
| **Workspace** | A Winix project rooted at a `winix.config.ts` file. |
| **Host** | A concrete machine target (e.g. `wsl-work`, `macbook-pro`). |
| **Platform** | The system base for a host (e.g. NixOS, nix-darwin). Exactly one per host. |
| **Feature** | A reusable configuration concern (e.g. Git, shells, editors, WSL). N per host. |
| **Profile** | A reusable bundle of fragments grouped for convenience (e.g. `developer`). |
| **Fragment** | The core building block: a pure function returning a `Fragment` object. |
| **Lazy fragment** | A `platform()` / `feature()` descriptor with `.isActive` and deferred resolution. |
| **Account** | A user or group declaration (`account.user()`, `account.group()`). |
| **Helper** | A first-party fragment factory (`nixos.*`, `home.*`, `darwin.*`, `account.*`). |
| **Escape hatch** | A way to inject raw backend code when no typed helper exists. |
| **Backend** | The adapter that lowers fragments into a target system (today: Nix). |

## 3. Core model: fragments

Everything in Winix is a **fragment**: a pure function returning configuration
data. There is no inheritance, no classes, no plugin system. The contract is:

```ts
(...args: unknown[]) => Fragment | Fragment[]
```

A `Fragment` is a plain object describing contributions to one or more scopes:

```ts
interface Fragment {
  nixos?: NixosOptions;        // generated NixOS module options
  homeManager?: HomeOptions;   // generated Home Manager module options
  darwin?: DarwinOptions;      // generated nix-darwin module options
}
```

A host is just a name, a platform, and a flat list of fragments:

```ts
host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
  account.user("adrifer", () => ({ admin: true, shell: "zsh" }))(),
  wsl(),
  workSysctl(),
  nixos.packages("socat", "bubblewrap"),
]);
```

The evaluator resolves where each fragment's data belongs based on its return
value. Users never think about Nix module paths directly; they describe intent.

### Three helpers, one mental model

| Helper | Purpose | Count per host | Has `.isActive` |
|---|---|---|---|
| `platform(id, factory)` | System base (NixOS, darwin) | exactly 1 | yes |
| `feature(id, factory)` | Anything else | 0..N | yes |
| `host(name, platform, fragments[])` | Top-level target | — | no |

`platform()` and `feature()` return **lazy fragments**: descriptors that defer
their factory until evaluation knows the host context. This is what makes
`feature.isActive` work regardless of fragment order in the host list.

## 4. Composition: dendritic graph

Winix prefers a dendritic model: configuration grows from shared roots into
branches and leaves instead of being organized only by host.

```text
                 inputs / platforms (roots)
                    │
        ┌───────────┼──────────────┐
        │           │              │
     account     features      profiles
        │           │              │
        └─────┬─────┴──────────────┘
              │
            hosts (leaves)
```

### Principles

- Cross-cutting concerns live together (one Git fragment, used by N hosts).
- Hosts compose fragments rather than duplicate configuration.
- Platform differences are explicit via `feature.isActive` / `platform.isActive`.
- Accounts (users, groups) and features are first-class fragments.
- All composition is via **explicit TypeScript imports**. No directory scanning.

### Anti-patterns

- Hidden global registries.
- Implicit filesystem scanning as the main composition mechanism.
- Mutation-heavy builders.
- Host files that duplicate shared concerns.
- Platform-specific behavior hidden behind vague names.

### Sharing fragments across hosts

Plain TS array spreads. No helper needed.

```ts
const adrifer = account.user("adrifer", () => ({ shell: "zsh" }));
const base = [adrifer(), developer()];

host("wsl-work", platforms.nixos(), [...base, wsl(), workSysctl()]);
host("wsl-personal", platforms.nixos(), [...base, wsl()]);
```

## 5. Evaluation semantics

Evaluation turns fragments into normalized data ready for the Nix backend.
For internal evaluator passes and IR shape, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Merge model

Fragments are merged in **list order** (later wins for scalar conflicts).
Strategy depends on value type:

| Value type | Default strategy | Behavior |
|---|---|---|
| `string`, `number`, `boolean` | Last wins | Later fragment overwrites earlier (with a warning) |
| `string[]` (packages, paths, imports) | Append + dedupe | Lists concatenate, duplicates removed |
| `Record<string, T>` | Deep merge | Objects merge recursively |
| `null` / `undefined` | Skip | Does not participate |

```text
Fragment 1     Fragment 2     Fragment 3     Result
──────────────────────────────────────────────────────────
pkg: [a]       pkg: [b]       pkg: [c]    →  pkg: [a, b, c]       (append)
sysctl: {x:1}  sysctl: {y:2}              →  sysctl: {x:1, y:2}   (deep merge)
user: "foo"    user: "bar"                →  user: "bar" ⚠         (last wins + warn)
```

### Default strategy by option kind

| Option kind | Default strategy | Rationale |
|---|---|---|
| packages / imports | `append` | Multiple fragments accumulate |
| services / programs | `deep merge` | Different fragments contribute different settings |
| files / symlinks / dotfile links | `deny-merge` | Two fragments writing the same path is almost always a bug |
| environment variables | `set (last wins)` | One value per variable |
| PATH entries | `append` | Multiple paths accumulate |
| shell aliases | `set (last wins)` | One definition per alias name |
| shell init snippets | `append` | Shell init concatenates |
| sysctl / kernel params | `deep merge` | Different fragments tune different params |
| boolean enable flags | `set (last wins)` | A single on/off state |

### Conflict detection

A **conflict** is two fragments setting the same scalar path to different
values. Default behavior: last wins + warning. With `winix check --strict`,
scalar conflicts are errors unless resolved with `override()`.

A conflict diagnostic must report:

- Option path
- Conflicting values
- Source fragments (file + line)
- Winner (which fragment is later in the list)
- Suggested resolution (`override()` or reorder)

### Merge modifiers

| Modifier | Effect |
|---|---|
| `override(value)` | Declare an intentional override; silences the conflict warning. |
| `prepend(items)` | Add to the front of a list. |
| `replace(items)` | Discard previous list contents, use only these. |
| `without(items)` | Remove items from the accumulated list. |
| `force(value)` | Nuclear option: ignore all other values for this path. |

### Determinism

Evaluation must not depend on wall-clock time, network calls, random values,
host-specific ambient state, or mutable global registries unless explicitly
modeled as inputs. Same fragment list → same output, always.

## 6. Authoring API

### Workspace and inputs

Inputs (flake dependencies) live in their own leaf module to avoid circular
imports. They use `defineInputs` / `input`:

```ts
// inputs.ts
import { defineInputs, input } from "@adrifer/winix";

export const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});
```

The workspace config wires inputs and hosts together:

```ts
// winix.config.ts
import { workspace, host, platforms } from "@adrifer/winix";
import { inputs } from "./inputs";
import { wsl } from "./fragments/wsl";

export default workspace({
  inputs,
  hosts: [
    host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
      wsl({ defaultUser: "adrifer" }),
    ]),
  ],
});
```

Simple inputs are a URL string; inputs with `follows` or extra options use
`input()`. Input names in camelCase auto-convert to kebab-case for Nix
(`nixosWsl` → `nixos-wsl`). Override with explicit `nixName` when needed.

### Fragment shape

```ts
import { type Fragment } from "@adrifer/winix";

export function workSysctl(): Fragment {
  return {
    nixos: {
      boot: { kernel: { sysctl: { "fs.inotify.max_user_watches": 1048576 } } },
    },
  };
}
```

A fragment may target multiple scopes at once:

```ts
export function wsl(opts?: WslOpts): Fragment {
  return {
    nixos: {
      wsl: { enable: true, ...opts },
      packages: ["wl-clipboard"],
      programs: { nixLd: { enable: true } },
    },
    homeManager: {
      home: { packages: ["wslu"], sessionVariables: { BROWSER: "wslview" } },
    },
  };
}
```

### Type-safe `.isActive` checks

Conditions use imported objects, never magic strings.

```ts
import { wsl } from "./fragments/wsl";
import { docker } from "./fragments/docker";

// All type-safe, autocomplete-friendly:
nixos.isActive   // is this host NixOS?
wsl.isActive     // does this host have WSL?
docker.isActive  // does this host have Docker?
```

`.isActive` is independent of list order. A fragment can check `wsl.isActive`
whether `wsl()` appears before or after it in the host list.

### Third-party extensibility

No plugin system, no hooks. The contract is just: **export a function that
returns `Fragment | Fragment[]`**.

```ts
// npm: winix-fragment-tailscale
import { feature } from "@adrifer/winix";

export const tailscale = feature("tailscale", (opts?: { exitNode?: boolean }) => ({
  nixos: { services: { tailscale: { enable: true, ...opts } } },
}));
```

Used like any first-party fragment:

```ts
import { tailscale } from "winix-fragment-tailscale";

host("server", platforms.nixos(), [
  tailscale({ exitNode: true }),
]);
```

Fragments created with `feature()` automatically get `.isActive`.

## 7. Curated helpers

First-party helpers wrap common NixOS, Home Manager, and nix-darwin patterns.
Users can always drop down to plain fragment objects for anything not covered.

### Design rules

1. Helpers return `Fragment` or `LazyFragment` and compose like any other fragment.
2. **Mirror the parent Nix namespace by default.** Use
   `nixos.networking({ firewall, nat })`, not `nixos.firewall()`. Avoid
   root-level aliases for nested options.
3. **Named helpers for keyed collections or awkward workflows.** Things like
   systemd units, launchd agents, Home Manager files, and OCI containers are
   keyed by name and verbose as raw objects, so a helper earns its keep.
4. **Opinionated but overridable.** `home.program("git")` injects `enable: true`
   by default; explicit `enable: false` always wins.
5. **No hidden key conversion.** Option keys are passed through as written
   (use `"experimental-features"`, not `experimentalFeatures`).

### `nixos.*` and `darwin.*`

Platform helpers. The namespace is callable for typed option objects; methods
cover common patterns; `.raw()` is reserved for raw Nix strings.

```ts
nixos({ networking: { hostName: "wsl" } })
nixos.imports("inputs.nixos-wsl.nixosModules.default")
nixos.program("nix-ld", { libraries: nix.withPkgs(["icu", "zlib"]) })
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })
nixos.packages("ripgrep", "fd", "jq")
nixos.nix({ gc: { automatic: true, dates: "weekly" } })
nixos.boot({ kernelModules: ["tcp_bbr"] })
nixos.networking({ firewall: { allowedTCPPorts: [80, 443] } })
nixos.environment({ systemPackages: ["vim"], variables: { EDITOR: "vim" } })
nixos.users({ users: { root: { shell: nix.pkg("bash") } } })
nixos.system({ stateVersion: "25.05" })
nixos.i18n({ defaultLocale: "en_US.UTF-8" })
nixos.time({ timeZone: "America/Los_Angeles" })
nixos.fonts({ packages: ["noto-fonts"] })
nixos.security({ rtkit: { enable: true } })
nixos.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" })
nixos.sysctl({ "fs.inotify.max_user_watches": 1048576 })
nixos.systemd.service("backup", { script: nix.script`echo backup` })
nixos.raw("environment.variables.FOO = \"bar\";")

darwin({ homebrew: { enable: true } })
darwin.imports("inputs.nix-homebrew.darwinModules.nix-homebrew")
darwin.program("zsh")
darwin.service("some-agent")
darwin.packages("mas")
darwin.nix({ gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } } })
darwin.homebrew({ enable: true, casks: ["visual-studio-code"] })
darwin.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] } })
darwin.defaults({ dock: { autohide: true } })
darwin.raw("system.activationScripts.example.text = \"echo hello\";")
```

Program and service helpers inject `enable: true` by default; explicit `enable`
in `opts` always wins.

### `home.*` (Home Manager)

```ts
home({ programs: { git: { enable: true } } })
home.program("git", { userName: "Adri", userEmail: "adri@example.com" })
home.program("fzf", { enableZshIntegration: true })
home.service("syncthing", { tray: true })
home.env({ EDITOR: "nvim", BROWSER: "wslview" })
home.path("$HOME/.local/bin", "$HOME/go/bin")
home.packages("neovim", "ripgrep")
home.files({ ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv") })
home.configFile("nvim/init.lua", { text: "vim.o.number = true" })
home.imports("inputs.hunk.homeManagerModules.default")
home.activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })
home.raw("programs.zsh.initExtra = ''echo raw'';")
```

Notes:

- Garbage collection lives on the platform: use `nixos.nix({ gc })` or
  `darwin.nix({ gc })`.
- `home()` accepts typed Home Manager options; `home.raw()` accepts raw Nix only.
- `home.program(name)` writes to `homeManager.programs.<name>`;
  `home.service(name)` writes to `homeManager.services.<name>`. Both add
  `enable: true` by default.

### `account.user()` / `account.group()`

```ts
const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

const media = account.group("media", () => ({
  members: [adrifer, "jellyfin"],
}));

host("wsl-work", platforms.nixos(), [adrifer(), media()]);
```

Options:

```ts
interface AccountOpts {
  admin?: boolean;
  shell?: string | PackageRef;
  homeDirectory?: string;
  stateVersion?: string;
  sessionVariables?: Record<string, string>;
  groups?: string[];
  extraGroups?: string[];
  uid?: number;
  wslDefault?: boolean;
}
```

`account.user()` and `account.group()` return factories like `feature()` and
`profile()`. Invoke once to create a lazy fragment instance.

## 8. Escape hatches

Escape hatches let users express backend-specific behavior before a typed
abstraction exists. They provide a gradual migration path: start with raw Nix,
convert to typed fragments over time.

### Three levels

#### Level 1: `nixos.raw()` / `home.raw()` / `darwin.raw()`

Inline raw Nix for quick hacks or things that don't fit any typed fragment.

```ts
host("wsl-work", platforms.nixos(), [
  wsl(),
  nixos.raw(`
    environment.interactiveShellInit = ''
      win_home="$(wslpath -w "$HOME")"
      win_user="\${win_home##*/}"
      export PATH="$PATH:/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
    '';
  `),
]);
```

`.raw()` accepts raw Nix strings only. Typed option objects use the callable
helpers (`nixos({...})`, `home({...})`, `darwin({...})`).

#### Level 2: `rawModule(path)` — existing `.nix` files

For migration: reference an existing Nix module file without rewriting it.

```ts
import { rawModule } from "@adrifer/winix";

host("wsl-work", platforms.nixos(), [
  rawModule("./legacy/vscode-path.nix"),
  rawModule.homeManager("./legacy/zsh-extras.nix"),
  // Typed fragments for everything else:
  developer(),
  workSysctl(),
]);
```

Variants: `rawModule(path)` (NixOS), `rawModule.homeManager(path)`,
`rawModule.darwin(path)`. The path is workspace-relative and the file is
included as-is in the generated output.

#### Level 3: `nix.expr()` — inline Nix within typed fragments

For when 90% of a fragment is typed but one value needs a Nix expression.

```ts
import { nix } from "@adrifer/winix";

export function wsl(opts?: WslOpts): Fragment {
  return {
    homeManager: {
      programs: { zsh: { initContent: nix.expr(`
        export BROWSER=wslview
        keep_current_path() {
          printf "\\e]9;9;%s\\e\\\\" "$(wslpath -w "$PWD")"
        }
        precmd_functions+=(keep_current_path)
      `) } },
    },
  };
}
```

`nix.expr()` marks a value as a Nix literal. The compiler emits it verbatim
without quoting. Narrower helpers (`nix.pkg()`, `nix.str()`, `nix.script()`,
`nix.lib.*`) are preferred when they fit.

### Diagnostics

The compiler warns (not errors) on escape hatch use, to encourage migration:

```
⚠ wsl.ts:15 — nix.expr() used in home.programs.zsh.initContent
  Consider extracting to a typed fragment when stable.

⚠ winix.config.ts:8 — rawModule("./legacy/vscode-path.nix")
  2 raw modules remain. Run `winix migrate` for conversion suggestions.
```

### Design principles

- Every escape hatch is a fragment (same shape, same composition model).
- Escape hatches are never silently ignored.
- Unsupported escape hatches fail during planning.
- Raw code never runs during TypeScript evaluation.
- Source provenance is always tracked.

## 9. CLI

The CLI owns evaluation orchestration, validation, generation, activation, and
diagnostics. For internal command implementation, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Commands

#### `winix init`

Scaffold a new Winix project. Creates `winix.config.ts`, `tsconfig.json`,
`package.json` (with `@adrifer/winix` pinned to the current installed
version), and `.gitignore`.

```bash
npx @adrifer/winix init
```

#### `winix check`

Typecheck the workspace and validate fragments without side effects.

```bash
winix check
winix check --json     # machine-readable diagnostics
winix check --strict   # scalar conflicts are errors, not warnings
```

#### `winix apply`

Generate backend output files into `.winix/out/` (gitignored by default).

```bash
winix apply                   # generate all hosts
winix apply --host wsl-work   # generate a single host
winix apply --dry             # print what would be generated, no writes
```

Output structure:

```text
.winix/
  out/
    flake.nix
    flake.lock
    hosts/
      wsl-work.nix
      macbook-pro.nix
```

#### `winix switch`

Generate and activate (apply + system rebuild).

```bash
winix switch                  # apply + nixos-rebuild switch (or darwin-rebuild)
winix switch --host wsl-work  # single host
```

Equivalent to:

```bash
winix apply && sudo nixos-rebuild switch --flake path:$(pwd)/.winix/out#<host>
```

Activation by platform:

| Platform | Activation command |
|---|---|
| NixOS | `sudo nixos-rebuild switch --flake .winix/out` |
| nix-darwin | `sudo darwin-rebuild switch --flake .winix/out` |
| Home Manager only | `home-manager switch --flake .winix/out` |

#### `winix inspect`

Introspection for debugging and agent consumption.

```bash
winix inspect host wsl-work          # what composes this host
winix inspect host wsl-work --json   # machine-readable
```

### Output directory

Generated files live in `.winix/out/`, which is:

- Gitignored by default (generated, not source of truth).
- Recreated on every `apply` or `switch`.
- Inspectable for debugging (`ls .winix/out/`).
- The flake target for `nixos-rebuild --flake .winix/out`.

### Git and Nix flakes

Nix flakes only see files tracked or staged by Git. When using flakes, Winix
must detect untracked new files that would be invisible to Nix evaluation and
warn (or fail) with a clear message and suggested command rather than producing
confusing backend errors.

### Exit codes

- `0` success
- `1` validation or apply failure
- `2` usage error
- `3` unsupported capability
- `4` evaluator failure

## 10. Quality requirements

- Deterministic evaluation from the same inputs.
- Stable resource IDs (derived from import path + export name; renames are
  intentional breaking changes).
- Source provenance for every generated resource (emitted as comments in the
  generated Nix; can be disabled with `winix apply --no-comments`).
- Excellent error messages with suggested fixes.
- Explicit unsupported-capability diagnostics.
- No system mutation during TypeScript evaluation.
- Dry-run / check workflows before apply.

## 11. Security

Winix manages sensitive system configuration and must be conservative.

### Threat model

- Secrets accidentally committed to source control.
- Malicious TypeScript executing during evaluation.
- Unsafe activation scripts.
- Untrusted modules.
- Package supply-chain compromise.
- Privilege escalation bugs.

### Rules

- TypeScript evaluation must not mutate the system.
- Secrets should be **references**, not plaintext values.
- Raw scripts require explicit metadata and warnings.
- Privilege requirements must be shown in plans.
- JSON outputs must avoid leaking secret values.

### Secret integrations (future)

Winix does not provide a secret store today. When secret integrations are
added, they will reference external stores rather than embedding values:

- `sops-nix`
- `agenix`
- 1Password CLI
- environment-provided secret references

Remote, unpinned modules are out of scope for v1.

## 12. Agent DX

Winix should be easy for coding agents to inspect, modify, and validate.
This is a first-class design goal, not an afterthought.

### Repository conventions

Agents can rely on a consistent layout:

- Workspace entrypoint at `winix.config.ts`
- Inputs at `inputs.ts` (when used)
- User-authored fragments live under the workspace root in any organization
  that imports cleanly (e.g. `fragments/`, `hosts/`, `features/`).

### Machine-readable commands

```bash
winix check --json
winix inspect host <name> --json
```

JSON diagnostics must include:

- code
- severity
- message
- resource ID
- branch path
- source file
- suggested fix
- backend capability involved

### Safe edit patterns

Agents should prefer narrow, structural edits:

- Add a fragment to a host's list.
- Create a new fragment file and import it.
- Compose existing fragments into a higher-level fragment.
- Resolve a conflict with explicit `override()`.
- Avoid broad rewrites of generated files (`.winix/out/` is regenerated on
  every `apply` anyway).

### Determinism is a feature

The same fragment list always produces the same generated Nix. Agents can
diff generated output between edits to confirm the impact of a change.
