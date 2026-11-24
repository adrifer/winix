# Winix Specification

> **Status:** Living spec for what Winix **is and does today**: its model,
> semantics, rules and guarantees. How to use each feature is in
> [`docs/`](../docs/README.md); plans are in the [ROADMAP](../ROADMAP.md);
> internals are in [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Table of contents

1. [Product](#1-product)
2. [Glossary](#2-glossary)
3. [Core model: fragments](#3-core-model-fragments)
4. [Composition: dendritic graph](#4-composition-dendritic-graph)
5. [Evaluation semantics](#5-evaluation-semantics)
6. [Authoring API](#6-authoring-api)
7. [Curated helpers](#7-curated-helpers)
8. [Escape hatches](#8-escape-hatches)
9. [Windows backend](#9-windows-backend)
10. [CLI](#10-cli)
11. [Quality requirements](#11-quality-requirements)
12. [Security](#12-security)
13. [Agent DX](#13-agent-dx)

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
| **Feature** | A reusable configuration concern that **declares** config (e.g. Git, shells, editors, WSL). N per host. Has `.isActive`. |
| **Profile** | An **array-only** bundle of entries that **groups** features for convenience (e.g. `developer`). Takes only an array, never a callback. |
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
  account.user("tonystark", () => ({ admin: true, shell: "zsh" }))(),
  wsl(),
  workSysctl(),
  nixos.packages("socat", "bubblewrap"),
]);
```

The evaluator resolves where each fragment's data belongs based on its return
value. Users never think about Nix module paths directly; they describe intent.

### Three helpers, one mental model

The three structural helpers have distinct roles: a **feature declares**
configuration, a **profile groups** features, and a **host** is the target.

| Helper | Role | Body shape | Count per host | Has `.isActive` |
|---|---|---|---|---|
| `feature(id, callback)` | **Declare** config (effects or return) | callback (injected context); declares by effect and/or returns fragments | 0..N | yes |
| `profile(id, entries[])` | **Group** features | **array of entries only** (no callback) | 0..N | yes |
| `host(name, platform, entries[])` or `host(name, platform, callback)` | Top-level **target** | entries array **or** callback (effects + return) | — | no |

Platforms are constructed through the `platforms.*` namespace
(`platforms.nixos({...})`, `platforms.darwin({...})`, `platforms.windows()`)
and passed as a host's second argument. Like features, they expose `.isActive`
(`platforms.nixos.isActive`).

`platforms.*()` and `feature()` return **lazy fragments**: descriptors that
defer their factory until evaluation knows the host context. This is what makes
`feature.isActive` work regardless of fragment order in the host list.

A `profile()` takes **only an array** of entries (instantiated
features/profiles and bare fragments such as `overlay.stable(...)` or
`nixos.boot({...})`). Passing a callback to `profile()` is a compile error and
a runtime `TypeError`: profiles group features, they do not declare. Any logic
or injected namespace belongs in a `feature()` that the profile lists.

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
const tony = account.user("tonystark", () => ({ shell: "zsh" }));
const base = [tony(), developer()];

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
      wsl({ defaultUser: "tonystark" }),
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

### Context injection and effects

A `feature()` (and the callback form of `host()`) receives an injected context
object. Destructure the declaration namespaces you need instead of importing
them as globals:

```ts
import { feature } from "@adrifer/winix";

export const git = feature("git", ({ home }) => {
  home.program("git", { userName: "Tony Stark", userEmail: "tony@starkindustries.com" });
});
```

The injected context exposes exactly these namespaces:
`home`, `nixos`, `darwin`, `windows`, and `platforms` (for its query side,
`platforms.darwin.isActive`). Three helpers are intentionally **not** injected
and stay as file-level imports, because their usage is not "declare inside a
body":

- `nix` is a pure `NixExpr`-building utility (the `lib` of Winix); it never
  returns a `Fragment`.
- `account` is a top-level constructor (`const tony = account.user(...)`).
- `overlay` is used as a direct value in profile arrays
  (`profile("linux", [overlay.stable("nixpkgs-stable")])`).

**Declare by effect vs. return.** A declaration made *through an injected
namespace* registers the moment it is called — no `return` is needed:

```ts
feature("dev", ({ home, windows }) => {
  home.program("git");        // effect: registered, no return
  windows.package("Git.Git"); // effect: registered, no return
});
```

There is one asymmetry to keep in mind:

> Injected namespaces declare by effect (no return). Calling another
> `feature()` or `profile()` factory returns a lazy fragment that is **not**
> auto-collected and **must be returned** to compose it.

```ts
feature("workstation", ({ home }) => {
  home.packages("ripgrep");     // effect: auto-registered
  return [developer(), editors()]; // composed features: must be returned
});
```

**Back-compat.** This is additive. The return forms all still work: return one
fragment, return an array, or return after local logic. An effect-only callback
that returns nothing type-checks (the authoring return type is
`FragmentResult | void`). Globals also still work: a file that imports `home`
from the package and never destructures the context behaves identically (a
global `home.*` call is not auto-registered, so it must be returned, exactly as
before).

**`host()` keeps both forms.** A host can hold inline declarations (effects)
*and* compose features (return):

```ts
host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), ({ nixos, home }) => {
  nixos.sysctl({ "fs.inotify.max_user_watches": 1048576 }); // inline effect
  home.packages("socat", "bubblewrap");                     // inline effect
  return [developer(), wsl()];                              // composed features
});
```

**`profile()` is array-only.** A profile groups features and takes only an
array of entries; it does not accept a callback, cannot declare by effect, and
receives no injected context:

```ts
// ✅ allowed
profile("linux", [adrifer(), nixGc(), overlay.stable("nixpkgs-stable")]);

// ❌ compile error + runtime TypeError: a profile takes an array, never a
//    callback. Put the logic in a feature() and list it instead.
const badBody = ({ home }) => { home.program("eza"); };
profile("linux", badBody);
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

export const tailscale = feature(
  "tailscale",
  ({ nixos }, opts?: { exitNode?: boolean }) => {
    nixos.service("tailscale", { ...opts });
  }
);
```

The injected context is always the first callback parameter; the fragment's own
arguments follow it. (Returning `Fragment | Fragment[]` from a global helper
still works too; injected declarations just register by effect.)

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
nixos.imports("inputs.nixos-wsl.nixosModules.wsl")
nixos.program("nix-ld", { libraries: [nix.pkg("icu"), nix.pkg("zlib")] })  // arrays append across features
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
nixos.systemd.tmpfiles.link("/usr/bin/bash", "/run/current-system/sw/bin/bash")
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
home.program("git", { userName: "Tony Stark", userEmail: "tony@starkindustries.com" })
home.program("fzf", { enableZshIntegration: true })
home.service("syncthing", { tray: true })
home.env({ EDITOR: "nvim", BROWSER: "wslview" })
home.path("$HOME/.local/bin", "$HOME/go/bin")
home.packages("neovim", "ripgrep")
home.files({ ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv") })
home.configFiles({ nvim: home.symlink("../nvim/.config/nvim") })  // relative to winix.config.ts
home.wsl.gitCredentialManager()                                   // WSL: Windows GCM shim
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
const tony = account.user("tonystark", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

const media = account.group("media", () => ({
  members: [tony, "jellyfin"],
}));

host("wsl-work", platforms.nixos(), [tony(), media()]);
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
without quoting. Narrower helpers (`nix.pkg()`, `nix.homePath()`,
`nix.pkgPath()`, `nix.str()`, `nix.script()`, `nix.lib.*`,
`nix.binaryRelease()`) are preferred when they fit.

`nix.homePath(relativePath)` safely builds a string path rooted at
`config.home.homeDirectory`; `nix.pkgPath(packageName, relativePath)` does the
same under `pkgs.<packageName>`. Leading `/` characters are ignored so both
helpers produce exactly one joining slash. An empty path emits only the base,
and backslashes remain literal rather than acting as separators.

`nix.binaryRelease()` accepts an optional per-platform `format` of `"raw"`,
`"zip"`, `"tar.gz"`, or `"tgz"`. Raw assets are installed directly and must be
declared explicitly; an omitted format preserves extension-based archive
detection and rejects unknown extensions rather than inferring raw. Keeping
the field per-platform supports vendors that publish different formats for
different targets.


### Diagnostics

The compiler warns (not errors) on escape hatch use, to encourage migration:

```
⚠ wsl.ts:15 — nix.expr() used in home.programs.zsh.initContent
  Consider extracting to a typed fragment when stable.

⚠ winix.config.ts:8 — rawModule("./legacy/vscode-path.nix")
  2 raw modules remain. Consider extracting typed fragments.
```

### Design principles

- Every escape hatch is a fragment (same shape, same composition model).
- Escape hatches are never silently ignored.
- Unsupported escape hatches fail during planning.
- Raw code never runs during TypeScript evaluation.
- Source provenance is always tracked.

## 9. Windows backend

Windows hosts (`platforms.windows()`) emit `.winix/out/<host>/resources.json`,
which `winix switch` checks against the machine and applies (plan, then apply).
How to use each helper is documented in
the [Windows reference](../docs/reference/windows/README.md) and
[WSL distros](../docs/reference/wsl.md); this section holds the rules
and guarantees.

### Resources, handles and `dependsOn`

The Windows backend emits a DSC v3 configuration, which is a dependency graph:
a resource has a name and other resources can reference it via `dependsOn`. To
express ordering type-safely, `windows.package(...)` and `windows.raw(...)`
return a **`ResourceHandle`** with identity. Capturing the handle is optional;
capture it only when another resource must be applied after it.

```ts
const node = windows.package("OpenJS.NodeJS");
windows.raw(
  { executable: "npm", arguments: ["install", "--global", "typescript"], dependsOn: node }
);
```

- `dependsOn` accepts a single handle or an array of handles
  (`ResourceHandle | ResourceHandle[]`).
- A handle from one host passed to another host's `dependsOn` is a **hard
  error** at generation time; ordering is only expressible within one
  configuration document.
- The handle is opaque to user code; only the emitter reads it to resolve
  dependency references to names.

### Emitted resources

The emitter writes `.winix/out/<host>/resources.json`, assigning each resource
a stable `name` (letters, numbers, spaces) and translating captured handles
into `dependsOn` name lists:

- **Packages:** `name` is the **sanitized** id (`Git.Git` → `Git Git`); the
  real id, source and version are in `package`.
- **Resources without a natural id** (`raw`): a sanitized explicit `name` when
  given, else a generated `command N` per-host counter.
- Collisions get a ` N` suffix so names stay unique.

```json
{ "host": "desktop", "resources": [
  { "name": "OpenJS NodeJS", "type": "winget/package", "category": "package",
    "dependsOn": [], "elevated": false,
    "package": { "id": "OpenJS.NodeJS", "source": "winget", "version": "22.12.0", "anyVersion": false, "exact": false } },
  { "name": "command 1", "type": "command", "category": "command",
    "dependsOn": ["OpenJS NodeJS"], "elevated": false,
    "command": { "executable": "npm", "arguments": ["install", "--global", "typescript"] } }
] }
```

PowerShell script resources carry `shell`, `testScript` and `setScript`; other
DSC resources carry their `type` and `properties`.

The Windows backend also exposes typed environment, PATH, file, settings, and
PowerShell module helpers, plus `windows.dsc(...)` for generic resources.
`windows.knownFolder.documents(childPath?)` produces a file target resolved at
activation time, including redirected Documents. Sibling methods are `desktop`,
`localAppData`, `appData`, and `userProfile`. File copy/symlink source
strings resolve relative to the config directory; absolute paths, environment
paths, and file URL objects are supported. Direct emitter callers supply that
directory as `generateWindows(hosts, lock, configDir)`.
In WSL, filesystem sources are translated with `wslpath` to Windows drive or
WSL UNC paths; environment-variable sources remain activation-time expressions.
Other non-Windows generators do not translate local paths.
Symlink resources automatically depend on typed settings declaring
`DeveloperMode: true` anywhere in the same host, preserving other explicit
dependencies. This does not enable Developer Mode implicitly; without such a
declaration, existing Developer Mode or elevation is required as before.

### PowerShell modules and feeds

`windows.powershell.module(name, { repository?, prerelease?, dependsOn? })` declares a
current-user PowerShell 7 module without an inline version. The default repository
is the host policy default, otherwise PSGallery. Custom repositories not declared
by a policy must already be registered. Missing
stable version pins are resolved on first apply and recorded in the optional
`modules` section of `winix-windows.lock`, alongside unchanged `packages`.
`prerelease: true` allows prerelease pins; installation checks both numeric version
and prerelease label. Any stable-only declaration for a shared module/source
prevents prerelease selection. Typed settings implicitly declare
`Microsoft.Windows.Settings` with prereleases allowed through this same mechanism,
including repository enforcement and missing-pin/explicit update resolution.
Existing arbitrary versions never substitute for the pin. Other module versions
are not removed; session imports and DSC adapted-resource selection with
side-by-side versions are not guaranteed by installation locking.
Module keys are case-insensitive and source-qualified (repository name plus a
digest of a configured feed URI); legacy name-only pins remain readable.
`winix update --windows [names...]` refreshes all or selected package/module
entries; `--dry` resolves without writing. On native Windows, a workspace with
Windows hosts treats plain `winix update` as `--windows` (no Nix CLI there). Existing pins require no discovery
query during apply, but installation may still need the network. Repository
changes resolve independent pins; different hosts can use different sources for
the same module. Conflicting sources within a host fail.

`windows.powershell.repositories({ repositories, default, allowed? })` declares
host-scoped named HTTPS feeds and selection policy, resolved after fragment merge.
Omitted module repositories and the automatic Settings installer inherit the
default; explicit disallowed repositories fail without fallback. This does not
govern raw/generic DSC commands or other package ecosystems. Lock resolution
queries an existing registration only if its name and URI match the policy;
otherwise it reads the declared NuGet v3 `PackageBaseAddress` over HTTPS without
credentials or redirects. Other feed protocols and authenticated feeds require
a matching PSResourceGet registration. Built-in PSGallery can be queried directly
over HTTPS using its public v2 API if no matching registration exists.
Lock resolution never creates or modifies registrations, including during `--dry`.
Activation ensures named registrations as module dependencies and fails on
conflicting existing URIs rather than overwriting them. Global priorities and
permanent trust are not changed. Credentials stay out of config URLs and locks.
Conflicting policies in a single host fail rather than merging their allowlists.

Module resources install only the locked version, retain other versions, and
run get/test/set directly through `Microsoft.DSC.Transitional/PowerShellScript`.
They depend on `Microsoft.PowerShell` when that
package is declared. Registered repository discovery uses PowerShell 7 with PSResourceGet.
Profile imports are separate from installation: an unversioned import still
selects PowerShell's normal installed version, not necessarily the locked one.

### Authoring conveniences

- `windows.package` `version: "any"` (spec object, or the `windows.package(id, opts)`
  form) normalizes to `WinPackage.anyVersion: true` with no `version`.
  `"latest"` and `"*"` are rejected. Combining it with an exact version for the
  same id in one host fails during lock reconciliation and emission. Lock resolution, `winix update --windows` and check's lock-gap
  warning skip it. The emitter renders it without `version` and needs no lock
  entry. Switch records no version requirement or lock prompt and passes the key
  as `anyVersionPackages` to reconciliation. Applied-state entries carry
  `packageAnyVersion: true`. A version change is reported ("Keeping package
  (version: any)"), not treated as drift, and does not block owned removal. Owners sharing a package
  must agree on the policy. Combining it with an exact version is an error.
- Known folders add `programFiles` and `programFilesX86`.
  `windows.powershell.profile` and `windows.terminal.settings` are file
  symlink/copy resources with fixed known-folder targets.
- `windows.configPath(path)` resolves against `EvalContext.configDir` with
  Windows path semantics and fails without it.
- Startup `executable`, `arguments` and `workingDirectory` accept file handles
  (not removals). The handle's target is used and the handle is appended to
  `dependsOn`.
- File-like resources (`windows.file.*`, `powershell.profile`,
  `terminal.settings`, `.wslconfig`) and Startup shortcuts default to
  `backup: !force`. A differing existing target moves to `<target>.bak`, and a
  backup collision fails. `backup: false` restores the refuse-to-replace
  behavior, and `force: true` alone deletes without a backup.
- `windows.personalization({ colorMode })` writes `AppsUseLightTheme` and
  `SystemUsesLightTheme`.
- `WorkspaceDef.inputs` is optional. Nix hosts without a `nixpkgs` input get
  a generation warning.
- CLI: `winix windows search <query>` (winget search) and `winix windows import
  [--host]` (`winget export` diff). Both are read-only and Windows-only.

### Hybrid Windows ↔ WSL

- `platforms.wsl(opts)` is a NixOS platform variant: `platforms.nixos(opts)`
  plus `imports = [ inputs.<input>.nixosModules.wsl ]` (input defaults to
  `nixos-wsl`) and `wsl.enable = true`. The platform id stays `nixos`; the
  evaluation context carries `variant: "wsl"`, so `platforms.nixos.isActive` is
  true and `platforms.wsl.isActive` is true only on WSL hosts.
- The Nix backend warns for any module import `inputs.<name>.…` whose input is
  not declared by the workspace.
- `evaluate(workspace, { configDir })` records the directory holding
  winix.config.ts in the evaluation context. The CLI always passes it. It
  enables `home.symlink("./…" | "../…")` (an absolute POSIX path resolved
  against configDir at generation time, so out-of-store links follow the
  checkout) and WSL setup `repository: "self"`. Both fail with an explicit
  error when no configDir is known.
- WSL distro `setup.host` / distro `host` accept a `HostDef`; `setup.user`
  accepts an `AccountUserRef`. They normalize to names at evaluation time.
- `setup.repository: "self"` runs local, read-only Git in configDir: the
  repository root gives `configDirectory`. The current branch's configured
  upstream (remote and merge ref) gives the repository and `ref`; otherwise
  `origin` and the branch name. A detached HEAD gives the commit. The remote is
  converted to HTTPS (scp/ssh forms, Azure DevOps SSH, userinfo stripped).
  An inferred `ref` sets the internal `setupRefFromCheckout` marker and is
  excluded from the completed-setup fingerprint. Explicit refs, and setups
  that do not use `"self"`, keep the original fingerprint byte for byte.
  A completed distro whose recorded fingerprint differs from the current
  declaration is not set up again and does not fail activation: the probe
  prints a note and still verifies the recorded account, checkout and WSL
  default user. Later changes are applied from inside the distro.
- Every check/apply validates each WSL setup against its Linux host offline,
  using the same plan the first-run coordinator computes (host, NixOS-WSL
  module, `system.stateVersion`, account selection, checkout inside home).
  Architecture is checked against the host's own `nixpkgs.hostPlatform`. The
  distro's actual architecture is checked again at setup.
- After a Windows `switch`, the CLI prints, per distro, the command that
  applies later Linux changes: `wsl.exe -d <distro> --cd <checkout>/<configDirectory>
  -- <winix> switch --host <host>`. Here `<winix>` is `npm exec -- winix`, or the
  standalone runtime path. Linux activation stays manual; there is no
  `--with-wsl`.
- `nix.wsl.windowsBin(name, paths)` emits `pkgs.writeShellScriptBin`. The shim
  expands `%VAR%` paths through interop `cmd.exe` (run from its own
  directory to avoid UNC working directories), converts them with `wslpath`
  (`/bin/wslpath`, else PATH) and execs the first existing file, or exits 127
  with the list it tried. Paths must be absolute or start with `%VAR%\` and
  must not contain quotes or cmd metacharacters.
- `home.wsl.gitCredentialManager({ paths? })` sets `programs.git.enable` and
  `programs.git.settings.credential.helper` to such a shim. It defaults to Git
  for Windows' ucrt64 and mingw64 GCM.

### WSL provisioning

Windows-side WSL provisioning uses `windows.optionalFeature(name,
{ enabled?, dependsOn? })`, `windows.wsl({ config?, backup?, force?, dependsOn? })`, and
`windows.wsl.distro(name, { source: "nixos-wsl", installLocation, default?, host?,
dependsOn?, setup? })`. The grouped enable resource handles WSL and Virtual Machine
Platform together, with elevation and no automatic restart. `windows.wsl()` also
declares the `Microsoft.WSL` runtime through normal package/lockfile handling,
elevated (its installers all need administrator rights); an explicit package declaration may customize its options. Pending changes
stop dependent provisioning with instructions to restart Windows and rerun.
Distro resources require enabled feature declarations and a `Microsoft.WSL`
package in the same host; the features, optional configuration file, and package
become automatic dependencies. The callable setup returns one handle covering
the runtime package, features and optional configuration, ordered after runtime
installation and feature enablement.
Omitting `config` leaves the existing `.wslconfig` untouched. Registration
and default selection run for the current Windows account, never SYSTEM.

`.wslconfig` is a complete current-user file with normal overwrite protections;
changes warn about manually restarting WSL, never stop running distributions.
NixOS-WSL image URLs, SHA256 hashes, release versions, and architectures are
pinned in optional `wslImages` entries `nixos-wsl/x64` and `nixos-wsl/arm64`,
backward-compatible with version-1 locks. First apply resolves missing pins;
explicit Windows update refreshes all images, or `nixos-wsl` alone. Resolution
failures preserve existing locks. Dry generation does not write pins or
download images; activation verifies the target-architecture image before import.
Image updates only affect future registrations, never existing Linux systems.

Names and locations must be unique per Windows host, with at most one default.
Creation locations must be new absolute local-drive directories (including
resolved environment/known-folder paths). Previously provisioned registrations
must match location, WSL version 2, and a Winix marker `.winix-wsl.json`.
Failed or interrupted imports never trigger unregister rollback. Removing a
declaration never unregisters a distro, deletes its filesystem, or disables
features implicitly. Explicit feature disable remains supported. The separately
declared WSL package retains ordinary package ownership rules.

The same distro declaration automatically adopts an untracked existing
registration only when it is WSL 2, runs NixOS, and its kernel hostname matches
`host` (defaulting to `setup.host`). No Git, checkout, config, or Linux user
inspection is required. With no expected hostname, adoption fails explicitly.
A root non-login probe reads only OS identity and hostname; it may start WSL
but never modifies Linux or executes repository code. A mismatching registration
fails, never triggers import, conversion, replacement, or hostname changes.
Creation occurs only when both the named registration and tracking record are absent.

Local AppData `Winix\wsl-registrations\registration-<lowercase-name>.json` records
version, source, name, GUID, actual location, adoption status and expected hostname.
Get/test never write records; set rechecks registration identity before recording
with exclusive creation. Subsequent runs reject missing/replaced registrations,
location changes, changed adopted hostname declarations and corrupt records.
Legacy import markers migrate to tracking without being reclassified as adopted.
Adopted distros retain their actual location and defaults; `setup` is never run
for them, even on later applies. Linux activation remains manual. Winix-created
distros keep their first-run/resume and default management behavior.
Dry generation/check are static only; provisioning pins remain available because
the same declaration can create on another machine.

### WSL first-run setup

Optional distro `setup` explicitly links a trusted HTTPS Git `repository`,
optional `ref` (default HEAD), relative `configDirectory`, and Linux `host`;
optional `user` selects its declared normal account and `checkout` defaults to
that account's home/dotfiles. Checkout must stay inside that home; Home Manager
identity/home must agree. The Linux host must explicitly enable/import NixOS-WSL,
declare system.stateVersion and match the distro architecture. The config
directory requires committed flake.lock (also package.json/package-lock.json
for npm-based Winix). Repository/config code and npm lifecycle scripts, when
used, are trusted; embedded credentials are refused and
private authentication must already work inside Linux.

Optional version-1 lock section `wslRepositories` maps a SHA256 key of
`[repository, ref]` to repository/ref/revision/resolvedAt. First apply resolves
missing commits, explicit Windows updates refresh them (`wsl-setup` selects
repositories alone), and dry generation never writes pins or executes the repo.
Pins are first-run only; incomplete setup retains its original commit.
The root Linux coordinator prepares Git/config (and npm when used) as the initial nixos user,
activates a minimal declarative account/WSL configuration without Home Manager,
assigns checkout ownership, generates the full host as the target user and
activates it as root. Its actual wsl.defaultUser must match. Password creation
and sudo policy remain outside setup; required external account secrets must
already exist.

Non-interactive WSL probes and setup prepend the NixOS system executable and
wrapper directories to their process PATH before running any Linux commands.
They do not depend on, or source, root/user shell profiles.

Root-owned staged state under /var/lib/winix/wsl-setup makes failures resumable.
Conflicting settings, dirty or occupied checkouts are refused, never reset or
adopted. Completed setup is not repeated or updated. A killed coordinator's
run.lock requires manual inspection/PID verification before removal; other
conflicts require manual recovery or a new distro. No WSL shutdown/reboot occurs.
Without setup, Linux repository installation and activation remain manual.
Fresh-image end-to-end activation remains unverified.

### PowerShell 7 execution

File and PATH scripts use the same PowerShell 7 resource; raw command strings
default to `pwsh` (explicit executable selections are preserved). PowerShell 7
must be on PATH before resource discovery; package ordering alone is not a
fresh-machine bootstrap. Script set operations must check their own desired
state, independently of test operations. Environment variables remain native
Registry resources, with their existing user/machine permission boundaries.

### Prerequisites and standalone executables

`scripts/install.ps1` (Windows PowerShell 5.1 or PowerShell 7) needs only App
Installer/WinGet. After its single confirmation it registers App Installer for
the user when it is installed but unregistered (otherwise opens the Store page;
never unsigned installers), installs or upgrades missing/outdated Git (2.0+),
PowerShell 7 (7.4+) and DSC (3.2+) by exact WinGet ID and source, then verifies
PSResourceGet commands and the required DSC resources. Prerelease tools are
rejected. Installers may ask for elevation; restart requests stop the script
for a manual restart and rerun. Prerequisites stay outside host lock and
ownership tracking. No Node/npm is installed.

GitHub releases also provide standalone Windows and glibc Linux executables
for x64/ARM64 with SHA256SUMS. They embed a Bun runtime and one SDK/evaluator
instance, resolve `@adrifer/winix` imports without node_modules, support local
TypeScript/JavaScript and Node builtins, and disable automatic npm installation.
Their version selects the SDK regardless of config package manifests. Editor
type dependencies and arbitrary third-party imports are not embedded.
Standalone WSL setup downloads its exact release's Linux executable, verifies
the build-embedded SHA256, then launches a private installed copy through a
wrapper using pinned, GC-rooted Nix libc/compiler libraries. No global Linux
linker, host configuration or npm environment is changed. Preparation and full
generation execute that binary as the appropriate unprivileged user; only
activation/ownership operations run as root. The npm path remains supported.
Standalone setup requires committed flake.lock, not npm manifests/locks.
Linux binaries need a compatible glibc/libstdc++ environment for direct use;
`install.sh` and WSL setup supply it on NixOS. Binaries are unsigned. ARM64
execution remains unverified.

### Sign-in startup

`windows.startup.app(name, spec)` declares a named, current-user sign-in
program as a logon-triggered scheduled task `\Winix\<name>` (current user, limited
run level, interactive, no time limit, priority 4, battery allowed, multiple
instances ignored), registered without elevation. `windows.startup.shortcut(name,
spec)` declares a Startup-folder shortcut (`<name>.lnk`) instead. Both are
PowerShell 7 resources tracked in applied state (kinds `startup-app`, by the
SHA-256 of the exported task XML, and `startup`, by the shortcut's hash), and
register sign-in startup only: nothing is launched during apply. They are not
services, elevation mechanisms, or all-users startup facilities.
`spec` contains `executable`, optional argv `arguments`, `workingDirectory`,
`windowStyle`, and `dependsOn`; apps add `delay` (whole seconds, 0–3600) and
the `hidden` style (headless console host), shortcuts add `backup` and
`force`. App `minimized`/`maximized` start through a headless PowerShell
launcher. `windows.startup.explorer({ delay?, waitForIdle? })` sets or clears
`StartupDelayInMSec`/`WaitForIdleState` under HKCU
`...\Explorer\Serialize`. Executable paths may use environment variables/known folders or
an application name on PATH. Working directories must be absolute or resolved
known-folder/environment paths; the default is the user profile. Both must
exist during activation. Argument strings are literal; known-folder arguments
resolve on the target. Windows argv quoting preserves empty/Unicode arguments,
spaces, quotes, and backslashes without implicitly invoking a shell.

Startup names must be valid Windows filenames without paths or reserved names.
Desired shortcuts are unchanged on repeat applies. Replacements back up by
default to `%LOCALAPPDATA%\Winix\startup-backups\<timestamp>-<name>.lnk`, never
inside the Startup folder, which sign-in opens entirely; `backup: false` refuses them and
`force: true` replaces without a backup.
New shortcuts are staged and verified before replacement, using Unicode-capable
Shell APIs. Names must be unique per host.

### npm registries, personalization and fonts

`windows.npm.registries({ registries, default, scopes? })` configures the merged
host's current-user npm registry and declared scoped registry keys. URLs are
HTTPS without credentials/query/fragments; names must be declared, scopes use
`@name`. The DSC resource preserves authentication and unrelated `.npmrc`
content, rejects links/concurrent changes, and updates atomically. It honors
absolute NPM_CONFIG_USERCONFIG at activation. No allowlist enforcement,
package installation, automatic npm setup, token management or cleanup is
implied; project/environment/CLI npm settings can override it. Bootstrap and
Linux WSL setup remain independent.

Windows personalization uses current-user DSC PowerShell resources:
`windows.wallpaper({ source, style })` manages a content-addressed local image
with the desktop API; `windows.personalization({ accentColor, explorer, taskbar })`
manages only declared accent/Explorer/taskbar preferences and taskbar auto-hide.
No automatic Explorer restart, per-monitor images, lock-screen policy or app
theme selection is implied. Registry preferences can require signing out and
remain dependent on Windows version/policy.

`windows.fonts({ sources })` installs current-user TTF/OTF files from local paths,
HTTPS downloads/ZIPs, or the built-in `nerd-fonts` provider. Relative sources
resolve from the config directory. Remote font identity, URL, release and SHA-256
are locked separately in `winix-windows.lock.fonts`; a supplied digest is trusted
explicitly, otherwise initial resolution trusts upstream metadata/downloads.
Missing pins resolve on apply; `update --windows fonts` refreshes fonts only.
`winix windows fonts [query]` lists official release ZIP IDs.
Unsafe archives, checksum mismatches, missing fonts, and conflicting installed
files/registry entries fail. No silent replacement or removal ownership is
claimed. Family names are read from font metadata; app font selection is separate.
Dry runs may resolve metadata/checksums but never install fonts, change the
desktop, or write pins. Native activation remains unverified.

### Ownership and removal

Native Windows `switch` reconciles startup/package ownership using a versioned,
machine-local per-user inventory in `%LOCALAPPDATA%\Winix`, separate from
version locks. Owners are canonical config-directory/host identities. After
successful activation, new packages and created/replaced shortcuts gain removal
ownership; pre-existing packages and unchanged shortcuts do not. Requirements
recorded by other owners prevent removal, and conflicting shared definitions
fail before activation.

Removed owned shortcut declarations are automatically cleaned up after successful
activation, without terminating programs. Unused owned packages are automatically
uninstalled after successful activation. `switch --dry` previews all cleanup;
exact package ID/source/version selection is used. External resources
are untouched. Shortcut hash drift and package downgrade/exact-pin drift block
reconciliation. Floating package locks are minimum versions/fresh-install
targets during native Windows switch: older packages upgrade; newer installed
versions are retained using an activation-only version override without changing
the lock or uninstall ownership. Successfully observed external upgrades update
the inventory snapshot. Inline version declarations remain exact and existing
mismatches fail before activation, never silently downgrade. Unequal versions
outside dotted numeric syntax fail explicitly rather than guessing ordering.
After a successful interactive switch, newer floating packages offer a separate
default-no lock-update prompt. Dry and noninteractive runs do not prompt or
write observed-version pins; --yes applies only to removal confirmation. Normal
pin resolution remains unchanged. Plain apply and direct DSC activation do not
perform this runtime reconciliation. Removal drift checks remain conservative.
`state forget startup <name>` or `state forget package <source> <id>` releases
removal ownership without deleting resources or other owners' requirements;
`--dry` previews ownership release.

`state owners` lists stable owner IDs and recorded config-directory/host identities.
After a checkout move or host rename, `state migrate-owner <old-owner-id> --host NEW`
transfers all that identity's requirements to the current config-directory/host.
`--dry` previews without writing; real migration requires explicit `--yes`.
It changes inventory metadata only, without evaluating configuration or touching
system resources. Other owners, snapshots and owned/unowned status are preserved,
including when the new identity already shares a resource. The next switch still
enforces conflicts, drift and removal confirmation. `state forget` deliberately
retains owner requirements and is not an alternative to identity migration.

If existing owned resources would be removed, the plan lists them (`- remove`,
with a data-loss note only for package uninstalls) and `switch` requires
confirmation (`Remove the item(s) marked "- remove" and continue? [y/N]`) before
activation. Reported durations exclude time spent at prompts. Declining or
closing the prompt cancels the entire switch. `--yes`/`-y` accepts removals for
automation and is required for noninteractive switches with removals. Dry runs,
switches without removals, and cleanup of already absent resources do not prompt.

Inventory writes are serialized and atomic. Failed activation grants no new
ownership; partially installed resources can remain unowned. Each successful
removal is checkpointed. Stale locks/temporary writes after crashes require
inspection and explicit recovery. Losing state never infers deletion rights.
Moving workspaces/removing hosts does not automatically release their recorded
requirements. Coordination is limited to recorded activations by one user on
one machine; simultaneous external installers/other Windows accounts are not
coordinated. Direct generated-script/DSC activation bypasses ownership tracking.
Other resource kinds are not yet tracked.

Planned Windows work is in the [ROADMAP](../ROADMAP.md).

## 10. CLI

The CLI owns evaluation orchestration, validation, generation, activation, and
diagnostics. For internal command implementation, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Commands

#### Install scripts, repository bootstrap and `winix run`

`install.ps1` and `install.sh` are release assets with SHA256 checksums.
Without `-Repository`/`--repository` they install a Winix release (the latest
from the GitHub API, or `-Version`/`--version`) into the per-user installation,
`%LOCALAPPDATA%\Winix\runtime\<version>` or `~/.local/share/winix/runtime/<version>`
(`$XDG_DATA_HOME` respected; Linux behind a generated wrapper, through the
pinned Nix loader/libraries on NixOS), and run `winix install command`.

With `-Repository <https-url> -Ref <ref> -Destination <path> -ConfigDirectory
<relative-path> [-HostName <host>]` (Linux: `--repository`, `--ref`,
`--destination`, `--config-directory`, `--host`) they also clone or validate the
checkout. Repositories must be credential-free HTTPS URLs. A new clone retains
normal Git history; an existing checkout must have the exact expected origin and
already match its requested local ref. Local changes only warn (linked app
settings rewrite tracked files), so reruns after a restart proceed. No automatic
pull/reset/cleanup or branch switching occurs. Directory links and config path
escapes are refused. Host selection is not a machine rename. The scripts read
package.json without importing config; the SDK dependency must be an exact
release or matching official release SDK tarball URL, the sole runtime pin. They
install that release, then delegate to `winix bootstrap --confirmed [--host
<host>] [--prepare-only] [--yes]` from the config directory. A config directory
without winix.config.ts gets the latest (or requested) release, the command, and
the instruction to run `winix init` there. Linux uses existing Nix for temporary
Git/Python tooling or requires those tools; it never installs Nix or converts a
distribution into NixOS.

Executables are architecture-specific and SHA256-verified against the versioned
release manifest before execution. TLS and execution policies remain enforced;
release hashes are not publisher signatures. `-DryRun`/`--dry-run` makes no
changes, downloads, clone or evaluation. Each script asks one confirmation
listing every step before anything changes or is evaluated.

`winix bootstrap --confirmed` asks nothing further: without a host it picks the
remembered one (`.winix/host`), the only candidate for the platform, the one
matching the computer name, or asks the user to choose, and remembers it;
`switch` uses the remembered host when no `--host` is given and the computer
name matches none. `check` is followed directly by `switch` (which prints the
plan); `--prepare-only` stops after `switch --dry`. `winix bootstrap` without
`--confirmed` asks before evaluation and before activation. `-Yes`/`--yes`
explicitly accepts these operations and switch's managed removals. Failures
propagate; no automatic restart, WSL shutdown or npm installation occurs.
Bootstrap then installs the command and records the config directory in
`<per-user installation>/checkout`.

`winix install command` (standalone only) copies the running executable into the
per-user installation unless it already runs from there, and writes the command
`%LOCALAPPDATA%\Winix\bin\winix.cmd` on the Windows user PATH (registry value
kind and `%VAR%` entries preserved, no elevation) or `~/.local/bin/winix` on
Linux (PATH is the user's config; a hint is printed). The command runs
`<installed> run <args>`. Files it did not generate are never replaced; older
installed versions are removed, keeping the running one. `winix bootstrap
--command-only [--host <host>]` only remembers the host, installs the command
and records the checkout, with no evaluation; standalone Windows-driven WSL
setup runs it as the Linux user after activation, so the distro is then switched
from inside with `winix switch`.

`winix run <args>` routes from the current directory: inside a project
(winix.config.ts here or above) with an exact pin, it runs that pinned release
in the project (without a pin, itself there); elsewhere, commands that need a
project use the recorded checkout, and project-free commands (`init`, `install`,
`--version`, `--help`, `--skill`, `windows search`, `windows fonts`) run itself
in the current directory. `init` always runs in the current directory. Running a
pinned release never infers another Winix from node_modules;
`WINIX_SDK=<package dir>` (absolute or project-relative) explicitly runs that
package's `src/cli/index.ts`, else `dist/cli/index.js`, under supported Node,
reporting it and the pin. On Windows and Linux a pin that differs from the
running release downloads that release into the project's
`.winix/runtime/<version>`, verified against its `SHA256SUMS` before running
(Linux: behind a generated wrapper whose `--version` must match); older runtime
folders are then removed, keeping the running one and any older checkout
launcher's fallback. Checkout launchers (`.winix/bin`) from earlier bootstraps
keep working: they run `winix run` from the config directory. macOS has no
standalone executable. The user opts into npm with `npm ci` and their approved
source. Local npm scripts remain the standard npm workflow. New init manifests
use exact version pins.

Fresh WSL setup branch refs (including resolved default HEAD) fetch full remote
branch history and create upstream-tracking local branches at the locked
activation commit, not the current upstream tip. Tags/commit pins remain detached.
Completed setups are never retroactively migrated, pulled or reapplied.

#### `winix upgrade`

`winix upgrade [version] [--dry]` rewrites the `@adrifer/winix` pin in the
project's package.json (found from winix.config.ts here or above, else the
recorded checkout) to the latest stable GitHub release, or to the named release
after checking it exists, keeping the pin's form (version or release tarball
URL) and the file's formatting. It does nothing when already at the latest or
pinned past it; an explicit older version is allowed. It never downloads or
runs anything; the next command downloads the pinned release. The `winix`
command runs it with the installed Winix, not the pinned one, so a pin from
before the command existed can still be upgraded. `winix update` never changes
the Winix pin; it ends with a notice when a newer release exists (silently
skipped when offline).

#### `winix init`

Scaffold a new Winix project. Creates `winix.config.ts`, `tsconfig.json`,
`package.json` (with `@adrifer/winix` pinned to the current installed
version), `.gitignore`, and the Winix agent skill wrapper.

#### Editor types and `winix types`

Editing needs no npm install. `npm run build` collects the SDK declarations
(with the bundled NixOS/Home Manager/nix-darwin option augmentations),
`@types/node` and `undici-types` (with licenses) into `dist/editor-types.json`,
content-hashed; the npm package ships it and standalone executables embed it.
`check`, `apply`, `plan`, `switch`, `update`, `inspect` and `init` write it to
the config's ignored `.winix/types` when its hash differs (in place, stale files
removed, stamp last; best effort, never failing the command), so declarations
always match the running Winix. The init tsconfig maps `@adrifer/winix`,
`@adrifer/winix/types` and `@adrifer/winix/types/bundled` there with `paths`,
uses `.winix/types/@types` as `typeRoots`, and excludes `.winix`. `winix types`
writes them on demand and prints the compilerOptions a tsconfig still lacks.

```bash
npx @adrifer/winix init
```

#### `winix --skill`

Print the complete agent instructions for the installed Winix version. The
output covers commands, the authoring model, helpers, project structure,
platform behavior, validation, and safe editing rules. This command only
writes to stdout.

#### `winix install skill`

Install `.agents/skills/winix/SKILL.md` in an existing project. The installed
file contains skill metadata and tells the agent to run `winix --skill`.
Keeping the full instructions in the executable prevents the wrapper from
drifting away from the installed Winix API.

#### `winix scaffold feature`

```bash
winix scaffold feature lazygit           # features/lazygit.ts next to winix.config.ts
winix scaffold feature lazygit --force   # overwrite
```

Writes a feature factory named after the camel-cased name (`dev-tools` →
`devTools`) with the Home Manager and Windows halves as commented TODOs and a
`platforms.darwin.isActive` branch, then prints the import line. Names are
lowercase words separated by dashes. The template evaluates as written; nothing
is added to `winix.config.ts`.

#### `winix check`

Typecheck the workspace and validate fragments without side effects.

```bash
winix check
winix check --strict          # fail on conflicts, duplicate hosts, or wholly ignored fragments
winix check --escape-report   # also report escape-hatch usage (raw, rawModule)
```

Check warns when a feature or inline fragment contributes only scopes that do
not apply to the target, such as Home Manager config on Windows. Mixed-scope
features are fine as long as at least one scope applies. These warnings fail
`--strict`, like scalar conflicts and duplicate host names.

The check also warns when a plain string contains a likely unescaped Nix
interpolation such as `${config.*}`, `${pkgs.*}`, or `${lib.*}`. Diagnostics
recommend `nix.homePath()`, `nix.pkgPath()`, `nix.str()`, or `nix.expr()` based
on the value shape; typed `NixExpr` values and ordinary shell references such
as `${HOME}` are not reported.

#### `winix apply`

Generate backend output files into `.winix/out/` (gitignored by default).

```bash
winix apply                   # generate all hosts
winix apply --host wsl-work   # generate a single host
winix apply --dry             # print what would be generated, no writes
winix apply --diff            # unified diff against the current .winix/out/
winix apply --offline         # never resolve winix-windows.lock online (also switch/plan)
winix apply --locked          # fail if winix-windows.lock would change (also switch/plan)
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

For Windows hosts, `winix switch --dry` (alias `winix plan`) prints a plan instead
of the generated files: each resource's action (`+` install, `~` change, `!`
conflict, `?` not checked), counts of unchanged resources, elevation and restart
notes, planned removals from the applied-state inventory, and the activation
command. On native Windows it is checked against the machine: one
`winget export` for packages (a batched `dsc config get` confirms any it does
not list), every PowerShell-script resource's test script run
in one PowerShell process (each isolated, so one failure marks only that
resource), and a batched `dsc config test` for other DSC resources (retried one
by one if the batch aborts). Elsewhere it lists what the host declares. It is
the Windows drift check. Packages about to upgrade are matched against running
processes from winget portable installs (`WinGet\Packages\<id>_*`, through
`WinGet\Links`); the plan warns about them and a real switch stops before
activation until they are closed, because winget cannot replace a running
portable app and a failed upgrade removes its command link. Installs and
upgrades that will prompt for UAC are listed (upgrades: `Installed Scope:
Machine` from `winget list --details`; installs: winget's chosen installer
differs from its `--scope user` one, or there is none), and a real switch prints
them before activation, since winget waits silently on the prompt. The
applied-state lock records its process; a lock whose process has exited is
removed by the next switch.

Activation by platform:

| Platform | Activation command |
|---|---|
| NixOS | `sudo nixos-rebuild switch --flake .winix/out` |
| nix-darwin | `sudo darwin-rebuild switch --flake .winix/out` |
| Home Manager only | `home-manager switch --flake .winix/out` |
| Windows | Winix applies the plan itself (below) |

On NixOS (including WSL), `plan` and `switch` first build
`nixosConfigurations.<host>.config.system.build.toplevel` (out-link
`.winix/result-<host>`, outside the hashed flake directory) and compare it with
`/run/current-system`: declared packages (references of `sw`, per-user
profiles and Home Manager `home-path`) via `nix store diff-closures`, Home
Manager files and `/etc` by content with store hashes and dependency versions
normalized, services via `switch-to-configuration dry-activate` when `sudo -n`
succeeds (otherwise estimated from unit files and marked so), and kernel/initrd
changes. Planning never activates. A build identical to the running system
makes `switch` skip activation. `plan --no-build` prints the activation command
only. nix-darwin hosts still print their command.

Windows hosts generate `.winix/out/<host>/resources.json` (each resource with
its category, dependencies, elevation and how to check and apply it). `winix
switch` plans against the machine and applies only out-of-date resources in
dependency order: packages through `winget install`/`upgrade`, PowerShell
script resources in one PowerShell 7 runner (test, set, test again; Windows
PowerShell scripts in `powershell.exe`), other DSC resources through `dsc
config set`, raw commands on every run. Work needing administrator rights
(machine-wide or per-user-less package installs, features, machine
environment, settings, `elevate: true`) is batched into as few elevated runs
as dependencies allow, normally one UAC prompt. A failure skips its
dependents only and fails the switch after reporting every result.

#### `winix inspect`

Introspection for debugging and agent consumption.

```bash
winix inspect                        # every host
winix inspect --host desktop         # one host
winix inspect --matrix               # features x hosts table, grouped by profile
```

Per host: platform, feature order, then each feature once with the scopes it
contributes to (`nixos`, `homeManager`, `darwin`, `windows`), its Nix option
keys, and its Windows resources (packages with their version policy, files,
env, startup, modules, WSL...) with `dependsOn` edges. Features that contribute
nothing on the host's platform are marked as ignored.

`--matrix` prints a feature x host table instead: rows grouped by the outermost
profile they come through (`profile()` results are marked `__group`; a
profile's own fragments show as "(its own settings)", host callback bodies as
"(inline in <host>)", direct entries last), cells `●` applies, `·` included
but inapplicable, blank absent. `winix check` warns about wholly inapplicable
features only for entries listed on the host itself (including a host
callback's returned entries), not for profile members or features a feature
returns, since shared profiles are meant to span platforms.

The `--json` machine-readable variant is on the Agent DX roadmap; see
[§ 13](#13-agent-dx).

#### `winix update`

Refresh `flake.lock` by running `nix flake update` against the generated
output, then copy the new lockfile back to the project root so it can be
committed.

```bash
winix update                     # update all inputs
winix update nixpkgs home-manager  # update only the listed inputs
winix update --dry               # show what nix would do, change nothing
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

## 11. Quality requirements

- Deterministic evaluation from the same inputs.
- Stable resource IDs (derived from import path + export name; renames are
  intentional breaking changes).
- Source provenance for every generated resource (emitted as comments in the
  generated Nix so agents can attribute any line to its source fragment).
- Excellent error messages with suggested fixes.
- Explicit unsupported-capability diagnostics.
- No system mutation during TypeScript evaluation.
- Dry-run / check workflows before apply.

## 12. Security

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

## 13. Agent DX

Winix should be easy for coding agents to inspect, modify, and validate.
This is a first-class design goal, not an afterthought.

### Version-matched skill

The installed binary is the source of truth for agent instructions:

```bash
winix --skill
```

`winix init` and `winix install skill` write a small project-local wrapper at
`.agents/skills/winix/SKILL.md`. The wrapper contains discovery metadata and
directs the agent to the binary instead of copying version-sensitive
instructions into the project.

Tests compare the emitted skill with the public authoring helper objects.
Adding a helper without documenting it must fail the test suite.

### Repository conventions

Agents can rely on a consistent layout:

- Workspace entrypoint at `winix.config.ts`
- Inputs at `inputs.ts` (when used)
- User-authored fragments live under the workspace root in any organization
  that imports cleanly (e.g. `fragments/`, `hosts/`, `features/`).

### Machine-readable commands

Machine-readable JSON output is a target for the Agent DX layer but not yet
implemented (`--json` flags on `check` and `inspect` are planned). When they
land, the contract will be:

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
