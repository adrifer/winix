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
home.program("git", { userName: "Tony Stark", userEmail: "tony@starkindustries.com" })
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

### Resource handles and `dependsOn` (Windows backend)

> **Scope:** This applies to the Windows backend only. `windows.package(...)`
> and `windows.raw(...)` are the resource-producing helpers today.

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

#### Emitted DSC v3

The emitter assigns each resource a stable `name` and translates captured
handles into `dependsOn` lookups. DSC v3 (schema 2023/08) restricts an instance
`name` to `^[a-zA-Z0-9 ]+$` (letters, numbers, spaces), and `dependsOn` entries
must be `[resourceId('<type>', '<name>')]`. Therefore:

- **Packages:** `name` is the **sanitized** id (`Git.Git` → `Git Git`); the
  real id is preserved in `properties.id`, which is what winget installs.
- **Resources without a natural id** (`raw`): a sanitized explicit `name` when
  given, else a generated `command N` per-host counter.
- Collisions get a ` N` suffix so instance names stay unique.

```yaml
resources:
  - type: Microsoft.WinGet/Package
    name: OpenJS NodeJS
    properties:
      id: OpenJS.NodeJS
  - type: Microsoft.DSC.Transitional/RunCommandOnSet
    name: command 1
    dependsOn:
      - "[resourceId('Microsoft.WinGet/Package', 'OpenJS NodeJS')]"
    properties: { /* ... */ }
```

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

`windows.powershell.module(name, { repository?, dependsOn? })` declares a
current-user PowerShell 7 module without an inline version. The default repository
is the host policy default, otherwise PSGallery. Custom repositories not declared
by a policy must already be registered. Missing
stable version pins are resolved on first apply and recorded in the optional
`modules` section of `winix-windows.lock`, alongside unchanged `packages`.
Module keys are case-insensitive and source-qualified (repository name plus a
digest of a configured feed URI); legacy name-only pins remain readable.
`winix update --windows [names...]` refreshes all or selected package/module
entries; `--dry` resolves without writing. Existing pins require no discovery
query during apply, but installation may still need the network. Repository
changes resolve independent pins; different hosts can use different sources for
the same module. Conflicting sources within a host fail.

`windows.powershell.repositories({ repositories, default, allowed? })` declares
host-scoped named HTTPS feeds and selection policy, resolved after fragment merge.
Omitted module repositories and the automatic Settings installer inherit the
default; explicit disallowed repositories fail without fallback. This does not
govern raw/generic DSC commands or other package ecosystems. Named registrations
are ensured for current-user resolution and as dependencies during activation.
Conflicting existing registration URIs fail instead of being overwritten; global
priorities and permanent trust are not changed. Resolution, including missing-pin
resolution during `--dry`, can register feeds. Credentials stay in separately
configured PSResourceGet authentication, never config URLs or locks.
Conflicting policies in a single host fail rather than merging their allowlists.

Module resources install only the locked version, retain other versions, and
run get/test/set directly through `Microsoft.DSC.Transitional/PowerShellScript`.
They depend on `Microsoft.PowerShell` when that
package is declared. PowerShell 7 with PSResourceGet is a resolution prerequisite.
Profile imports are separate from installation: an unversioned import still
selects PowerShell's normal installed version, not necessarily the locked one.

Windows-side WSL provisioning uses `windows.optionalFeature(name,
{ enabled?, dependsOn? })`, `windows.wsl({ config?, backup?, force?, dependsOn? })`, and
`windows.wsl.distro(name, { source: "nixos-wsl", installLocation, default?,
dependsOn?, setup? })`. The grouped enable resource handles WSL and Virtual Machine
Platform together, with elevation and no automatic restart. Pending changes
stop dependent provisioning with instructions to restart Windows and rerun.
Distro resources require enabled feature declarations and a `Microsoft.WSL`
package in the same host; the features, optional configuration file, and package
become automatic dependencies. The callable setup returns one handle covering
the features and optional configuration, ordered after feature enablement.
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
Install locations must be new absolute local-drive directories (including
resolved environment/known-folder paths). Existing registrations must match
location, WSL version 2, and a Winix registration marker `.winix-wsl.json`;
unrecorded/conflicting distros are never adopted or repaired automatically.
Failed or interrupted imports never trigger unregister rollback. Removing a
declaration never unregisters a distro, deletes its filesystem, or disables
features implicitly. Explicit feature disable remains supported. The separately
declared WSL package retains ordinary package ownership rules.

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

