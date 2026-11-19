---
title: Pair a Windows host with its WSL host
description: Have Windows create a NixOS-WSL distro and set it up from the same checkout.
---

# Pair a Windows host with its WSL host

One checkout describes both machines: the Windows host creates a NixOS-WSL
distro, and on first run sets it up as a Linux Winix host from the same
repository. You declare the pairing by passing values, not by repeating names.

## 1. The Linux host

From [`examples/cross-platform/winix.config.ts`](../../examples/cross-platform/winix.config.ts):

```ts
const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", { follows: { nixpkgs: "nixpkgs" } }),
  nixosWsl: input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } }),
});

const alice = account.user("alice", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

const wslWork = host("wsl-work", platforms.wsl({ stateVersion: "25.05" }), [
  alice(),
  everywhere(),
  windowsInterop(),
]);
```

- `platforms.wsl()` is NixOS under WSL: it imports the NixOS-WSL module and sets
  `wsl.enable`. It needs the `nixosWsl` input; `winix check` warns if it is missing.
- `wslDefault: true` makes `alice` the distro's default user.

## 2. The Windows host

```ts
const desktop = host("DESKTOP", platforms.windows(), ({ windows }) => {
  windows.wsl();
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
    default: true,
    setup: { repository: "self", host: wslWork, user: alice },
  });
  return [everywhere(), powershellTerminal()];
});

export default workspace({ inputs, hosts: [desktop, wslWork] });
```

- `windows.wsl()` installs `Microsoft.WSL` and enables the WSL and Virtual
  Machine Platform features. Pass `{ config: { wsl2: { memory: "16GB" } } }` to
  also manage `.wslconfig`.
- `setup.host` takes the host value and `setup.user` the account, so renaming
  either can't leave a stale string behind.
- `repository: "self"` reads the Git checkout that holds `winix.config.ts`: its
  tracked remote (SSH remotes become HTTPS), the upstream branch and the config
  directory. The example spells these out (`repository`, `ref`,
  `configDirectory`) because it is not its own repository.

## 3. Check, preview, switch

On the Windows machine:

```powershell
winix check                   # validates the whole setup plan offline
winix plan --host DESKTOP     # what switch would change, checked against the machine
winix switch --host DESKTOP   # applies what changed; one UAC prompt for Windows features
```

`check` fails before any distro exists if `setup.host` isn't a NixOS-WSL host,
the account isn't a normal user on it, or the checkout would land outside its
home. Errors name the Windows host and the distro.

On the first switch Winix:

1. enables the Windows features (if Windows asks for a restart, restart yourself
   and run `winix switch` again; Winix never restarts Windows);
2. downloads the NixOS-WSL image pinned in `winix-windows.lock`, verifies its
   SHA-256 and imports it at `installLocation`;
3. clones your repository at the commit pinned in `winix-windows.lock` into
   `alice`'s home and activates `wsl-work` inside the distro (the account first,
   then the full host).

Push your branch before the first switch: the commit is resolved on the remote.
Setup runs once. If it fails, rerun `winix switch`; it resumes from the failed
stage and never resets a dirty checkout.

## 4. Day to day

Windows changes apply with `winix switch` on Windows. Linux changes apply inside
the distro; after a Windows switch Winix prints the exact command, for example:

```text
WSL: Linux hosts are activated separately from Windows.
  NixOS → wsl-work: apply Linux changes inside the distro with
    wsl.exe -d NixOS --cd /home/alice/dotfiles/winix -- npm exec -- winix switch --host wsl-work
```

## Reach Windows from WSL

Avoid hard-coding the Windows user name or drive in Linux config. From
[`features/windows-interop.ts`](../../examples/cross-platform/features/windows-interop.ts):

```ts
export const windowsInterop = feature("windows-interop", ({ home }) => {
  // `code` inside WSL runs the Windows VS Code CLI.
  home.packages(nix.wsl.windowsBin("code", "%LOCALAPPDATA%\\Programs\\Microsoft VS Code\\bin\\code"));
  // git inside WSL uses Git for Windows' Credential Manager.
  home.wsl.gitCredentialManager();
});
```

`nix.wsl.windowsBin(name, paths)` builds a `bin/<name>` shim that runs the
first Windows path that exists, expanding `%VARIABLES%` through `cmd.exe` each
time it runs (about 50 ms). It exits 127, listing the paths it tried, when none
exist. Pass several paths for tools that install in different places.

## An existing distro

Already have a NixOS distro? The same `windows.wsl.distro()` declaration adopts
it instead of creating one, if it is WSL 2, runs NixOS and reports the expected
hostname (`host`, or `setup.host`). Adoption records the registration and never
runs setup: apply Linux changes from the distro yourself. Winix never replaces,
moves or unregisters an existing distro.

## Gotchas

- **Changing `setup` after a distro is set up** is refused for that distro
  (the completed setup is fingerprinted). Switching branches with
  `repository: "self"` is fine: an inferred `ref` is left out of the fingerprint.
  When migrating a machine that was set up with an explicit `ref` and
  `checkout`, keep them explicit.
- **Credentials are not provisioned.** Setup clones before your Linux config
  is active, so `home.wsl.gitCredentialManager()` cannot help that first clone.
  A private repository needs authentication that already works inside the
  distro; only HTTPS URLs without embedded credentials are accepted.
- **Restart WSL yourself** after `.wslconfig` or default-user changes
  (`wsl --shutdown` when convenient). Winix never shuts WSL down.

Full reference: [Provision WSL from a Windows host](../../README.md#provision-wsl-from-a-windows-host).
