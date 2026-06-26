# Winix proposals

This directory holds **forward-looking specs** for features that are not yet
implemented. Anything in `proposals/` is a design sketch, not a contract.

If a feature is shipped, its contract moves into [`SPEC.md`](../SPEC.md) and
the proposal file is either removed or replaced by a short pointer.

## Status legend

Each proposal must declare a status at the top of the file:

| Status | Meaning |
|---|---|
| `draft` | Open design exploration; shape may change radically |
| `accepted` | Design approved, implementation pending |
| `in-progress` | Code is being written against this proposal |
| `superseded` | Replaced by another proposal or by `SPEC.md` |

## Lifecycle

1. **Draft a proposal.** Copy `_template.md` (when it exists) or follow the
   structure of an existing proposal. Open a PR with status `draft`.
2. **Iterate.** Review happens in the PR thread. Major shape changes are
   normal at this stage.
3. **Accept.** Mark `accepted` once the design is settled enough to build.
4. **Implement.** Mark `in-progress`. Land code in tracked PRs that link
   back to the proposal.
5. **Promote.** Once shipped, fold the contract into [`SPEC.md`](../SPEC.md)
   and either delete the proposal or leave a one-line redirect.

## Open proposals

| File | Status | Summary |
|---|---|---|
| [`binary-release.md`](./binary-release.md) | implemented | `nix.binaryRelease()` helper for prebuilt single-binary CLIs |
| [`windows-backend.md`](./windows-backend.md) | in-progress | Native Windows targets (Winget, DSC, registry, scheduled tasks) |
| [`context-injection.md`](./context-injection.md) | draft | Inject declaration namespaces into `feature`/`profile`/`host` callbacks; declare by effect; resource handles for `dependsOn` |
| [`windows-file.md`](./windows-file.md) | draft | `windows.file` declarative files + dotfile symlinks (content/symlink/copy), privilege-aware (Developer Mode) |

## Research

Supporting investigation that informs proposals lives in
[`../research/`](../research/). Unlike a proposal (which describes what we
*will* build), a research note captures **evidence** gathered from upstream
sources or experiments that back specific design decisions. Proposals cite
their research; the research file lives separately so the proposal stays
focused on the design.

| File | Backs | Summary |
|---|---|---|
| [`../research/windows-scenarios.md`](../research/windows-scenarios.md) | `windows-backend.md` | Patterns mined from Microsoft's official DSC v3 dev-box configs; tiered helper recommendation |

## When to write a proposal

- A new backend (Windows, Linux distro-native, BSD, …).
- A breaking change to the authoring API or merge semantics.
- A new top-level command that changes the CLI's mental model.
- Cross-cutting changes that affect multiple subsystems.

You do **not** need a proposal for:

- Bug fixes.
- Internal refactors that preserve existing behavior.
- New helpers that fit the existing patterns documented in `SPEC.md` § 7.
- Documentation improvements.
