---
title: WSL from a Windows host
description: Create or adopt a NixOS-WSL distro from a Windows host and set it up from the same repository.
---

# WSL from a Windows host

## Provision WSL from a Windows host

```ts
host("DESKTOP", platforms.windows(), ({ windows }) => {
  const setup = windows.wsl({
    config: {
      wsl2: { memory: "16GB", processors: 8 },
      experimental: { autoMemoryReclaim: "gradual" },
    },
  });
  windows.wsl.distro("NixOS", {
    source: "nixos-wsl",
    installLocation: "D:/WSL/NixOS",
    default: true,
    dependsOn: setup,
  });
});
```

`windows.wsl({ config?, backup?, force?, dependsOn? })` declares the `Microsoft.WSL`
package, enables the WSL and Virtual Machine Platform Windows features, and
optionally manages `.wslconfig`. The runtime uses normal package locking and is
installed in switch's elevated step (every WSL installer needs administrator
rights); a separate
`windows.package({ id: "Microsoft.WSL", ... })` can customize its package options.
Calling `windows.wsl()` without config leaves that file untouched.
`windows.optionalFeature(name,
{ enabled?, dependsOn? })` also supports individual optional features.
Feature changes require administrator approval. If a restart is required,
dependent provisioning stops: restart Windows yourself and rerun `winix switch`.
Winix never automatically restarts Windows or shuts down WSL.

Declare `windows.wsl()` in the same Windows host as its distros.
The distro automatically depends on the features, optional configuration file,
and runtime package; explicit `dependsOn` also supports other handles. The setup
handle covers the runtime package, features, and configuration when provided. Registration runs
as the current Windows user, not SYSTEM;
use the intended account rather than another administrator's credentials.
`installLocation` accepts an absolute local-drive path, an environment-variable
path, or a known-folder target. It must not already exist. Names and locations
must be unique per host; at most one distro may be declared default.

The `config` option owns the current user's complete `.wslconfig`, using the
normal file backup/force protections. Changes print a reminder to restart WSL
manually when safe. They do not immediately alter running distros.

First apply pins official stable NixOS-WSL image URLs and SHA256 digests for x64
and ARM64 in the optional `wslImages` section of `winix-windows.lock`. Subsequent
applies reuse these pins. `winix update --windows nixos-wsl` refreshes them;
updating all Windows entries includes images too. Downloads are verified before
import. Image updates affect **new registrations only**, never existing Linux
filesystems. Dry generation can resolve missing pins but neither writes the lock
nor downloads images.

Winix creates the declared distro only when its registration is absent. It never
replaces, moves, converts, or unregisters a conflicting existing distro.
Successful imports create
`.winix-wsl.json` in the installation directory to identify that registration.
If import is interrupted before recording completes, inspect the existing
registration and disk manually; Winix will not unregister it as rollback.
Removing declarations leaves distro data and enabled optional features intact.
Only explicit `enabled: false` disables a feature. The separately declared
WSL package follows normal package ownership/removal rules.

The Windows registration name (`NixOS`) and Linux Winix host name (`wsl-work`,
for example) are independent. The **same declaration** can create a distro on a
new machine or adopt a matching existing one:

```ts
windows.wsl();
windows.wsl.distro("NixOS", {
  source: "nixos-wsl",
  host: "wsl-work",
  installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
});
```

During Windows activation, an untracked registration must be WSL 2, run NixOS,
and report the expected Linux hostname. `host` supplies that hostname and defaults
to `setup.host` when omitted. Winix normally sets Linux's hostname to its host ID;
if yours is overridden, set `host` to the actual expected hostname. Without
either hostname declaration, existing untracked distros are refused.

Matching distros are automatically recorded under the current Windows user's
Local AppData `Winix\wsl-registrations\registration-<name>.json`. Records bind the
registration GUID, actual location, and adopted hostname. An adopted distro keeps
its actual location; `installLocation` is only the creation destination. Later
runs revalidate identity and refuse changed/missing registrations, hostname
changes, or invalid tracking records. Inspect these records before manual
recovery; never remove one while activation is running. Existing Winix import
markers remain supported and retain their provisioning behavior.

Adoption checks no Git origin, user, checkout, or config files and executes no
repository code. It may start a stopped distro but never writes Linux setup
state, clones repositories, installs dependencies, changes defaults, or activates
Linux. `setup` and `default` are not applied to adopted distros, even on later
runs. Activate Linux manually. `winix check` and dry generation perform static
checks only; creation pins may still be resolved, but no distro is inspected or
adopted. Removing the declaration leaves the distro, its data, and tracking alone.
Automatic adoption is not available in preview.3.

For a **new distro**, automate its first-run link by opting into `setup`:

