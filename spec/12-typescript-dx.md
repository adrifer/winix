# TypeScript DX

TypeScript DX is a core product requirement. Specs must be excellent for both humans and coding agents.

## Human DX

Winix specs should be:

- readable top-to-bottom
- easy to search
- easy to diff
- easy to refactor
- documented through JSDoc
- validated before apply
- clear about platform differences
- clear about resource ownership and intent

## Agent DX

Specs should support safe automated edits:

- stable file layout
- stable resource IDs
- explicit imports
- small focused modules
- plain object APIs
- deterministic formatting
- no hidden mutation
- no hidden global registries
- source provenance in diagnostics
- JSON inspection commands

## Resource metadata

Resources should support:

```ts
pkg.winget("Git.Git", {
  id: "package.git",
  reason: "Required for development workflows",
});
```

Required metadata:

- stable ID
- reason
- target platform
- owner branch
- source provenance

## Formatting and linting

Recommended:

- Prettier
- ESLint
- TypeScript strict mode
- no implicit `any`
- no unused exports
- deterministic import ordering where practical

## Diagnostics

Errors must be actionable and include source, branch, resource ID, conflicting value, and suggested fix.

