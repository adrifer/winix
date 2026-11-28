# Changelog

Notable changes per release. Every release, with its downloadable assets, is on
[GitHub Releases](https://github.com/adrifer/winix/releases).

## 0.4.3

- **Replacing existing file targets no longer blocks a switch:** an existing
  link (including one whose target is gone, as after moving the checkout) is
  replaced instead of being moved to `.bak`, and when `<file>.bak` already
  exists the new backup goes next to it as `<file>.<timestamp>.bak` instead of
  failing with "Backup target already exists".

## 0.4.2

- **Moving a checkout no longer needs manual repair:**
  - `winix switch` takes over the Windows ownership records a moved checkout
    left behind (same host, old folder without a config, one candidate). `winix
    plan` shows it, `switch` asks once (`--yes` accepts; without a terminal it
    leaves them apart).
  - `winix state migrate-owner` works without an id (the checkout that moved
    here) or with the old config folder, and `--host` defaults to the
    remembered host, else the PC's name.
  - The pinned Linux runtime in `.winix/runtime` is rewired in place when the
    checkout moved, instead of failing on the old paths (NixOS loader links are
    rebuilt, so they stay protected from garbage collection).
  - When a config moves inside its repository (`dotfiles/winix` to `dotfiles`),
    the `winix` command follows it from any folder and keeps the remembered host.
- **Installers find the config folder:** without `-ConfigDirectory` /
  `--config-directory`, `install.ps1` and `install.sh` use the repository root
  when it holds `winix.config.ts`, else `winix/`. A repository without a config
  now starts one at its root.
## 0.4.1

- **Native Windows settings backend:** All `windows.settings()` sections
  (`theme`, `explorer`, `taskbar`, `start`, `developer`, `clipboard`, `time`,
  `keyboard`, `mouse`, and `notifications`) now check and apply natively through
  Windows registry and system APIs (`Get-TimeZone`/`Set-TimeZone`, `SystemParametersInfo`,
  `SHAppBarMessage`) instead of the incomplete `Microsoft.Windows.Settings 0.1.1-alpha`
  DSC module.
  - Fixes `winix plan` and `winix switch` errors on `time.*`, `taskbar.multiMonitor*`,
    `taskbar.alignment: "center"`, `taskbar.badges`, `taskbar.grouping`, `start.*`,
    `theme.transparency`/`autoColorization`/`accentOn*`, and `notifications.*`.
  - Per-user sections (`theme`, `explorer`, `taskbar`, `start`, `clipboard`,
    `keyboard`, `mouse`, `notifications`) no longer require elevation, and
    machine-wide sections (`developer`, `time`) check without UAC during `winix plan`.
  - Removes the implicit `Microsoft.Windows.Settings` PowerShell module lock dependency.

## 0.4.0

- **Unified `windows.settings()` API (breaking change):**
  - Replaces `windows.setting()`, `windows.personalization()`, and
    `windows.startup.explorer()` with a single camelCase `windows.settings({ ... })`
    helper and 1-to-1 section helpers: `windows.settings.theme()`,
    `windows.settings.explorer()`, `windows.settings.taskbar()`,
    `windows.settings.start()`, `windows.settings.developer()`,
    `windows.settings.clipboard()`, `windows.settings.time()`,
    `windows.settings.keyboard()`, `windows.settings.mouse()`, and
    `windows.settings.notifications()`.
  - Elevation and backend routing are automatic per key: per-user preferences
    apply without administrator rights, machine-wide keys join `winix switch`'s
    single elevated step, and `Microsoft.Windows.Settings` is only installed and
    locked when a key backed by it is declared.
  - Adds new typed settings:
    - `developer.sudo` (`"disabled" | "newWindow" | "disableInput" | "inline"`)
      and `developer.longPaths` (Win32 paths over 260 characters).
    - `explorer.classicContextMenu`, `explorer.showFullPathInTitleBar`,
      `explorer.compactMode`, `explorer.startupDelay`, and `explorer.waitForIdle`.
    - `taskbar.endTask` (right-click "End task").
    - `clipboard.history` (per-user `Win+V` Clipboard History).
    - `keyboard` (`repeatDelay`, `repeatSpeed`) and `mouse` (`speed`,
      `enhancePointerPrecision`, `swapButtons`), applied live via
      `SystemParametersInfo`.
- **Declarative Windows registry helper:**
  - `windows.registry.set()` and `windows.registry.remove()` manage registry
    keys and values via `Microsoft.Windows/Registry`, with automatic elevation on
    machine hives and inferred or explicit value types.

## 0.3.7

- `winix update` on Linux, WSL and macOS now generates only Nix hosts when
  updating `flake.lock`, instead of also generating Windows hosts (which failed
  in the Linux standalone executable when a Windows host declared WSL setup).
- Every public helper and option has a doc comment, shown on hover in your
  editor, and the docs have an **API** section generated from them: one page
  per namespace, every call with its signature and options.

## 0.3.6

- **`winix upgrade`** moves your config's Winix pin to the latest release (or
  `winix upgrade 0.3.5`), keeping the pin's form, with `--dry` to preview and a
  link to the changelog. The next `winix` command downloads it. `winix update`
  still never changes Winix, and now ends with a line when a newer release
  exists. The docs no longer use `npm install` to update Winix; npm remains the
  macOS route until macOS has a standalone executable.

