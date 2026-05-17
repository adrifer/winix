# Evaluation semantics

Evaluation turns TypeScript branches into normalized IR. This document defines deterministic composition and conflict behavior.

## Evaluation phases

1. Load workspace entrypoint.
2. Execute TypeScript in a restricted evaluator.
3. Collect branches and host definitions.
4. Resolve branch references.
5. Detect graph cycles.
6. Merge resources using declared strategies.
7. Validate resource schemas.
8. Validate backend capabilities.
9. Emit IR with provenance and diagnostics.

## Merge strategies

| Strategy | Meaning |
|---|---|
| `append` | Concatenate ordered lists such as package lists or PATH entries. |
| `set` | Assign one value; duplicate assignments conflict. |
| `default` | Assign only if no stronger value exists. Similar to `lib.mkDefault`. |
| `override` | Replace weaker values at the same scope. |
| `force` | Replace all values and require explicit provenance. Similar to force semantics. |
| `merge-object` | Recursively merge object fields. |
| `deny-merge` | Resource cannot be merged; duplicates are errors. |

## Precedence

Default precedence from weakest to strongest:

1. workspace defaults
2. platform profile
3. environment profile
4. role
5. feature
6. user
7. host
8. explicit override
9. explicit force

Precedence must be visible in diagnostics.

## Conflicts

A conflict must report:

- resource ID
- conflicting branches
- conflicting values
- source files and exports when available
- suggested resolution

Example:

```text
Conflict: package.nodejs.version
roles.developer requests 22.
features.javascript requests 20.
Resolve in hosts/wsl-work.ts with an explicit override.
```

## Determinism

Evaluation must not depend on wall-clock time, network calls, random values, host-specific ambient state, or mutable global registries unless explicitly modeled as inputs.

