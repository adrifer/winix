# Changelog

Notable changes per release. Every release, with its downloadable assets, is on
[GitHub Releases](https://github.com/adrifer/winix/releases).

## Unreleased

- `winix switch`: when several installed packages are newer than the lock, the
  lock-update prompt accepts `a` to update this one and all the remaining ones
  without asking again.
- `winix plan`/`switch`: an older installed package that winget can't upgrade by
  id (installed by another installer, e.g. an organization's PowerShell 7 MSI)
  is kept with a note on how to hand it over to winget, instead of failing the
  switch and skipping everything that depends on it.

## 0.3.0

The release that makes Windows a first-class target and gives every platform
the same daily workflow.

### Windows

- **Native Windows hosts** (`platforms.windows()`): WinGet packages (locked in
  `winix-windows.lock`, `version: "any"` for self-updating apps), files and
  dotfile links (`windows.file.*`, known folders, config-relative sources,
  `.bak` backups), environment and PATH, settings and personalization, fonts,
  PowerShell 7 modules and repositories, npm registries, Windows features, DSC
  resources and raw commands, ordered with `dependsOn` handles.
- **Plan, then apply:** `winix plan` checks every resource against the machine
  and prints what would change; `winix switch` applies only that, with one UAC
  prompt for all elevated work, a progress spinner, and running apps detected
  before upgrades.
- **Removal ownership:** resources Winix created are removed when you delete
  their declaration; anything it adopted stays yours (`winix state …`).
- **Sign-in startup:** `windows.startup.app()` (logon tasks, no UAC),
  `windows.startup.shortcut()` and Explorer startup pacing.

### WSL

- **Windows provisions its NixOS-WSL distro** (`windows.wsl.distro()`): pinned,
  verified image; an existing distro is adopted instead of replaced; optional
  first-run setup clones the same repository and activates the paired Linux
  host. After that the distro is managed from inside WSL; a later change to the
  setup declaration prints a note instead of failing.

### Install and first run

- **Standalone executables** for Windows and Linux (x64, ARM64): no Node or npm
  needed. Checksums are verified for every download.
- **One-confirmation bootstrap** on Windows and Linux: clones a dotfiles
  repository, installs prerequisites, downloads the pinned Winix, asks which
  host this machine is (and remembers it), and applies it. Reruns after a
  restart pick up where they stopped; SSH clones of the same repository are
  reused.
- **A `winix` command** on Windows (`%LOCALAPPDATA%\Winix\bin`) and Linux
  (`~/.local/bin`): runs the version the checkout pins, downloading it when the
  pin changes, from any folder and without `--host`.
- **Editor types without npm:** every config command writes the running Winix's
  types to `.winix/types`; `winix init` generates a tsconfig that uses them.
  `node_modules` no longer changes what `winix` runs (`WINIX_SDK` runs another
  Winix explicitly).

### Authoring and CLI

- Features declare by effect through injected namespaces (`home.*`,
  `windows.*`, …), and one feature can cover every platform.
- `winix inspect` shows what each feature contributes per host;
  `winix inspect --matrix` shows every feature against every host, grouped by
  role. `winix check` only warns about inapplicable features listed on a host
  directly, so roles can span operating systems.
- `winix scaffold feature`, `winix package search`, `winix windows import`,
  `winix fonts search`, `winix types`, and `winix --skill` (version-matched agent
  instructions).
- Guides in `docs/guides`, backed by the tested `examples/cross-platform`
  workspace (organised as machines → roles → features).

## 0.2.x and earlier

NixOS, nix-darwin and Home Manager generation from TypeScript: the fragment and
helper model, the `nix.*` namespace, `nix.binaryRelease()`, generated option
types, and the `apply` / `switch` / `update` / `check` CLI. See
[GitHub Releases](https://github.com/adrifer/winix/releases).
