# Winix proposals

Design notes for changes big enough to agree on before building: a new
backend, a breaking change to the authoring API or merge semantics, a CLI
command that changes the mental model, or a cross-cutting change. Bug fixes,
refactors, and helpers that follow existing patterns don't need one.

There are no open proposals. Candidates are listed in
[ROADMAP.md](../../ROADMAP.md); the "one helper for a program on every OS" and
macOS parity items are the likeliest next ones.

## Writing one

Create `spec/proposals/<topic>.md` with a status line at the top
(`draft`, `accepted`, `in-progress`) and:

1. **Problem:** what users can't do today, with a concrete example.
2. **Design:** the authoring API or behavior, with code.
3. **Alternatives** considered and why not.
4. **Open questions.**

Review happens in the pull request. Once the change ships, move its contract
into [`SPEC.md`](../SPEC.md) and the user-facing docs, add a
[CHANGELOG](../../CHANGELOG.md) entry, and delete the proposal (Git history keeps
it).