## 0.3.5

Install Winix without a repository, a `winix` command that works from any
folder, and a real `winix plan` on NixOS.

- **One install script per platform: `install.ps1` and `install.sh`** replace
  `bootstrap-windows.ps1`, `bootstrap-linux.sh` and `bootstrap-nixos.sh`.
  Without a repository they install the latest Winix (or `-Version`) and a
  `winix` command, ready for `winix init`; on Windows they first install Git,
  PowerShell 7 and DSC when missing. With `-Repository` they set the machine up
  from it as before, and a repository without a config yet gets the latest
  Winix and a hint to run `winix init`. The npm-route options (`-Check`,
  `-Standalone`, `-UseNvm`, Node.js installation) are gone, and repository
  setup no longer downloads the script a second time. A dotfiles setup script
  that downloads `bootstrap-windows.ps1` from a release needs to download
  `install.ps1` from this release on.
- **`winix install command`** installs the running Winix for your user
  (`%LOCALAPPDATA%\Winix` or `~/.local/share/winix`) and puts the `winix`
  command on PATH, also after downloading the executable by hand.
- **The `winix` command works from anywhere.** Inside a project it runs the
  version that project pins, there; elsewhere, `switch` and the other project
  commands use the checkout bootstrap set up, and `init`, `--version` or
  `windows search` run in the current folder. Before, every command ran in the
  bootstrapped checkout, so `winix init` in a new folder failed. Bootstrap no
  longer writes `.winix/bin` launchers; existing ones keep working.

- `winix plan` on NixOS and WSL hosts shows what a switch would change, like on
  Windows: it builds the new system without activating it and compares it with
  the running one. Declared packages installed, upgraded or removed (with
  versions), changed Home Manager files and `/etc` files, services that would
  start, stop, restart or reload (from NixOS's own dry run when `sudo` needs no
  password, otherwise estimated), the NixOS version, and a restart notice when
  the kernel changes. `winix switch` shows the same plan before activating, and
  skips activation when the system is unchanged. `winix plan --no-build` skips
  the build and only shows the command.

## 0.3.2

- WSL: `home.wsl.gitCredentialManager()` works again. Its shim (any
  `nix.wsl.windowsBin` path that starts with `%VARIABLE%`) expanded the path
  through `cmd.exe`, which swallowed stdin, so Git Credential Manager never got
  Git's request ("fatal: Missing 'protocol' input argument").

## 0.3.1

Fixes from setting up a fresh Dev Box end to end, `winix update` and
`--update-versions` on Windows, and a clearer `winix --help`.

- `winix --help` is shorter and grouped (day to day, writing configuration,
  setup), with aligned columns and current descriptions. `winix <command> --help`
  shows that command's options. Plumbing is no longer listed but still works:
  `winix run`, `switch --dry` (use `winix plan`) and `bootstrap --command-only`.
- The Windows authoring helpers are `winix windows search <query>`,
  `winix windows import` and `winix windows fonts [query]`. The older names
  `winix package search` and `winix fonts search` still work, and
  `--provider nerd-fonts` is no longer required.
- `winix switch` (standalone Windows executable): applied and failed steps show
  a check mark and a cross again, instead of the escape codes for them (backslash-u2713 and
  backslash-u2717).
- `windows.wsl()` installs Microsoft.WSL in switch's elevated step. winget
  could pick its MSIX installer for a non-elevated install, which then failed
  with "administrator privileges are required" (0x80073D28) and skipped the
  distro.
- Windows bootstrap: when `winget` is missing, it first registers App Installer
  for this user (a fresh account often has it installed but not registered yet)
  before opening the Microsoft Store.
- `winix switch`: when several installed packages are newer than the lock, the
  lock-update prompt accepts `a` to update this one and all the remaining ones
  without asking again.
- `winix plan`/`switch`: an older installed package that winget can't upgrade by
  id (installed by another installer, e.g. an organization's PowerShell 7 MSI)
  is kept with a note on how to hand it over to winget, instead of failing the
  switch and skipping everything that depends on it.
- `winix switch`: a failed package **upgrade** no longer skips what depends on
  that package; the older version is still installed. The failure is still
  reported (for example winget's "install technology is different" error, which
  needs an uninstall and a fresh install). A failed install still skips its
  dependents.
- `winix switch --update-versions` raises `winix-windows.lock` to every
  installed version newer than it, without the per-package prompt.
- `winix update` on native Windows updates `winix-windows.lock`, like
  `winix update --windows`, instead of failing because there is no Nix CLI. The
  Nix flake lock is still updated from WSL, Linux or macOS.

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
