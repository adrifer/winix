# Dendritic configuration

Winix should prefer a dendritic model: configuration grows from shared roots into branches and leaves instead of being organized only by host.

## Principles

- Cross-cutting concerns live together.
- Hosts compose branches rather than duplicate configuration.
- Platform differences are explicit.
- Users and roles are first-class branches.
- Leaves can override defaults with clear precedence.
- Every merged resource retains provenance.

## Branch kinds

- workspace defaults
- platform profile
- environment profile, such as WSL or LXC
- role
- user
- feature
- host
- raw backend branch

## Example shape

```ts
export default workspace({
  branches: [
    platform("nixos", nixosBase()),
    platform("darwin", darwinBase()),
    platform("windows", windowsBase()),

    role("developer", [features.git(), features.node(), features.editor()]),
    user("adrifer", [features.shell(), features.dotfiles()]),

    host("wsl-work", {
      extends: ["nixos", "developer", "adrifer"],
      features: [features.wsl(), features.workSysctl()],
    }),
  ],
});
```

## Merge expectations

Composition must be deterministic. Conflicts must be errors unless a resource declares an explicit merge strategy, default, override, or force.

## Anti-patterns

- Hidden global registries.
- Implicit filesystem scanning as the main composition mechanism.
- Mutation-heavy builders.
- Host files that duplicate shared concerns.
- Platform-specific behavior hidden behind vague names.

## Explicit imports

All branches, features, and hosts must be composed via explicit TypeScript imports. No directory scanning or glob-based auto-discovery.

Rationale:

- IDE support: jump-to-definition, find-all-references, and rename work out of the box.
- Agent-friendly: adding a feature means adding one import line, not placing a file in a magic directory.
- Deterministic: evaluation order is defined by code, not filesystem sort order.
- Refactor-safe: moving a file updates the import, not a hidden convention.

The existing Nix `import-tree.nix` pattern (scan directory for `.nix` files) is a migration anti-pattern that Winix should not replicate.

