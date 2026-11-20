# Winix roadmap

What's next and what we're considering. Shipped work is in
[CHANGELOG.md](./CHANGELOG.md); design notes for bigger changes go in
[`spec/proposals/`](./spec/proposals/).

## Now

- **Fresh-machine rehearsal.** Run the Windows first run end to end on a clean
  VM (setup script → prerequisites → WSL distro → first Linux activation) and
  fix what it finds. Every piece is tested; the whole path on a new machine
  is not yet.

## Next

- **macOS at the same level as Windows and Linux.** Today the Mac works through
  npm and nix-darwin, without the conveniences the other two have:
  - standalone macOS executables (arm64, x64) with the pinned-version download
    and the `winix` command, as on Windows and Linux;
  - a `bootstrap-macos.sh` that installs Nix and does the first nix-darwin
    activation from a dotfiles repository (and a `setup/macos.sh` pattern for
    dotfiles repos);
  - remembered host, so `winix switch` needs no `--host`;
  - macOS CI (tests plus a smoke test of the executable);
  - a review of the darwin helpers (defaults, Homebrew, launchd, fonts) against
    what Windows offers, and a macOS guide.
- **One helper for a program on every OS.** Declare Git (or VS Code, starship,
  …) once and have each platform install and configure it the native way: Home
  Manager's `programs.git` on Linux and macOS, the WinGet package plus a
  generated config file on Windows. Something like
  `programs.git({ userName, userEmail, defaultBranch })` instead of a
  hand-written feature with `home.*` and `windows.*` halves. Start with Git (the
  [share-git-config guide](./docs/guides/share-git-config.md) shows the manual
  version), then grow the set from what configs use most. This replaces the
  older Windows-only `windows.programs.*` idea.
- **Lock hygiene.** Drop pins nothing declares any more (for example a WSL setup
  pin for a branch you moved away from), on `winix update` or a dedicated
  command.
- **Packages installed outside WinGet.** Store (MSIX) installs are invisible to
  `winget export`, so a declared package can be installed a second time. Detect
  and report them in `winix plan`.
- **Faster `plan`/`switch`.** The package inventory check (~10 s) and config
  evaluation (~2 s) dominate a no-change switch.

## Later

- **Documentation site** (Starlight). `docs/` is laid out to move into it; until
  then the Markdown in the repository is the documentation.
- **Interactive `winix init`** with presets (`minimal`, `wsl`, `cross-platform`)
  that scaffold the machines → roles → features layout when asked.
- **Machine-readable output:** `--json` for `check` and `inspect`.
- **Drift detection on Windows:** read current state with DSC `get` and report
  differences from `winix check`.
- **More Windows helpers:** registry values, services, firewall rules, OpenSSH
  server settings, and a minimum OS version guard (`windows.requireOsVersion`).
- **Resume after a restart:** let the Windows bootstrap continue by itself after
  the restart WSL needs (a one-time RunOnce entry), instead of asking the user
  to rerun it.
- **`winix switch --with-wsl`** (opt-in): apply the Windows host, then run the
  paired Linux host's switch inside its distro.
- **Signed Windows executables**, so SmartScreen and policies can trust them.
- **Secrets:** a cross-platform design (Credential Manager/DPAPI on Windows,
  agenix/sops-style on Nix) as its own proposal.

## Ideas

Worth keeping in mind; not planned.

- Typed `windows.dsc()` from DSC v3 resource schemas (like the generated Nix
  option types).
- Chocolatey and Scoop sources for `windows.package()`.
- Resolving `winix-windows.lock` without WinGet (from the winget-pkgs index), for
  CI on Linux.
- `winix doctor` to diagnose a machine's prerequisites and state.
- Merge modifiers (`override`, `prepend`, `replace`, `without`).
- Standalone Home Manager and nix-darwin backends (without NixOS).
- Applying to several machines over SSH.
- A VS Code extension (live Nix preview, links to option docs).
- A plugin API for third-party fragments published as npm packages.

## Known issues

- Home Manager configuration is generated inline in each host module rather
  than as a separate file.