```ts
windows.wsl.distro("NixOS", {
  source: "nixos-wsl",
  installLocation: windows.knownFolder.localAppData("Winix\\WSL\\NixOS"),
  default: true,
  setup: {
    repository: "https://github.com/example/dotfiles.git",
    ref: "main",
    configDirectory: "winix",
    host: "wsl-work",
    user: "alice",
    checkout: "/home/alice/dotfiles",
  },
});
```

This explicitly trusts the repository and its Winix configuration (including
npm lifecycle scripts when using the npm SDK). Commit `flake.lock` in
`configDirectory`; the npm path additionally requires `package.json`,
`package-lock.json`, and a released Winix dependency supporting this API.
Only HTTPS Git URLs without embedded credentials are accepted. Private repository
and dependency authentication must already be available inside Linux; credentials
are never provisioned by this helper.

The Linux host must explicitly enable NixOS-WSL, import its input module, declare
`system.stateVersion`, and match the distro architecture; `platforms.wsl({
stateVersion })` does all of that. `user` selects an
already-declared normal account, not a second account definition. Omit it when
Home Manager or the sole normal account identifies the user unambiguously.
`winix check` (and every apply) validates the whole setup plan offline, before
any distro exists: `setup.host` names one NixOS host, the NixOS-WSL module and
`system.stateVersion` are declared, the account is a normal user on that host and
the checkout stays inside its home. Errors name the Windows host and distro.
Home Manager's username/home must agree with the selected account. `checkout`
defaults to `<declared-home>/dotfiles` and must stay inside that home.

First apply locks the repository ref (default `HEAD`) to a commit in
`wslRepositories`. `winix update --windows wsl-setup` refreshes these pins;
an update without names includes them too. Dry generation never clones or executes
repository code. Pins affect **first-run setup only**, not subsequent dotfiles
updates; an interrupted setup retains its original commit.

During activation, Git/config preparation (and npm on the npm path) runs as the image's initial `nixos`
user. A root coordinator first activates only the selected declarative account
and required WSL/shell settings, moves checkout ownership to it, then generates
the full host as that user and activates it as root. No password is invented and
sudo policy is not changed. External secret files required by the account must
already exist. The full host must set `wsl.defaultUser` to the selected user.

Setup records resumable stages under `/var/lib/winix/wsl-setup`; rerun Windows
`winix switch` after a reported failure. Dirty, occupied, or changed checkouts and
changed setup settings are refused, never reset or adopted. A killed coordinator
can leave `run.lock`: inspect its recorded PID/state and confirm no setup is
running before manually removing that lock. Other conflicts require explicit
manual recovery or a new distro. Successful setup is not repeated; later Linux
updates remain ordinary Linux Winix operations. No shutdown/reboot is performed;
restart WSL manually when safe if its new default-user setting needs it.
Fresh-image end-to-end activation remains unverified.

Without `setup`, repository installation and Linux activation remain manual.

### Pair a Windows host with its WSL host

Walkthrough: [Pair a Windows host with its WSL host](../guides/pair-windows-and-wsl.md).
Pass values instead of repeating names: `setup.host` (and a distro's adoption
`host`) accept the value returned by `host(...)`, and `setup.user` the
`account.user(...)` factory; names still work.

`repository: "self"` reads the Git checkout holding `winix.config.ts` (local
Git only): the current branch's tracked remote (else `origin`; SSH remotes such
as `git@github.com:me/dotfiles.git` become HTTPS), its upstream branch as `ref`
(the commit when detached) and the config's path as `configDirectory`. The
commit is still pinned in `wslRepositories`; push the branch first, since the pin
is resolved on the remote. An inferred `ref` is left out of the completed-setup
fingerprint. Setup runs once: when a setup declaration changes after a distro
was set up (another `ref`, a different `checkout`...), the completed distro is
left as it is and the switch prints a note instead of failing; the account,
checkout and WSL default user are still verified. Later changes are applied
from inside the distro (`winix switch` there). After `winix switch` on Windows,
Winix prints the command that applies later Linux changes inside each distro.

### Reach Windows from WSL

`nix.wsl.windowsBin(name, paths)` builds a package whose `bin/<name>` runs the
first existing Windows path from a list. Paths are absolute (`C:\...`) or start
with an environment variable (`%LOCALAPPDATA%\...`); variables are expanded with
`cmd.exe` and converted with `wslpath`, which costs about 50ms per run. The shim
exits 127 with the paths it tried when none exist.
`home.wsl.gitCredentialManager({ paths? })` enables `programs.git` and points
`credential.helper` at such a shim for Git for Windows' ucrt64/mingw64 GCM.
Example: [Reach Windows from WSL](../guides/pair-windows-and-wsl.md#reach-windows-from-wsl).
