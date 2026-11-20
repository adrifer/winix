# Contributing to Winix

Contributions are welcome, especially helpers, docs, examples and bug reports.
For a tour of the architecture and conventions, start with
[`AGENTS.md`](./AGENTS.md).

## Requirements

- **Node.js 22.13+, 24 or 26** and npm.
- **Bun 1.4.0**, only to build the standalone executables.
- Native Windows or WSL/Linux/macOS: the npm workflows are shell-independent.

## Getting started

```bash
git clone https://github.com/adrifer/winix
cd winix
npm install
npm test -- --run
```

## Common workflows

| Task | Command |
| --- | --- |
| Run the tests | `npm test -- --run` |
| Run one test file | `npx vitest run tests/cli.test.ts` |
| Type-check | `npm run check` |
| Build `dist/` (plus editor types) | `npm run build` |
| Build standalone executables | `npm run build:standalone` |
| Regenerate bundled NixOS/HM/darwin option types | `npm run generate:types` |
| Run the CLI from source | `node --experimental-transform-types src/cli/index.ts check` |

To try a source checkout against a real config through the `winix` command,
set `WINIX_SDK` to this directory (see the README).

## Before opening a PR

1. `npm run check` is clean and `npm test -- --run` passes.
2. New behavior has a test in `tests/`.
3. User-facing changes are documented: the relevant page in `docs/` (and the
   README if it changes the quick start), `src/skill.ts` (what agents read via
   `winix --skill`), and `spec/SPEC.md` when a rule or guarantee changes.
   Changes to `examples/cross-platform` update the guides that quote it.
4. Conventional commit prefixes (`feat:`, `fix:`, `docs:`, `chore:`,
   `refactor:`, `test:`).

CI runs the checks and tests on every PR; publishing only runs for pushed `v*`
tags.

## Proposing larger changes

For a new backend, a breaking API change or a cross-cutting feature, open an
issue or a proposal in [`spec/proposals/`](./spec/proposals/README.md) first.
Ideas and planned work are in [ROADMAP.md](./ROADMAP.md).

## Especially welcome

- **Helpers** that wrap common nixpkgs, Home Manager or Windows patterns,
  following the [API shape rules](./AGENTS.md#api-shape-rules).
- **Bug reports** with a minimal `winix.config.ts` that reproduces them.
- **Docs**: clearer explanations, more recipes in `docs/guides`.

## Releases

Maintainers run `npm run release:preview` (any branch) or
`npm run release:stable` (from `main`) on a clean tree. Both run the checks and
tests, then push a `v*` tag; the publish workflow builds the executables, runs
their smoke tests on Linux and Windows, and publishes to npm and GitHub
Releases. Add a [CHANGELOG](./CHANGELOG.md) entry for stable releases.

## Questions

Open a [Discussion](https://github.com/adrifer/winix/discussions) or an issue.
