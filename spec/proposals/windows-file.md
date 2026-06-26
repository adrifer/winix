# Proposal: `windows.file` — declarative files and dotfile symlinks

> **Status:** `draft`
> **Owner:** unassigned
> **Depends on:** `windows-backend.md` (Phase 4 originally sketched a
> content-only `windows.file()`; this proposal expands that scope to cover
> symlinks and source files, the primitives a real dotfile workflow needs).

## Motivation

The Windows backend can install packages and manage environment variables,
but it cannot yet manage **files**. Files are the backbone of a dotfile
workflow: editor configs, shell rc files, tool configs (`lazygit`,
`komorebi`, `starship`, `wezterm`…), all of which live as files in
well-known locations.

The concrete trigger: while validating `windows.env` end-to-end, setting
`EDITOR=nvim` was not enough to make `lazygit` open nvim, because lazygit
reads its own `config.yml`. Writing that file is exactly the job a
`windows.file` helper should do. More broadly, the author wants to **reuse
the same dotfiles already managed on Linux** (via Home Manager) on Windows
hosts, from one `winix.config.ts`.

The north star is parity of *intent* with Home Manager's `home.file`:

```nix
# Home Manager (Linux/macOS) — what we want to feel like on Windows
home.file.".config/lazygit/config.yml".source = ./lazygit/config.yml;
home.file.".gitconfig".text = "...";
xdg.configFile."nvim".source = config.lib.file.mkOutOfStoreSymlink ./nvim;
```

## Reference: how Home Manager models files

Home Manager's `home.file.<name>` submodule (modules/lib/file-type.nix) is
the design we mirror. Its relevant options:

| Option | Meaning |
|---|---|
| `target` | Destination path (defaults to the attribute name) |
| `text` | Literal file content (mutually exclusive with `source`) |
| `source` | Path of a source file or directory to link/copy |
| `executable` | Mark the result executable (POSIX; see Windows notes) |
| `recursive` | If `source` is a directory: link each file individually (`true`) vs symlink the whole directory (`false`, default) |
| `force` | Overwrite an existing file/symlink at the target |

Plus the crucial helper `config.lib.file.mkOutOfStoreSymlink <path>`, which
links the target to a **mutable path outside the Nix store**, so editing the
real dotfile reflects immediately without a rebuild. On Windows there is no
Nix store, so the "out of store" distinction collapses: a `source` is always
just a path on disk. That actually *simplifies* the Windows model.

## The hard part: symlinks on Windows are not symlinks on Linux

This is the entire reason `file` is not a trivial helper. Researched facts
(2026-06-26):

1. **Creating a symlink on Windows requires privilege by default.** The
   caller needs `SeCreateSymbolicLinkPrivilege`, which by default is granted
   only to Administrators and is gated by UAC. A non-elevated
   `New-Item -ItemType SymbolicLink` fails with
   `Administrator privilege required for this operation`.

2. **Developer Mode lifts the restriction without admin.** Since Windows 10
   1703 (Creators Update), enabling Developer Mode lets a normal user create
   symlinks with no UAC elevation. This is the path a dotfile workflow wants:
   a one-time toggle, no per-apply elevation. Detectable via registry:
   `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock` →
   `AllowDevelopmentWithoutDevLicense` = `1`.

3. **Directory junctions need no privilege, but only work for directories on
   the same volume.** `mklink /J` / `New-Item -ItemType Junction` creates a
   junction with no elevation, but junctions are directory-only and do not
   span volumes (and behave subtly differently from symlinks for some tools).
   Not a general substitute, but a useful fallback for directory links when
   Developer Mode is off.

4. **WSL can create symlinks without privilege.** Out of scope here (that is
   the NixOS-WSL path), noted for completeness.

### Design consequence

`file` must be **privilege-aware**, the same lesson learned with `env`
(`scope: machine` needs elevation). The emitted script must:

- Detect whether symlink creation will succeed (elevated **or** Developer
  Mode on) before attempting it.
