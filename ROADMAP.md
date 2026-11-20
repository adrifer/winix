# Winix — Roadmap

Currently shipping v0.1.x. Focused on making the authoring experience excellent for both humans and AI agents.

## Next

- **Interactive `winix init` wizard** — guide users through platform, channel, Home Manager, example features, and Skill install with prompts (or skip with `--platform`, `--channel`, `--features`, `--skill` flags for power users).
- **Starlight docs site** — replace the long README with a proper documentation site at [starlight.astro.build](https://starlight.astro.build). The Markdown guides in `docs/guides` (with title/description front matter) are laid out to move into it.
- **Windows integration** *(in progress)* — bring NixOS-style declarative system management to Windows via winget + DSC v3. Packages, locking, resource ordering, files, environment, settings, PowerShell modules, prerequisite bootstrap, WSL provisioning and opt-in first-run Linux activation are implemented; fresh-machine activation rehearsal remains pending. See the [detailed phase-by-phase roadmap](./spec/proposals/windows-backend.md#implementation-roadmap) in the proposal.

## Later

- **Init presets beyond the wizard** — first-class `--preset minimal`, `--preset wsl`, etc. once we see what real users actually pick.

## Done

- **Fast sign-in startup** — `windows.startup.app(name, spec)` registers a
  per-user "At log on" task in Task Scheduler's `\Winix\` folder (no UAC; runs
  as the user, no time limit, normal priority, on battery, one instance)
  instead of a Startup-folder shortcut, which Explorer opens last and one entry
  at a time (minutes on a machine with many startup apps). Window styles
  include `hidden` for console programs; `delay` staggers starts. Tasks are
  tracked in applied state by the hash of their exported XML and removed like
  shortcuts. `windows.startup.shortcut()` keeps the Startup-folder form
  (`windows.startup.command` is removed), and `windows.startup.explorer({
  delay, waitForIdle })` sets Explorer's own startup pacing in HKCU.

- **Switch speed and progress** — packages are read from one `winget export`
  (2–7 s instead of a 46 s batched DSC read on a 30-package host); DSC confirms
  any package the export does not list before switch installs it. A switch
  inventories once and reuses it for the plan, activation and reconciliation,
  re-reading the machine after applying only when something changed (lock
  updates use that result too). Startup shortcuts are fingerprinted in one
  PowerShell process. A no-change plan went from about 60 s to 14 s. In a
  terminal each phase shows a spinner with elapsed time and one line when done;
  applying shows the step in progress and the wait for the UAC prompt; switch
  ends with its total time. Switch prints one "Generated" line and no "Next:"
  hint, and drops the "Keeping … (locked …)" lines the plan already reports.
  The plan puts its counts in the header, aligns labels and details in
  columns, tags rows `[admin]`/`[running]` instead of repeating them in notes,
  uses real plurals, and is coloured on interactive terminals (`NO_COLOR`).
  The spinner starts with the command ("Loading configuration", "Checking
  winix-windows.lock"), and switch evaluates the workspace once instead of
  twice (about 2 s on a real workspace). Windows optional features are checked
  through WMI (`Win32_OptionalFeature`) instead of DISM, so a plan can confirm
  them without elevation and a no-change switch no longer asks for UAC just to
  look; enabling or disabling them still runs in the elevated step.
  Removals are rows of the plan (`- remove  Startup shortcut whkd  no longer
  declared`) instead of raw applied-state keys, with the data-loss warning only
  for package uninstalls and a prompt naming what it removes; resources left
  alone because Winix did not create them are listed with `i`. "Done in"
  excludes time spent at prompts.

- **Fast Windows switch** — `winix switch` no longer runs `winget configure`.
  Hosts generate `resources.json`; switch plans against the machine and applies
  only what is out of date (packages through `winget install`/`upgrade`,
  scripts in one PowerShell runner, other DSC resources through `dsc config
  set`), in dependency order, skipping only the dependents of a failure.
  Everything needing administrator rights runs in one elevated step (one UAC
  prompt). A no-change switch takes about as long as the plan instead of
  10–30 minutes. The bootstrap no longer enables WinGet configuration.

- **UAC prompts and interrupted switches** — `winix plan` lists installs and
  upgrades that will ask for administrator approval (machine-wide installs,
  packages without a per-user installer), and `winix switch` names them before
  it starts. The applied-state lock records its process, so a lock left by an
  interrupted switch is removed automatically. Replaced Startup shortcuts are
  backed up to `%LOCALAPPDATA%\Winix\startup-backups` instead of a `.lnk.bak`
  inside the Startup folder, which sign-in would try to open.

- **Running apps block upgrades** — `winix plan` warns when a package it would
  upgrade is running from a winget portable install, and `winix switch` stops
  before applying until it is closed (winget cannot replace it in place, and the
  failed upgrade removed its command link).

- **Merge fixes for Nix lists and tmpfiles** — array merges dedupe equal Nix
  expressions (two `nix.pkg("icu")`); `winix check` explains that a list written
  as one expression (`nix.withPkgs`) replaces the other and suggests an array;
  `nixos.systemd.tmpfiles.link(path, target)` emits keyed
  `systemd.tmpfiles.settings`, and raw `tmpfiles()` rules accept `nix.str`.

- **Docs and agent experience** — task guides in `docs/guides` (cross-platform
  feature, pairing Windows and WSL, sharing git config, PowerShell and Terminal)
  built on the runnable, tested `examples/cross-platform`; README gets a Guides
  index and the WSL pairing/interop sections defer to them. `winix scaffold
  feature <name>` writes a cross-platform template. `inspect` marks scopes a
  platform skips and shows the WSL variant. The agent skill teaches one feature
  per shared tool, with platform-only things kept separate. `winix init`'s tsconfig allows `.ts` import extensions.

- **Windows authoring conveniences** — `version: "any"` packages
  (presence-only, unlocked, self-updates aren't drift); Program Files known
  folders; `windows.powershell.profile()` / `windows.terminal.settings()`;
  `windows.configPath()`; file handles as startup paths with inferred
  dependencies; existing files/shortcuts backed up by default; personalization
  `colorMode`; optional `inputs` for Windows-only workspaces; check warns on
  unpinned packages; `winix package search` and read-only `winix windows
  import`.

- **CLI feedback loop** — `winix plan` / `switch --dry` prints a plan for Windows
  hosts (install/upgrade/apply/conflict/not-checked, elevation and restart
  notes, removals), checked live against the machine; real unified diffs for
  `apply --diff`; file resources share one content-addressed PowerShell module
  and the WSL setup runtime is only embedded in the set script (generated
  configuration of a real host: 385 KB to 164 KB); package inventory batched
  through one `dsc config get` per phase and reused by reconciliation;
  `inspect` shows each feature once with scopes, Windows resources and
  `dependsOn` edges; `--offline`/`--locked` for apply/switch/plan; the lock
  no longer writes `generatedAt`; `check` reports every missing pin kind,
  including the implicit Settings module. Startup shortcut scripts still inline
  their helpers (their definition hash is recorded in applied state).

- **Hybrid Windows ↔ WSL authoring** — `platforms.wsl()` NixOS variant (module
  import, `wsl.enable`, `platforms.wsl.isActive`); missing-input warnings for
  module imports; WSL setup `host`/`user` take host and account values;
  `repository: "self"` infers remote/branch/config directory from the checkout
  with a branch-independent completion fingerprint; full offline setup-plan
  validation on check/apply; config-relative `home.symlink("../…")`;
  `nix.wsl.windowsBin()` interop shims and `home.wsl.gitCredentialManager()`;
  post-switch Linux next-step commands. `switch --with-wsl` (driving Linux
  activation from Windows) and a cross-side `winix status` remain deferred;
  real first-run activation of a `"self"` setup is unverified.

- **Workspace validation** — check flags wholly ignored fragments and validates
  WSL setup host/user targets offline. WSL account defaults now follow the
  merged NixOS config rather than the profile name.

- **Windows npm registries** — host-scoped named default/scoped registry
  configuration in current-user .npmrc, preserving auth/unrelated settings with
  idempotent atomic updates. No package installation or registry allowlist
  enforcement; isolated file tests do not alter the shared user's npm config.

- **Windows personalization and fonts** — current-user wallpaper, explicit accent
  color, Explorer preferences and taskbar visibility/auto-hide; local/HTTPS/ZIP
  font installation with official Nerd Fonts discovery and separate checksum
  pins. Idempotent scripts, archive safety and CLI locking are covered without
  desktop activation. Native activation remains unverified; Google Fonts,
  font cleanup, per-monitor wallpapers and lock-screen policy remain deferred.

- **Windows stabilization** — in-process WSL release resolution works in the
  compiled executable as well as npm; explicit applied-state owner migration
  preserves shared-resource/drift/removal protections; implicit Settings modules
  use host-policy/source-aware pins with exact prerelease checks. The npm launcher
  and bootstrap agree on supported Node 22.13+/24/26 (26: erasable TypeScript only).
  Isolated regressions cover the Windows executable and real Node 22/24/26
  runtimes. Native Settings/side-by-side adapted discovery and fresh-machine
  activation remain unverified.
- **Repository bootstrap and local SDK handoff** — Windows and Linux entrypoints
  clone/validate trusted HTTPS repositories, read exact SDK pins without evaluating
  config, verify matching standalone downloads, and separate no-change dry runs,
  preparation-only validation and confirmed activation. Node/npm stay optional;
  checkout launchers prefer a matching installed SDK and reject stale versions.
  Linux supports existing Nix tools and private NixOS runtime libraries. Fresh
  branch-based WSL setups retain full history/upstream tracking while activating
  only the locked commit; completed setups remain untouched.
- **Windows package update defaults** — native switch preserves newer floating
  packages, refreshes owned upgrade observations, and offers interactive
  default-no lock updates. Inline versions remain exact; pre-installed packages
  stay externally owned and unsafe removals remain protected. Floating packages with
  an unknown installed version are ensured present without a version (no
  reinstall loop) and block automatic removal.
- **Standalone release executables** — embedded Bun runtime/shared SDK for
  Windows and glibc Linux x64/ARM64, SHA256 release manifest, registry-free
  configuration loading, optional Node-free Windows prerequisite checks, and
  matching checksum-verified Linux executables for first-run WSL setup.
  Non-login WSL probes/setup initialize the NixOS system PATH explicitly,
  without sourcing user/root shell profiles.
  Windows/Linux x64 smoke checks gate publication. ARM64 execution and
  fresh-image activation remain unverified; binaries are not yet code-signed.
- **WSL first-run Linux setup** — opt-in distro repository/config/host linkage,
  commit pins, declarative account bootstrap, unprivileged repository/npm/config
  preparation, and staged full Linux activation. Failures resume without resetting
  dirty checkouts; completed setup is never reapplied. Existing distros, passwords,
  authentication and manual reboot/shutdown boundaries remain protected.
  Fresh-image end-to-end activation remains unverified.
- **Windows prerequisite inference** — symlinks automatically depend on explicitly
  declared same-host Developer Mode settings, without enabling the policy implicitly.
- **Idempotent WSL distro declarations** — one `windows.wsl.distro()` creates
  absent distros or adopts matching WSL 2/NixOS/Linux hostname registrations.
  GUID/location tracking protects subsequent runs. Adoption preserves the existing
  distro and skips Linux setup/default changes; Linux activation stays manual.
- **Windows-side WSL provisioning** — callable `windows.wsl()` combines the normally
  locked `Microsoft.WSL` package and feature enablement with optional typed
  `.wslconfig`; separate distro declarations support
  NixOS-WSL registration with verified, locked x64/ARM64 images. Reboot
  boundaries require manual restart and rerun; existing/unrecorded distros are
  protected, image updates never reinstall them, and removal never deletes data.
- **NixOS prerequisite bootstrap** — standalone Bash script opens a temporary
  Git/Node.js 24/npm environment from pinned nixpkgs, with session-only flakes
  support and no profile/system changes. Published as a GitHub release asset
  with a SHA256 checksum; does not install Winix or activate hosts.
- **Windows prerequisite bootstrap** — standalone PowerShell 5.1/7 script with
  read-only checks, confirmed WinGet prerequisite installs, optional NVM-based
  Node setup, resource/capability verification, explicit failures, and GitHub
  release assets with SHA256 checksums. Does not
  activate hosts or reboot; clean-machine rehearsal remains pending.
- **Windows removal ownership** — per-user/machine applied-state tracking,
  shared workspace/host requirements, automatic unused owned package and
  unchanged startup cleanup on `switch`, pre-activation removal confirmation
  (`--yes` for automation), drift guards, dry previews, and
  `state forget` to release deletion rights without removing resources.
- **Windows sign-in startup** — `windows.startup.command()` manages current-user
  shortcuts with activation-time paths, Unicode-safe argv, dependency ordering,
  staged verification, and explicit backup/replacement protection.
- **Declarative Windows shell primitives** — activation-time known-folder file
  targets, config-relative copy/symlink sources (including optional file URLs),
  and PowerShell 7 modules pinned alongside packages in `winix-windows.lock`.
- **Host-scoped PowerShell feeds** — composable work-profile repository policy,
  strict allowlists without public fallback, named HTTPS registration during
  activation, Settings installer selection, and source-aware module pins.
- **Read-only PowerShell lock resolution** — reuse matching registrations or
  query feeds directly, with no repository changes even on a dry run.
- **PowerShell 7 execution** — file/PATH/module scripts use DSC's native
  PowerShellScript resource without a nested shell; raw command strings default
  to `pwsh`. Native Registry environment handling remains unchanged.
- **Winix Skill** — `winix --skill` prints version-matched instructions from
  the installed executable. `winix init` and `winix install skill` install a
  project-local wrapper that loads them.

## Maybe / exploratory

- VS Code extension / LSP (live Nix preview, jump-to-NixOS-docs, smart snippets — most other LSP value is already covered by TS types).
- Plugin/extension API (third-party fragments distributed as npm packages).
- Multi-machine orchestration (apply to N hosts over SSH).
- `winix doctor` diagnostic command.
- Merge modifiers (`override`, `prepend`, `replace`, `without`).
- Home Manager / nix-darwin standalone backends.

## Shipped (v0.1.x)

The current API includes the full fragment/helper model, NixOS + nix-darwin + Home Manager support, the `nix.*` namespace, intent helpers, dynamic type generation for ~24k options, and a working `apply` / `switch` / `update` / `check` CLI.

See [GitHub Releases](https://github.com/adrifer/winix/releases) for per-version notes, and [`spec/`](./spec/) for the design documents.

## Known Issues

- Needs Node 22+ with native `.ts` execution.
- Home Manager config is inline in host module (not split file).
