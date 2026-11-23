---
title: WSL distros
description: windows.wsl and windows.wsl.distro - install WSL, create or adopt a NixOS-WSL distro, set it up from your repository, and reach Windows from inside it.
sidebar:
  order: 3
---

# WSL distros

A Windows host can install WSL, create a NixOS-WSL distro, and set that distro
up as a Linux host from the same repository. Walkthrough:
[Pair a Windows host with its WSL host](../guides/pair-windows-and-wsl.md).

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  windows.wsl({ config: { wsl2: { memory: "16GB", processors: 8 } } });
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
    default: true,
    setup: { repository: "self", host: linuxHost, user: alice },
  });
});
```

Winix never restarts Windows, shuts down WSL, or replaces, moves, converts or
unregisters a distro, and never deletes distro data.

## windows.wsl

`windows.wsl({ config?, backup?, force?, dependsOn? })` installs the
`Microsoft.WSL` package and enables the Windows Subsystem for Linux and Virtual
Machine Platform features. Both need administrator rights and run in the
elevated step. When Windows asks for a restart, what depends on them waits:
restart yourself and switch again.

`config` manages your whole `~/.wslconfig`, with the usual
[backup](windows/files.md#existing-files) of an existing file. Without it the
file is left alone. A change takes effect when WSL restarts; Winix reminds you,
and you run `wsl --shutdown` when it suits you.

The package follows the normal version lock; declare
`windows.package({ id: "Microsoft.WSL", ... })` yourself to change its options.
Declare `windows.wsl()` in the same host as its distros.

## windows.wsl.distro

`windows.wsl.distro(name, spec)`; `name` is the WSL registration name
(`wsl -d NixOS`).

| Option | |
|---|---|
| `source` | `"nixos-wsl"`: the official NixOS-WSL image. |
| `installLocation` | Where to create it: an absolute path, a `%VARIABLE%` path or a known folder. Must not exist yet. |
| `default` | Make it the default distro (`wsl` with no `-d`). At most one per host. |
| `host` | The Linux hostname an existing distro must report to be adopted (default: `setup.host`). Takes a `host()` value or a name. |
| `setup` | First-run setup of a new distro (below). |
| `dependsOn` | Extra handles; WSL, its features and `.wslconfig` are added automatically. |

### Creating

When no distro with that name is registered, Winix downloads the NixOS-WSL
image pinned in `winix-windows.lock` (URL and SHA-256 for x64 and ARM64),
verifies it, and imports it as your user at `installLocation`. A marker file in
that folder identifies the registration later. `winix update nixos-wsl` moves
the image pin; that only affects distros created afterwards.

### Adopting

When the name is already registered, Winix adopts that distro if it's WSL 2,
runs NixOS and reports the expected hostname (`host`, or `setup.host`); without
either, an existing distro is refused. Adoption records the registration and
does nothing else: no setup, no default change, no repository code runs. Later
switches check it's still the same distro.

Records live in `%LOCALAPPDATA%\Winix\wsl-registrations`. Deleting the
declaration leaves the distro, its data and the record alone.

## First-run setup

```ts
setup: {
  repository: "self",           // or an HTTPS URL
  ref: "main",                  // default: the remote's default branch
  configDirectory: "winix",     // where winix.config.ts is, in the repository
  host: linuxHost,              // the Linux host to activate
  user: alice,                  // its account.user
  checkout: "/home/alice/dotfiles",
}
```

For a **new** distro, setup clones the repository inside it and activates the
Linux host, so the distro comes up fully configured.

| Option | |
|---|---|
| `repository` | An HTTPS Git URL without credentials, or `"self"`: the remote of the checkout holding `winix.config.ts` (SSH remotes become HTTPS). |
| `ref` | Branch, tag or commit. With `"self"`, the current branch's upstream. |
| `configDirectory` | The config's folder in the repository. With `"self"`, inferred. |
| `host` | The Linux host, by `host()` value or name. Must be a `platforms.wsl()` host. |
| `user` | The `account.user` to set up, by value or name. Optional when the host has a single normal user. |
| `checkout` | Where to clone. Default `<home>/dotfiles`; must be inside the user's home. |

`winix check` validates all of it before any distro exists: the host is a
NixOS-WSL host with a `stateVersion`, the user is a normal user there, and the
checkout stays in its home.

**Pinned.** The first switch pins the commit to set up from in the
`wslRepositories` section of `winix-windows.lock`; `winix update wsl-setup`
moves it. Push your branch first: the commit is resolved on the remote.

**What runs.** Inside the new distro, Git and the config preparation run as the
image's initial `nixos` user. Setup then activates your account and the WSL
basics, hands the checkout to your user, builds the full host as that user and
activates it. It installs the `winix` command for your user and remembers the
host. No password is invented and `sudo` rules aren't changed.

**Trust.** Setup runs your repository's config, so declare only repositories
you trust. Private repositories need authentication that already works inside
the distro; setup doesn't provide credentials.

When `ref` is a branch, the checkout is on that branch (at the pinned commit),
so `git pull` inside the distro works as usual; a tag or commit stays detached.

**Once.** Setup runs one time per distro. A failure is resumable: switch again
and it continues from the failed stage, never resetting a checkout with local
changes. After it completes, the distro is managed from inside WSL (`winix
switch` there); a later change to `setup` only prints a note. After every
Windows switch Winix prints the command that applies Linux changes in each
distro.

## Reach Windows from WSL

```ts
home.packages(nix.wsl.windowsBin("code", "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code"));
home.wsl.gitCredentialManager();
```

`nix.wsl.windowsBin(name, paths)` builds a `bin/<name>` command that runs the
first of `paths` that exists on Windows. Paths are absolute (`C:\...`) or start
with an environment variable (`%LOCALAPPDATA%\...`), expanded through
`cmd.exe` when it runs (about 50 ms), so nothing hard-codes your Windows user
name. It exits with 127, listing the paths it tried, when none exist.

`home.wsl.gitCredentialManager({ paths? })` enables Git in Home Manager and
sets its credential helper to Git for Windows' Credential Manager through such
a command, so Git inside WSL uses your Windows sign-ins.
