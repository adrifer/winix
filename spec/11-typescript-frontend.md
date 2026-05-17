# TypeScript frontend

The TypeScript frontend is the user-facing language for Winix system specs.

## Design goals

- Declarative by default.
- Pure and deterministic.
- Strongly typed.
- Easy to split into small files.
- Friendly to IDEs and agents.
- Able to express dendritic composition.
- Able to produce normalized IR without system mutation.

## Recommended layout

```text
winix.config.ts
winix/
  hosts/
  users/
  roles/
  platforms/
  features/
  packages/
```

## API style

Prefer plain objects and pure functions:

```ts
export const developer = role("developer", {
  packages: [
    pkg.git({ id: "package.git" }),
    pkg.nodejs({ id: "package.nodejs", version: "22" }),
  ],
});
```

Avoid mutation-heavy builders and hidden global state.

## Safe subset

Prefer:

- explicit imports
- `export const`
- plain objects
- arrays
- pure functions
- simple conditionals
- local constants

Discourage:

- network calls during evaluation
- arbitrary filesystem reads
- global mutable state
- decorators
- reflection-heavy APIs
- proxies
- dynamic imports for core config
- time-dependent values

## Example

```ts
export default workspace({
  hosts: [
    host("wsl-work", {
      extends: [platforms.nixos, roles.developer, users.adrifer],
      features: [features.wsl(), features.workSysctl()],
    }),
  ],
});
```