File and PATH scripts use the same PowerShell 7 resource; raw command strings
default to `pwsh` (explicit executable selections are preserved). PowerShell 7
must be on PATH before resource discovery; package ordering alone is not a
fresh-machine bootstrap. Script set operations must check their own desired
state, independently of test operations. Environment variables remain native
Registry resources, with their existing user/machine permission boundaries.

`scripts/bootstrap-windows.ps1` provides an out-of-band Windows PowerShell
5.1/PowerShell 7 prerequisite layer, requiring App Installer/WinGet but not Git,
Node, or Winix. `-Check` only inspects versions and capabilities, failing when
not ready. Install mode confirms the prerequisite plan (`-Yes` for automation),
installs/upgrades missing/outdated Git, Node LTS, PowerShell 7, and DSC via exact
WinGet IDs/source, enables WinGet configuration support, then verifies npm,
Node TypeScript support, PSResourceGet commands, and required DSC resources.
`-UseNvm` selects NVM for Windows instead of standalone Node, with manager
conflict protection. Existing supported versions are kept. No host activation,
WSL provisioning, persistent execution-policy changes, or automatic reboot is
performed. Prerequisites remain outside host lock/ownership tracking. Missing
WinGet requires explicit App Installer installation/registration; config/Winix
installation and restore orchestration are opt-in through repository mode below.

GitHub releases also provide standalone Windows and glibc Linux executables
for x64/ARM64 with SHA256SUMS. They embed a Bun runtime and one SDK/evaluator
instance, resolve `@adrifer/winix` imports without node_modules, support local
TypeScript/JavaScript and Node builtins, and disable automatic npm installation.
Their version selects the SDK regardless of config package manifests. Editor
type dependencies and arbitrary third-party imports are not embedded.
`bootstrap-windows.ps1 -Standalone` skips Node/npm checks/installations, without
changing native Git/PowerShell/WinGet/DSC requirements or activating any host.
Standalone WSL setup downloads its exact release's Linux executable, verifies
the build-embedded SHA256, then launches a private installed copy through a
wrapper using pinned, GC-rooted Nix libc/compiler libraries. No global Linux
linker, host configuration or npm environment is changed. Preparation and full
generation execute that binary as the appropriate unprivileged user; only
activation/ownership operations run as root. The npm path remains supported.
Standalone setup requires committed flake.lock, not npm manifests/locks.
Linux binaries need a compatible glibc/libstdc++ environment for direct use;
automatic WSL setup supplies it on NixOS. Binaries are unsigned. Fresh-image
activation and ARM64 execution remain unverified.

`windows.startup.command(name, spec)` declares a named, current-user Startup
shortcut (`<name>.lnk`), backed by the same PowerShell 7 resource. It registers
sign-in startup only and never launches commands during apply. It is not a
service, scheduler, elevation mechanism, or all-users startup facility.
`spec` contains `executable`, optional argv `arguments`, `workingDirectory`,
`windowStyle` (`normal`, `minimized`, or `maximized`), `dependsOn`, `backup`,
and `force`. Executable paths may use environment variables/known folders or
an application name on PATH. Working directories must be absolute or resolved
known-folder/environment paths; the default is the user profile. Both must
exist during activation. Argument strings are literal; known-folder arguments
resolve on the target. Windows argv quoting preserves empty/Unicode arguments,
spaces, quotes, and backslashes without implicitly invoking a shell.

Shortcut names must be valid Windows filenames without paths or reserved names.
Desired shortcuts are unchanged on repeat applies. Replacements require
`backup: true` (preserving `.lnk.bak`, failing on collision) or `force: true`.
New shortcuts are staged and verified before replacement, using Unicode-capable
Shell APIs. Names must be unique per host.

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
are untouched. Shortcut hash or package-version drift blocks reconciliation.
`state forget startup <name>` or `state forget package <source> <id>` releases
removal ownership without deleting resources or other owners' requirements;
`--dry` previews ownership release.

If existing owned resources would be removed, `switch` lists them and requires
confirmation (`Continue with switch? [y/N]`) before activation. Declining or
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

See
[`proposals/windows-backend.md`](./proposals/windows-backend.md) for the
forward-looking design.

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

## 9. CLI

The CLI owns evaluation orchestration, validation, generation, activation, and
diagnostics. For internal command implementation, see
[`ARCHITECTURE.md`](./ARCHITECTURE.md).