- Fail with a **clear, actionable error** if it can't, naming the fix
  ("enable Developer Mode: Settings → Privacy & Security → For developers, or
  run elevated"), not a cryptic `New-Item` error.
- Ideally cross-reference the planned `windows.setting()` / Developer Mode
  helper (windows-backend.md Phase 3) so a user can declare Developer Mode in
  the same workspace and have `file` depend on it.

## Resource backing (no native file resource exists)

Confirmed: **DSC 3.2.2 ships no native file or symlink resource.** The
built-in catalogue is registry, process, runcommandonset, windows_service,
windows_firewall, sshdconfig, etc. There is no `Microsoft.Windows/File`.

Therefore `file`, like `path`, is emitted via the built-in
`Microsoft.DSC.Transitional/WindowsPowerShellScript` resource with idempotent
`getScript`/`testScript`/`setScript`. This keeps the zero-runtime-deps
property (no PSDSC module install) and reuses the exact mechanism already
validated for `path` on hardware.

Two emission modes, picked by the helper from its arguments:

- **content mode** (`text`): write the literal bytes to the target.
  `testScript` compares current file content (and encoding) to desired.
- **symlink mode** (`source`): create a symlink (file) or symlink/junction
  (directory) at the target pointing to `source`. `testScript` checks that
  the target is a link pointing at `source`.
- (optional, later) **copy mode**: `source` copied rather than linked, for
  cases where a live link is undesirable.

## Proposed authoring API

```ts
// Literal content
windows.file.text(target: string, content: string, opts?: WinFileOpts): ResourceHandle

// Symlink to a source path on disk (the dotfile workflow)
windows.file.symlink(target: string, source: string, opts?: WinFileOpts): ResourceHandle

// Copy a source to the target (no live link)
windows.file.copy(target: string, source: string, opts?: WinFileOpts): ResourceHandle

// Remove a managed file/link at target
windows.file.remove(target: string, opts?: WinFileOpts): ResourceHandle

interface WinFileOpts {
  force?: boolean;        // overwrite an existing file/link at target (default false)
  recursive?: boolean;    // symlink: link dir contents individually vs the dir itself
  linkType?: "auto" | "symlink" | "junction"; // dir links: prefer junction when no privilege (default "auto")
  encoding?: "utf8" | "utf8bom" | "ascii";     // text mode (default "utf8", no BOM)
  dependsOn?: ResourceHandle | ResourceHandle[];
}
```

Naming follows the intention-verb style settled for `env`/`path`
(`env.set/remove`, `path.add/remove`): `file.text/symlink/copy/remove`. The
verb says what happens; the underlying script resource stays hidden.

### Example: reuse a Linux dotfile on Windows

```ts
host("ADRIFER-VISION", platforms.windows(), ({ windows }) => {
  // editor config as a live symlink to the repo dotfile
  windows.file.symlink(
    "%LOCALAPPDATA%\\lazygit\\config.yml",
    "%USERPROFILE%\\dotfiles\\lazygit\\config.yml",
  );

  // a small config written inline
  windows.file.text(
    "%USERPROFILE%\\.config\\starship.toml",
    'add_newline = false\n',
  );

  // whole nvim config directory linked
  windows.file.symlink(
    "%LOCALAPPDATA%\\nvim",
    "%USERPROFILE%\\dotfiles\\nvim",
    { recursive: false }, // link the directory itself
  );
});
```

## Idempotency + safety rules (the `path` lessons, applied)

Carried over from the hardware-validated `path` work:

1. **Surgical, never destructive.** `file.symlink`/`file.text` manage only
   the named target. Never touch sibling files. `force: false` must refuse to
   clobber a pre-existing *non-managed* file at the target and error clearly,
   rather than silently overwriting a user's real file.
2. **Idempotent via `testScript`.** Re-apply is a no-op when the target
   already matches (same content for text; same link target for symlink).
3. **Encoding fidelity.** Text mode defaults to UTF-8 **without BOM** (the
   common cross-platform expectation); `encoding: "utf8bom"` opt-in. Avoid
   PowerShell's historical habit of injecting a BOM.
4. **Privilege-aware symlinks.** Detect elevation/Developer Mode; clear error
   if neither; allow `linkType: "junction"` as a no-privilege directory
   fallback.
5. **`%VAR%` expansion.** Targets and sources may contain environment
   variables (`%USERPROFILE%`, `%LOCALAPPDATA%`); expand them at apply time.

## Open questions (for the PR thread)

1. **Directory symlink default when Developer Mode is off.** Auto-fallback to
   a junction (works, no privilege, but directory-only/same-volume), or hard
   error and make the user choose? Leaning: `linkType: "auto"` tries symlink,
   falls back to junction for directories, errors for files.
2. **`force` semantics.** Should `force: true` also replace a real directory
   with a link? That is destructive; maybe require an even more explicit
   opt-in.
3. **`executable` from Home Manager.** Largely meaningless on Windows (no
   POSIX exec bit; executability is by extension/ACL). Probably **omit** the
   option on Windows rather than no-op it, to avoid implying a guarantee.
4. **Relationship to `windows.setting()` / Developer Mode.** Should
   `file.symlink` auto-emit a Developer Mode assertion / dependency, or just
   detect-and-error? Auto-emitting changes machine state (Developer Mode is a
   machine-wide toggle) and may need elevation itself, so detect-and-error is
   the safer default; declaring Developer Mode stays the user's explicit call
   via the (future) `windows.setting()` helper.
5. **Content source for `text` from a file.** Do we want
   `file.text(target, readFileSync(...))` ergonomics, or a dedicated
   `file.fromTemplate(...)`? Probably out of scope: the user can read the
   file in TS.
6. **Drift / `winix check`.** `testScript` already encodes desired state, so
   `file` slots into the Phase 5 drift-detection story for free.

## Phasing

- **Phase A (MVP):** `file.text` + `file.remove` (content mode). No privilege
  concerns, immediately useful (lazygit/starship configs). Validate on
  hardware.
- **Phase B:** `file.symlink` for files, with privilege/Developer Mode
  detection and clear errors. The dotfile-reuse use case. Validate on
  hardware (elevated, Developer Mode on, and neither).
- **Phase C:** directory symlinks + `recursive` + junction fallback +
  `file.copy`. The trickiest cases.

## Validation plan (hardware, deferred)

Like `env`/`path`, design lands first; hardware validation follows on a real
Windows box. Tests to run when implementing:

- `file.text`: write/idempotent re-apply/remove; encoding has no BOM; `force`
  refuses to clobber an unmanaged file.
- `file.symlink` (file): non-elevated with Developer Mode **on** (expect
  success), non-elevated with Developer Mode **off** (expect the clear error,
  not a cryptic one), elevated (expect success).
- `file.symlink` (dir): symlink vs junction fallback; `recursive` true/false.
- Confirm the emitted YAML round-trips through a real YAML parser (inline
  PowerShell deserializes as multiline), as done for `path`.
