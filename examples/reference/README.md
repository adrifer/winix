# Reference example

An **anonymized, simplified port of a real-world Winix setup**. This is
the example you should read first if you want a feel for how a non-toy
Winix setup is structured.

## What it covers

- **2 hosts:**
  - `wsl`: NixOS-WSL + Home Manager
  - `workstation`: nix-darwin + Home Manager + Homebrew
- **3 profiles:** `home-base` (shared across platforms), `linux`, `macos`
- **14 features:** dotfiles, fzf, git, homebrew, javascript, macos, neovim,
  packages, playwright, starship, user-tony, wsl, zoxide, zsh

## Shape worth noticing

- **Composition by concatenation, not override.** `host(...)` takes a flat
  list of fragments. Profiles are just bundles of features. There's no
  "deep merge" or override dance.
- **Platform-conditional fragments.** See `features/zsh.ts`:
  `platforms.darwin.isActive` and `platforms.nixos.isActive` let you keep
  per-platform aliases in one file without splitting the feature.
- **Escape hatches are local.** `features/wsl.ts` uses `nixos({...})`
  for the WSL options tree (no dedicated `nixos.wsl()` helper exists,
  per the helper rules) and `nix.script(...)` for an interactive shell
  init block, because both are uglier in pure TypeScript than they are
  in pure Nix. The rest of the feature stays typed.
- **Stable channel overlay.** `profiles/linux.ts` and `profiles/macos.ts`
  pull `overlay.stable("nixpkgs-stable")` so a few packages (like
  `wslu`) can come from the stable channel without the whole config
  moving off unstable.

## What's *not* here (and why)

The real config has a few more things that aren't useful to visitors:

- **Work-only credential helpers** (Azure DevOps, internal repos) and a
  second WSL host for work. Removed for noise / not being a generic
  pattern.
- **A headless NixOS LXC** running Syncthing with a git-backup timer.
  Cool but very setup-specific; might come back as a `lxc-example/` if
  there's demand.
- **`dotnet`, `git-credential-manager`** features. Same reason: too
  workplace-flavored.

## Trying it locally

These files compile against `@adrifer/winix` as if you'd `npm install`'d
it. To actually run the config you'd want a real `package.json` +
`tsconfig.json` next to `winix.config.ts` (see the dotfiles repo for the
minimum boilerplate), plus the matching nix-darwin / NixOS-WSL setup on
the target machine.

## Verified

The `static-types > examples` test in this repo type-checks every `.ts`
file under `examples/` against the built package, so this whole tree is
guaranteed to compile against the current API.
