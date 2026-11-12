# Winix — Roadmap

Currently shipping v0.1.x. Focused on making the authoring experience excellent for both humans and AI agents.

## Next

- **`winix scaffold feature <name>`** — generate a typed feature template ready for an LLM (or human) to fill in.
- **Interactive `winix init` wizard** — guide users through platform, channel, Home Manager, example features, and Skill install with prompts (or skip with `--platform`, `--channel`, `--features`, `--skill` flags for power users).
- **Starlight docs site** — replace the long README with a proper documentation site at [starlight.astro.build](https://starlight.astro.build).
- **Windows integration** *(in progress)* — bring NixOS-style declarative system management to Windows via winget + DSC v3. Packages, locking, resource ordering, files, environment, settings, PowerShell modules, prerequisite bootstrap, WSL provisioning and opt-in first-run Linux activation are implemented; fresh-machine activation rehearsal remains pending. See the [detailed phase-by-phase roadmap](./spec/proposals/windows-backend.md#implementation-roadmap) in the proposal.

## Later

- **Init presets beyond the wizard** — first-class `--preset minimal`, `--preset wsl`, etc. once we see what real users actually pick.

## Done

- **Standalone release executables** — embedded Bun runtime/shared SDK for
  Windows and glibc Linux x64/ARM64, SHA256 release manifest, registry-free
  configuration loading, optional Node-free Windows prerequisite checks, and
  matching checksum-verified Linux executables for first-run WSL setup.
  Windows/Linux x64 smoke checks gate publication. ARM64 execution and
  fresh-image activation remain unverified; binaries are not yet code-signed.
- **WSL first-run Linux setup** — opt-in distro repository/config/host linkage,
  commit pins, declarative account bootstrap, unprivileged repository/npm/config
  preparation, and staged full Linux activation. Failures resume without resetting
  dirty checkouts; completed setup is never reapplied. Existing distros, passwords,
  authentication and manual reboot/shutdown boundaries remain protected.
  Fresh-image end-to-end activation remains unverified.
- **Windows-side WSL provisioning** — callable `windows.wsl()` combines feature
  enablement with optional typed `.wslconfig`; separate distro declarations support
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