### Prerequisite bootstrap on NixOS

`scripts/bootstrap-nixos.sh` requires a running NixOS system (including
NixOS-WSL) with Nix on PATH. It opens an interactive Bash environment containing
Git and Node.js 24/npm from a single immutable nixpkgs revision embedded in the
script. It preserves the working directory, adds `nix-command`/flakes only to
the child session's `NIX_CONFIG`, skips user Bash startup files, and writes no
flake lock, profile, or system configuration. Normal Nix store downloads and
trust/permission checks still apply. Errors from Nix propagate to the caller.

The script does not install NixOS/Winix, clone configs, install npm dependencies,
select hosts, or activate systems. Users perform those steps themselves and
declare permanent prerequisites in their configs. Stable/preview GitHub
releases include the script and SHA256 checksum, as with Windows bootstrap.

### Commands

#### Repository bootstrap and `winix run`

`bootstrap-windows.ps1 -Repository <https-url> -Ref <ref> -Destination <path>
-ConfigDirectory <relative-path> -HostName <host>` extends the prerequisite-only
script with explicit repository orchestration. `bootstrap-linux.sh` provides
the corresponding `--repository`, `--ref`, `--destination`, `--config-directory`,
and `--host` options on glibc Linux x64/ARM64. Linux uses existing Nix for
temporary Git/Python tooling or requires those tools already installed;
it never silently installs Nix or converts a distribution into NixOS.
NixOS binaries use private pinned libc/compiler dependencies.

Repositories must be credential-free HTTPS URLs. A new clone retains normal Git
history; an existing checkout must be clean, have the exact expected origin,
and already match its requested local ref. No automatic pull/reset/cleanup or
branch switching occurs for existing repositories. Directory links and config
path escapes are refused. Host selection is not a machine rename.

The entrypoints read package.json without importing config. The SDK dependency
must be an exact release or matching official release SDK tarball URL; this is
the sole runtime pin. Executables are architecture-specific, SHA256-verified
against the versioned release manifest before execution. Windows additionally
verifies that release's prerequisite-only script. TLS and execution policies
remain enforced; release hashes are not publisher signatures.

`-DryRun`/`--dry-run` makes no changes, downloads, clone or evaluation.
`-PrepareOnly`/`--prepare-only` prepares prerequisites/runtime, then delegates to
`winix bootstrap --host <host> --prepare-only` for check and activation preview.
Without prepare-only, bootstrap confirms activation after preview. Trust consent
precedes all config evaluation, including check. `-Yes`/`--yes` explicitly accepts
these operations and switch's managed removals. Failures propagate; no automatic
restart, WSL shutdown, npm installation or global Winix installation occurs.

Bootstrap creates an ignored checkout launcher, `.winix/bin/winix.ps1` or
`.winix/bin/winix`. `winix run <command> [options]` rereads the manifest and prefers
the installed matching node_modules SDK's CLI under supported Node, otherwise
uses the matching standalone executable. A stale/corrupt local SDK fails instead
of falling back silently; a stale standalone requires bootstrap rerun. The user
opts into npm with `npm ci` and their approved source. Local npm scripts remain
the standard npm workflow. New init manifests use exact version pins.

Fresh WSL setup branch refs (including resolved default HEAD) fetch full remote
branch history and create upstream-tracking local branches at the locked
activation commit, not the current upstream tip. Tags/commit pins remain detached.
Completed setups are never retroactively migrated, pulled or reapplied.

#### `winix init`

Scaffold a new Winix project. Creates `winix.config.ts`, `tsconfig.json`,
`package.json` (with `@adrifer/winix` pinned to the current installed
version), `.gitignore`, and the Winix agent skill wrapper.

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

#### `winix check`

Typecheck the workspace and validate fragments without side effects.

```bash
winix check
winix check --strict          # scalar conflicts become errors, not warnings
winix check --escape-report   # also report escape-hatch usage (raw, rawModule)
```

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
winix apply --diff            # show diff against the current .winix/out/
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
```

The `--json` machine-readable variant is on the Agent DX roadmap; see
[§ 12](#12-agent-dx).

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

## 10. Quality requirements

- Deterministic evaluation from the same inputs.
- Stable resource IDs (derived from import path + export name; renames are
  intentional breaking changes).
- Source provenance for every generated resource (emitted as comments in the
  generated Nix so agents can attribute any line to its source fragment).
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
