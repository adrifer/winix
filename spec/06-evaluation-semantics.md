# Evaluation semantics

Evaluation turns TypeScript fragments into normalized IR. This document defines deterministic composition and conflict behavior.

## Evaluation phases

1. Load workspace entrypoint.
2. Execute TypeScript in a restricted evaluator.
3. Collect host definitions and their fragment lists.
4. Expand composite fragments (functions returning `Fragment[]`).
5. Flatten into ordered fragment list per host.
6. Merge fragment outputs using declared strategies.
7. Validate against backend option schemas.
8. Validate backend capabilities.
9. Emit IR with provenance and diagnostics.

## Fragment merge model

Fragments are merged in **list order** (top to bottom). Each fragment contributes data to scopes (`nixos`, `homeManager`, `darwin`). The merge strategy depends on the value type:

### Strategy by value type

| Value type | Default strategy | Behavior |
|---|---|---|
| `string`, `number`, `boolean` | Last wins | Later fragment overwrites earlier |
| `string[]` (packages, paths, imports) | Append + dedupe | Lists concatenate, duplicates removed |
| `Record<string, T>` (attrs, settings) | Deep merge | Objects merge recursively |
| `null` / `undefined` | Skip | Does not participate in merge |

### Example

```ts
host("wsl-work", nixos(), [
  developer(),    // packages: ["git", "nodejs"], programs.git.enable: true
  workSysctl(),   // boot.kernel.sysctl: { "fs.inotify...": 1048576 }
  packages(["socat"]),  // packages appends: ["git", "nodejs", "socat"]
]);
```

Visual merge:

```
Fragment 1     Fragment 2     Fragment 3     Result
──────────────────────────────────────────────────────────
pkg: [a]       pkg: [b]       pkg: [c]    →  pkg: [a, b, c]       (append)
sysctl: {x:1}  sysctl: {y:2}              →  sysctl: {x:1, y:2}   (deep merge)
user: "foo"    user: "bar"                →  user: "bar" ⚠️        (last wins + warn)
enable: true                  enable: F   →  enable: false ⚠️      (last wins + warn)
```

## Conflict detection

A **conflict** occurs when two fragments set the same scalar path to different values. By default:

- **Last wins** — the later fragment's value is used.
- **Warning emitted** — the compiler reports the override with source provenance.

```
⚠ Conflict: nixos.wsl.defaultUser
  "adrifer" (from fragments/wsl.ts:5) overwritten by "root" (from fragments/corporate.ts:3)
  List order determines winner. Use override() to make intent explicit.
```

### Strict mode

With `winix check --strict`, scalar conflicts are **errors** unless explicitly resolved with `override()`.

## Merge modifiers

Fragments can use modifiers to control merge behavior:

### `override(value)` — explicit intent

Silences the conflict warning and declares that the override is intentional:

```ts
export function corporate(): Fragment {
  return {
    nixos: {
      wsl: { defaultUser: override("afernandez") },
    },
  };
}
```

### `prepend(items)` — add to front of list

```ts
packages(prepend(["priority-package"]))
// Result: ["priority-package", ...existing]
```

### `replace(items)` — discard previous, use only these

```ts
packages(replace(["only-these-packages"]))
// Result: ["only-these-packages"] (ignores earlier fragments)
```

### `without(items)` — remove from accumulated list

```ts
packages(without(["git"]))
// Removes "git" added by an earlier fragment
```

## Default merge strategy by option kind

| Option kind | Default strategy | Rationale |
|---|---|---|
| packages / imports | `append` | Multiple fragments can request packages; they accumulate |
| services / programs | `deep merge` | Services have multiple fields; fragments contribute different settings |
| files / symlinks / dotfile links | `deny-merge` | Two fragments writing the same path is almost always a bug |
| environment variables | `set (last wins)` | One value per variable |
| PATH entries | `append` | Multiple PATH entries accumulate naturally |
| shell aliases | `set (last wins)` | One definition per alias name |
| shell init snippets | `append` | Shell init from multiple fragments concatenates |
| sysctl / kernel params | `deep merge` | Different fragments tune different params |
| boolean enable flags | `set (last wins)` | A single on/off state |

## Precedence

In the flat fragment model, precedence is determined by **list order** (later wins). For composite fragments, the expanded order is:

```ts
host("example", nixos(), [
  developer(),  // expands to [home.program("git"), zsh(), neovim(), ...] at positions 0-N
  wsl(),        // position N+1
  packages(override(["custom"])),  // position N+2, highest precedence
]);
```

Explicit modifiers (`override`, `replace`, `force`) always beat implicit last-wins regardless of position.

### Force

`force(value)` is the nuclear option: it ignores all other values for that path and requires explicit provenance. Use sparingly:

```ts
{ nixos: { networking: { hostName: force("wsl-work") } } }
```

## Conflicts

A conflict diagnostic must report:

- Option path
- Conflicting values
- Source fragments (file + line)
- Winner (which fragment is later in the list)
- Suggested resolution (use `override()` or reorder)

## Determinism

Evaluation must not depend on wall-clock time, network calls, random values, host-specific ambient state, or mutable global registries unless explicitly modeled as inputs.

Order of the fragment list is the single source of determinism. Same list → same output, always.
