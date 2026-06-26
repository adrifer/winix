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
- Fail with a **clear, actionable error** if it can't, naming both fixes
  ("enable Developer Mode: Settings → Privacy & Security → For developers, or
  pass `elevate: true` to run this apply elevated"), not a cryptic `New-Item`
  error.
- **Not** auto-toggle Developer Mode or auto-emit a Developer Mode
  dependency (decided in review): Developer Mode is a machine-wide setting and
  mixing it into `file` is the wrong layer. The recommended long-term path is
  the user declaring Developer Mode themselves via the future
  `windows.setting()` helper; the per-apply escape hatch is `elevate: true`.

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
  backup?: boolean;       // when clobbering, rename the existing target to `<target>.bak` instead of deleting (default false)
  recursive?: boolean;    // symlink: link dir contents individually vs the dir itself
  elevate?: boolean;      // request UAC elevation for this apply, for symlinks when Developer Mode is off (default false)
  encoding?: "utf8" | "utf8bom" | "ascii";     // text mode (default "utf8", no BOM)
  dependsOn?: ResourceHandle | ResourceHandle[];
}
```

> **Note on `linkType`.** An earlier draft proposed a `linkType: "auto" |
> "symlink" | "junction"` knob to dodge the privilege problem with directory
> junctions. Dropped per review: symlinks are a niche dev need, and the
> cleaner escape hatch for the no-privilege case is `elevate: true` (request
> UAC), consistent with how `env` `scope: machine` already elevates. Junctions
> are not exposed as a user-facing option.

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

  // if Developer Mode is off, opt into elevation for this symlink
  windows.file.symlink(
    "%USERPROFILE%\\.wezterm.lua",
    "%USERPROFILE%\\dotfiles\\wezterm\\.wezterm.lua",
    { elevate: true }, // triggers a UAC prompt on apply
  );
});
```

## Idempotency + safety rules (the `path` lessons, applied)

Carried over from the hardware-validated `path` work:

1. **Surgical, never destructive.** `file.symlink`/`file.text` manage only
   the named target. Never touch sibling files. With `force: false` the helper
   must refuse to clobber a pre-existing *non-managed* file at the target and
   error clearly, rather than silently overwriting a user's real file. A
   single `force` flag (no separate dir flag, matching Home Manager) governs
   overwrite; `backup: true` renames the existing target to `<target>.bak`
   instead of deleting it. **A real directory with contents is never deleted
   even with `force: true`** — the helper errors and asks the user to move it
   (or use `backup`), so `file` can never `rm -rf` a populated directory by
   accident.
2. **Idempotent via `testScript`.** Re-apply is a no-op when the target
   already matches (same content for text; same link target for symlink).
3. **Encoding fidelity.** Text mode defaults to UTF-8 **without BOM** (the
   common cross-platform expectation); `encoding: "utf8bom"` opt-in. Avoid
   PowerShell's historical habit of injecting a BOM.
4. **Privilege-aware symlinks.** Detect elevation/Developer Mode; if neither,
   error clearly and point at the two fixes (Developer Mode, or `elevate:
   true`). No junction fallback, no auto-toggling Developer Mode.
5. **`%VAR%` expansion.** Targets and sources may contain environment
   variables (`%USERPROFILE%`, `%LOCALAPPDATA%`); expand them at apply time.

## Decisions (resolved in review, 2026-06-26)

The open questions below were settled with the owner:

1. **No auto-handling of Developer Mode state.** Symlinks are a niche dev
   need; `file` does not inspect or change settings beyond what it needs. If
   Developer Mode is off, the user passes **`elevate: true`** on the symlink
   call to run that apply elevated (UAC). This replaces the earlier
   `linkType: junction` idea.
2. **One `force` flag, plus `backup`, never delete a populated directory.**
   Mirrors Home Manager (single per-file `force`; backup-by-rename rather than
   a second flag). Real directories with contents are protected by behavior,
   not by an extra flag: even with `force: true` they are never `rm`'d.
3. **`executable` is omitted on Windows.** There is no POSIX exec bit on
   Windows (executability comes from extension/ACLs), so an `executable`
   option would be a no-op lie. Dropped rather than silently ignored.
4. **Developer Mode is not mixed into `file`.** Off → user passes `elevate:
   true` (detect-and-error points there). Declaring Developer Mode stays an
   explicit, separate concern (future `windows.setting()` helper).
5. **No template helper.** `file.text(target, content)` is enough; the user
   can build content in TypeScript.
6. **Drift tie-in accepted.** `testScript` already encodes desired state, so
   `file` slots into the Phase 5 `winix check` drift story for free.

## Remaining open question (for the PR thread)

- **`elevate: true` UX.** Elevation means that apply triggers a UAC prompt
  every run, which is friction for a recurring dotfile workflow. `elevate:
  true` is therefore positioned as a **secondary escape hatch**; the
  recommended path stays Developer Mode (one-time toggle, no per-apply
  prompt). Confirm this framing reads right in the docs/examples.

## Phasing

- **Phase A (MVP):** `file.text` + `file.remove` (content mode). No privilege
  concerns, immediately useful (lazygit/starship configs). Validate on
  hardware.
- **Phase B:** `file.symlink` for files, with privilege/Developer Mode
  detection and clear errors. The dotfile-reuse use case. Validate on
  hardware (elevated, Developer Mode on, and neither).
- **Phase C:** directory symlinks + `recursive` + `file.copy`. The trickiest
  cases.

## Validation plan (hardware, deferred)

Like `env`/`path`, design lands first; hardware validation follows on a real
Windows box. Tests to run when implementing:

- `file.text`: write/idempotent re-apply/remove; encoding has no BOM; `force`
  refuses to clobber an unmanaged file.
- `file.symlink` (file): non-elevated with Developer Mode **on** (expect
  success), non-elevated with Developer Mode **off** (expect the clear error,
  not a cryptic one), elevated (expect success).
- `file.symlink` (dir): file vs directory symlink; `recursive` true/false.
- Confirm the emitted YAML round-trips through a real YAML parser (inline
  PowerShell deserializes as multiline), as done for `path`.
