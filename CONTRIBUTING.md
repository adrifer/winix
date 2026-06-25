# Contributing to Winix

Thanks for thinking about contributing! Winix is young and the codebase is still
moving fast, but contributions are very welcome — especially around helpers,
docs, examples, and bug reports.

If you're poking around to understand how things fit together, start with
[`AGENTS.md`](./AGENTS.md) for a guided tour of the architecture and conventions.

## Requirements

- **Node.js >= 20** (CI runs on 22)
- **npm** (the repo is npm-based; bun also works locally if you prefer)

The core npm workflows are shell-independent and should work from PowerShell,
cmd, WSL, Linux, and macOS.

## Getting started

```bash
git clone https://github.com/adrifer/winix
cd winix
npm install
npm test
```

That should give you 94/94 passing tests in a few seconds.

## Common workflows

| Task                              | Command                       |
| --------------------------------- | ----------------------------- |
| Run the test suite                | `npm test`                    |
| Run a single test file            | `npm test -- helpers.test.ts` |
| Type-check (no emit)              | `npm run check`               |
| Build to `dist/`                  | `npm run build`               |
| Watch mode                        | `npm run dev`                 |
| Lint                              | `npm run lint`                |
| Regenerate bundled NixOS/HM types | `npm run generate:types`      |

## Before opening a PR

Please make sure:

1. `npm run check` is clean (no TypeScript errors).
2. `npm test` passes locally.
3. New behavior has a test next to the existing ones in `tests/`.
4. Public API changes are reflected in:
   - `README.md` (user-facing examples)
   - `spec/SPEC.md` (if it affects the authoring model)
   - `spec/ARCHITECTURE.md` (if it adds/moves a module)
   - JSDoc on the exported function/method
5. Conventional commit prefix in the title (`feat:`, `fix:`, `docs:`,
   `chore:`, `refactor:`, `test:`). CI uses this for release notes.

GitHub Actions will run the full check + tests on every PR. The `Publish`
workflow only runs on pushed tags (`v*`), so PRs never publish anything.

## Proposing larger changes

For anything beyond a small fix or doc tweak, please open an issue or a draft
proposal in `spec/proposals/` first. The format is light: motivation, sketch
of the API, open questions. See existing files for examples
(`binary-release.md` is the most recent one). This keeps surface-area
discussions out of the PR review loop.

## Areas that are especially welcome

- **New helpers** that wrap common nixpkgs / Home Manager patterns. The bar
  is the rules in [`AGENTS.md`](./AGENTS.md#api-shape-rules): mirror the
  parent Nix namespace, no hidden key conversion, opinionated but overridable.
- **Examples** under `examples/` — both `expected/` (current behavior) and
  `proposed/` (what you wish worked) are useful.
- **Bug reports** with a minimal reproducing `winix.config.ts`.
- **Docs**: small fixes, clearer explanations, more examples in the README.

## Releases

Maintainers cut releases via `npm run release:preview` and
`npm run release:stable`. Both require a clean `main` working tree and push
a `v*` tag that the publish workflow turns into an npm release.

## Questions

Open a [Discussion](https://github.com/adrifer/winix/discussions) or an
issue. There's no Discord or chat right now — keeping things on the repo
makes them searchable.
