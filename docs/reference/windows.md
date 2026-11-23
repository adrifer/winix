---
title: Windows hosts
description: Packages, files, settings, startup apps, fonts, PowerShell and npm feeds, plan and switch, removal ownership.
---

# Windows hosts

## Overview

Declare a `platforms.windows()` host and install winget/msstore packages with
`windows.package(...)`; use
`windows.raw(...)` for arbitrary commands. Both return a handle you can pass to
another resource's `dependsOn` to express ordering.

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  const node = windows.package("OpenJS.NodeJS");
  windows.package({ source: "msstore", id: "9NKSQGP7F2NH" });
  windows.raw({
    executable: "npm",
    arguments: ["install", "--global", "typescript"],
    dependsOn: node,
  });
});
```

`winix switch` checks each resource against the machine and applies only what
is out of date (see [Previewing and applying Windows changes](#previewing-and-applying-windows-changes)). Typed helpers
also cover environment variables, PATH, files, Windows settings, and PowerShell
modules:

```ts
host("desktop", platforms.windows(), ({ windows }) => {
  windows.setting({ DeveloperMode: true });
  const icons = windows.powershell.module("Terminal-Icons");

  windows.file.symlink(
    windows.knownFolder.documents("PowerShell\\Microsoft.PowerShell_profile.ps1"),
    "../windows/powershell/Microsoft.PowerShell_profile.ps1",
    { dependsOn: icons },
  );
});
```

`windows.knownFolder.documents(childPath?)` resolves redirected Documents **during activation**,
not on the machine generating the configuration. Supported folders are
`documents`, `desktop`, `localAppData`, `appData`, `userProfile`,
`programFiles`, and `programFilesX86`. The optional
child path must stay within the folder. All `windows.file.*` targets accept it.
Copy/symlink source strings are relative to the directory containing
`winix.config.ts`, not the calling feature or working directory. Absolute paths,
`%VARIABLE%` paths, and `file:` URL objects remain supported. Symlinks stay live
and require the checkout to remain in place. Direct `generateWindows(hosts, lock, configDir)` callers must
supply `configDir` when using relative sources.

**Existing files are backed up by default.** When a file, `.wslconfig` or
Startup shortcut target already exists and differs, Winix moves it to
`<target>.bak` and puts its own in place. It fails if that `.bak` already
exists, so nothing is overwritten. Targets that already match are left alone, so
this only happens the first time Winix takes a file over (or after something
else replaced it). Per resource:

- `backup: false` refuses to replace an existing target and fails the switch instead.
- `force: true` deletes the existing target without a backup (populated
  directories are still refused). `force` with `backup: true` backs up.

Before this default, replacement needed an explicit `backup: true` or
`force: true`; configs that set `backup: true` everywhere can drop it.

Guides: [PowerShell profile and Windows Terminal](../guides/powershell-and-terminal.md),
[Share git config across Windows and WSL](../guides/share-git-config.md).

### Writing Windows config

Shortcuts for things most Windows hosts repeat:

```ts
// Windows-only workspaces need no Nix inputs.
export default workspace({ hosts: [
  host("desktop", platforms.windows(), ({ windows }) => {
    // Apps that update themselves: install when missing, never pin or downgrade.
    windows.package("Valve.Steam", { version: "any" });

    // Named targets instead of typed-out paths.
    windows.powershell.profile("../windows/powershell/Microsoft.PowerShell_profile.ps1");
    windows.terminal.settings("../windows/terminal/settings.json", { channel: "preview" });
    windows.env.set("REPOS", windows.configPath("../.."));

    // A file handle used as a path supplies the path *and* the dependency.
    const komorebi = windows.package("LGUG2Z.komorebi");
    const config = windows.file.symlink(windows.knownFolder.userProfile("komorebi.json"), "../windows/komorebi.json");
    windows.startup.app("komorebi", {
      executable: windows.knownFolder.programFiles("komorebi/bin/komorebic-no-console.exe"),
      arguments: ["start", "--config", config],
      dependsOn: komorebi,
    });

    // Light/dark mode lives next to the rest of the appearance settings.
    windows.personalization({ colorMode: "Dark", accentColor: "#336699" });
  }),
] });
```

- `version: "any"` is for apps that update themselves (browsers, launchers,
  Teams) or that winget can't report a usable version for. See
  [Package versions](#package-versions) below.
- `windows.powershell.profile(source, { shell?, mode?, backup?, force? })` targets
  `Documents\PowerShell\Microsoft.PowerShell_profile.ps1` (`shell:
  "windowspowershell"` for 5.1), following OneDrive-redirected Documents.
  `windows.terminal.settings(source, { channel?: "stable" | "preview" })` targets the
  packaged Terminal's `LocalState\settings.json`. Both symlink by default; use
  `mode: "copy"` to copy instead.
- `windows.configPath(path?)` returns an absolute path relative to
  `winix.config.ts` at evaluation, for string values. File sources are already
  config-relative.
- In `windows.startup.app`/`shortcut`, a `windows.file.*` handle can stand in for the
  executable, an argument, or the working directory. Winix uses its target and
  adds the dependency.
- `winix windows search <query>` finds winget ids. `winix windows import
  [--host <name>]` compares `winget export` with the host's declarations and
  prints paste-ready `windows.package(...)` lines for installed, undeclared apps.
  Shared runtimes such as VC++ redistributables are listed on one line, and
  declared packages that aren't installed are listed too. It is read-only.
- `winix check` warns about every pin missing from `winix-windows.lock`: floating
  packages, PowerShell modules (including the implicit `Microsoft.Windows.Settings`
  that `windows.setting` uses), NixOS-WSL images, WSL setup commits and fonts.
  Apply would resolve them online, and a typo would only fail there.

### Package versions

A package's `version` picks one of three policies:

```ts
windows.package({ id: "Git.Git", version: "2.44.0" }); // exact
windows.package("Git.Git");                             // locked (default)
windows.package("Valve.Steam", { version: "any" });     // any version
```

**Declaring and activating**

| | Exact: `version: "2.44.0"` | Locked (default) | Any: `version: "any"` |
|---|---|---|---|
| Use for | Tools that must be one specific version | Most tools | Apps that update themselves, or report no usable version (e.g. `Unknown`) |
| `winix-windows.lock` | Records the inline pin | First apply pins the latest winget version; `winix update --windows` refreshes it | No entry |
| Not installed | Installs that version | Installs the locked version | Installs whatever winget currently offers |
| Installed version is older | Switch fails ("Exact version mismatch") | Upgraded to the locked version | Left alone |
| Installed version is newer | Switch fails; never downgraded | Kept ("Keeping X (locked Y)"); switch offers to update the lock (`switch --update-versions` updates it without asking) | Left alone; no prompt |
| winget reports `Unknown` | Switch fails | Kept (warning each switch); never reinstalled | Left alone; no warning |
| Older, installed by another installer winget can't upgrade | Switch fails ("Exact version mismatch") | Kept; the plan says how to hand it to winget | Left alone |
| Changed outside Winix (Winix-installed) | Switch fails | Newer accepted; older fails | Any change accepted |
| `check` warns when not in the lock | No | Yes (apply would resolve it online) | No |

**Removing the declaration**

| | Exact | Locked (default) | Any |
|---|---|---|---|
| Installed by Winix, version unchanged | Uninstalled, after confirmation | Uninstalled, after confirmation | Uninstalled, after confirmation |
| Installed by Winix, version changed since | Refused ("externally modified") | Refused ("externally modified") | Uninstalled, after confirmation |
| Installed by Winix, winget reports `Unknown` | Refused; remove it by hand | Refused; remove it by hand | Refused; remove it by hand |
| Installed before Winix managed it | Never uninstalled | Never uninstalled | Never uninstalled |

Uninstalls also need two things: no other host or workspace on the machine
still declares the package, and `switch --dry` lists it first as a planned
removal. `--yes` skips the confirmation. To keep a Winix-installed package but
stop managing it, run `winix state forget package winget <id>` before removing
the declaration. Hosts that share a package must use the same policy for it.
`"latest"` and `"*"` are rejected; there is no always-upgrade mode yet.

Symlinks automatically depend on typed `windows.setting({ DeveloperMode: true })`
resources declared anywhere in the same host. Developer Mode remains an explicit
machine-policy choice: Winix does not enable it merely because a symlink exists.
Without that declaration, symlinks still require existing Developer Mode or elevation.

When generating in WSL, Winix uses `wslpath` to translate filesystem sources to
Windows drive/UNC paths. Sources inside the Linux filesystem use a WSL UNC path,
so that distribution must remain available during activation. Generation on
other Linux/macOS systems does not translate local paths; use Windows-reachable
absolute or environment-variable sources when generating there.

PowerShell module versions and repositories are pinned in the optional `modules`
section of the existing `winix-windows.lock` (source-qualified lowercase keys;
legacy name-only pins remain readable).
Old package-only locks remain valid. First apply resolves missing entries;
subsequent applies reuse pins without querying the repository.
`winix update --windows` refreshes packages and modules, or pass names to update
only selected entries; `--dry` resolves without writing. On native Windows, plain
`winix update` does the same (the Nix flake lock is updated from WSL, Linux or
macOS). Resolution errors never
replace existing pins. Network access is still needed for installation.

`windows.powershell.module(name, { repository?, prerelease?, dependsOn? })` defaults to
the host repository policy, otherwise PSGallery, selects stable releases, and installs the exact locked version for
the current user. Registered feeds are queried with PowerShell 7 and PSResourceGet.
Installation is idempotent and runs directly in DSC's
`Microsoft.DSC.Transitional/PowerShellScript` resource; a declared `Microsoft.PowerShell` package is an
automatic dependency. Other versions are not removed. Profiles still import
modules themselves; an unversioned `Import-Module` can load a newer installed
version, so installation locking alone does not enforce session imports.
Set `prerelease: true` to allow a prerelease pin; its full version, including
the prerelease label, is locked and checked. A shared module with any stable-only
declaration remains stable-only.

`windows.setting(...)` implicitly declares `Microsoft.Windows.Settings` through
this same mechanism, with prereleases allowed and the host's repository policy
enforced. First apply adds its exact source-qualified module pin; no version
belongs in handwritten configuration. A different installed version does not
satisfy that pin. Native Settings activation and adapted-resource discovery with
multiple side-by-side module versions remain unverified; installing the pin
does not claim to force DSC's module selection.

Work profiles can enforce an approved feed without changing shared features:

```ts
const workRepositories = feature("work-repositories", ({ windows }) => {
  windows.powershell.repositories({
    repositories: {
      approved: { uri: "https://packages.example.com/powershell/v3/index.json" },
    },
    default: "approved",
    allowed: ["approved"],
  });
});
const work = profile("work", [workRepositories(), windowsShell()]);
```

The policy is resolved after host fragments merge. Omitted module repositories
and the automatic `Microsoft.Windows.Settings` installer use its default.
Explicit repositories outside `allowed` fail before resolution; there is no
fallback. Omit `allowed` to permit explicit overrides. It governs Winix-managed
PowerShell installers, not raw commands, generic DSC, npm, NuGet, or WSL.
Personal hosts without this feature retain PSGallery.
Conflicting policies in one host fail instead of silently widening its allowlist.

Named feeds use HTTPS URLs without embedded credentials. Lock resolution reuses an
existing registration only when its name and URI match. Otherwise, it queries the
declared NuGet v3 feed's `PackageBaseAddress` anonymously, without following
redirects. Feeds that require authentication or do not expose this v3 endpoint
need a matching registration configured separately through PSResourceGet.
PSGallery uses its public v2 endpoint if no matching registration exists.
Lock resolution never creates or modifies registrations, including during `--dry`.
Activation ensures registration before module installation and rejects a same-name
registration with a different URI. Global priorities and permanent trust are
unchanged. Do not put secrets in config or locks.
Pins distinguish module name, repository name, and configured URI across hosts;
a new source resolves its own pin. Existing matching installed versions are reused,
not reinstalled to attest their original source. Settings retains its existing
prerelease ensure behavior rather than adding a stable module lock.

## Windows sign-in startup

```ts
windows.startup.app("my-app", {
  executable: "%ProgramFiles%/MyApp/app.exe",
  arguments: ["--config", windows.knownFolder.appData("MyApp/config.json")],
  workingDirectory: windows.knownFolder.userProfile(),
  windowStyle: "minimized",   // normal (default), minimized, maximized, hidden
  delay: 5,                   // seconds after sign-in; optional
  dependsOn: appPackage,
});

// Explicitly a shortcut in the Startup folder:
windows.startup.shortcut("my-tool", { executable: "my-tool.exe" });

// Explorer's own pacing for Run entries and Startup-folder shortcuts:
windows.startup.explorer({ delay: false, waitForIdle: false });
```

`windows.startup.app(name, spec)` starts a program when you sign in, through a
per-user "At log on" task in Task Scheduler's `\Winix\` folder. Logon tasks
start right after sign-in; the Startup folder is opened last, after every Run
entry and Store-app startup task, one at a time, which can take minutes. The task
runs as you (not elevated), with no time limit, at normal priority, on battery,
and never as a second instance. Registering it needs no administrator rights.
`hidden` runs a console program with no window at all (through a headless
console host); `minimized` and `maximized` start it through a small headless
PowerShell launcher, since a task has no window-style setting. Logon tasks are
listed in Task Scheduler, not in Settings → Apps → Startup.

`windows.startup.shortcut(name, spec)` manages `<name>.lnk` in the current
user's actual Startup known folder instead.

Both only register the entry: nothing is launched, stopped, or reloaded during
apply, and Winix records and removes what it created like packages. Programs
start at sign-in, not at machine boot; this is not a service, elevated launch,
or all-users startup API.

`windows.startup.explorer({ delay?, waitForIdle? })` sets
`HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Serialize`:
`delay: false` removes Explorer's delay before it starts Run entries and
Startup shortcuts, `waitForIdle: false` stops it waiting for an idle desktop
first; `true` restores the Windows default.

The executable may be an absolute path, an environment-variable path, a named
known-folder path, or an application name resolved on PATH during activation.
The executable and working directory must exist then; use `dependsOn` for
installation/configuration ordering. Relative filesystem paths are rejected.
The default working directory is the user profile. `arguments` is an argv array:
strings are literal (including `%VAR%`), while known-folder values resolve during
activation. Standard Windows argv quoting preserves spaces, empty arguments,
embedded quotes, backslashes, and Unicode; no shell is implicitly inserted.

For shortcuts, `windowStyle` accepts `normal` (default), `minimized`, or
`maximized`; minimized does not guarantee a hidden console. Correct shortcuts
and tasks are left untouched. A different existing shortcut is moved by default to
`%LOCALAPPDATA%\Winix\startup-backups\<timestamp>-<name>.lnk`, outside the
Startup folder (Windows opens everything in that folder at sign-in, so a
`.lnk.bak` there would ask how to open it). `backup: false` refuses the replacement instead, and
`force: true` replaces it without a backup. A new shortcut is staged and verified before
replacing the old one. Keep names unique per host.

## Windows npm registries

Configure npm's current-user default and scoped registries independently from
PowerShell repositories:

```ts
windows.npm.registries({
  registries: {
    npmjs: { uri: "https://registry.npmjs.org/" },
    work: { uri: "https://packages.example.com/npm/" },
  },
  default: "work",
  scopes: { "@my-company": "work", "@adrifer": "npmjs" },
});
```

The host's merged policy emits one idempotent DSC resource managing only
`registry` and the declared `@scope:registry` entries in the current user's
`.npmrc` (or absolute `NPM_CONFIG_USERCONFIG` when set during activation).
Existing authentication, comments and unrelated scopes/options are preserved.
Managed keys are explicitly replaced; symlinked userconfigs and concurrent
edits fail rather than overwriting their targets. Removing declarations leaves
their previous settings in place; cleanup is not tracked.

Registries require HTTPS URLs without embedded credentials, queries or
fragments. Authentication stays external (for example `npm login` or existing
environment-token references); Winix never logs or declares tokens. npm itself
need not be installed to generate or apply this file resource.

Unlike PowerShell module policy, this does not enforce an `allowed` list:
project `.npmrc`, environment variables and npm command-line options can
override user settings, and package locks may contain independent download
URLs. It does not redirect Winix bootstrap/SDK downloads, WSL setup npm, or
install packages. `check`/`apply --dry` do not modify the userconfig.

## Windows personalization and fonts

These helpers manage the current Windows user without requiring elevation:

```ts
windows.wallpaper({ source: "../wallpapers/desktop.jpg", style: "Fill" });
windows.personalization({
  accentColor: "#336699",
  explorer: { showExtensions: true, showHiddenFiles: false, openTo: "ThisPC" },
  taskbar: { autoHide: false, search: "Hidden", taskView: true, widgets: false },
});
windows.fonts({
  sources: [
    "../fonts/MyFont-Regular.ttf",
    { url: "https://example.com/releases/v1/fonts.zip", files: ["**/*.ttf"] },
    { provider: "nerd-fonts", family: "JetBrainsMono" },
  ],
});
```

Wallpaper accepts a local path or `windows.knownFolder.*` path. Relative image
and font paths resolve from `winix.config.ts`, including Windows and WSL path
conversion. Wallpaper images are cached by content hash, so editing the source
image is detected. Styles are `Fill` (default), `Fit`, `Stretch`, `Tile`, `Center`,
and `Span`; this is one desktop background, not per-monitor image assignment.

Personalization only changes declared values. `accentColor` is `#RRGGBB` and
disables automatic accent coloring. Explorer `openTo` accepts `ThisPC` or `Home`;
hidden files does not expose protected operating-system files. Taskbar `search`
accepts `Hidden`, `Icon`, `IconAndLabel`, or `Box`. Explorer/taskbar/accent values
depend on Windows version and policy and may require signing out; Winix never
restarts Explorer. Existing `windows.setting()` theme settings remain available.
Avoid declaring conflicting automatic accent coloring in both helpers.

Fonts support local `.ttf`/`.otf` files, HTTPS `.ttf`/`.otf` downloads, and ZIP
archives. ZIP `files` accepts exact member paths or `**/*.ttf` / `**/*.otf`;
omitting it selects all font files. Unsafe archives, missing selections and
conflicting filenames fail explicitly. Downloads and expanded archives have
size limits. Remote sources must not contain credentials. An optional `sha256`
provides an independently trusted checksum; otherwise the first resolution
records the upstream digest or the downloaded bytes (trust on first use).

Remote fonts have a separate `fonts` section in `winix-windows.lock`. First
apply resolves missing entries; subsequent apply reuses them without a catalog
query. `winix update --windows fonts` refreshes only font pins; `--dry` never
writes pins or installs fonts. Installation verifies checksums and caches
downloads in Local AppData. Nerd Fonts IDs come from official release ZIP
assets, not a handwritten registry:

```sh
winix windows fonts JetBrains
winix update --windows fonts --dry
```

Nerd Fonts is the only built-in provider. Its optional `version: "vX.Y.Z"` selects
an exact upstream release; otherwise latest resolves once and stays locked.
Provider IDs, archive filenames and installed family names differ. Installation
reports family names from font metadata; configure Terminal/editors separately
to select them. Fonts are installed and registered for the current user,
identical files are reused, and differing existing files/registry entries are
not overwritten. Updating a ZIP pin may therefore require explicitly resolving
an existing font collision. Font removal/cleanup is not tracked; deleting a
declaration leaves installed fonts and caches intact.

These helpers emit idempotent DSC PowerShell resources. Native desktop/font
activation has not been rehearsed on a shared machine; automated checks cover
authoring, locking, generated scripts and isolated archive handling.

## Previewing and applying Windows changes

`winix plan --host <name>` (the same as `winix switch --dry`) shows what a switch
would change, checked against the current machine. It never installs or writes
anything:

```text
Plan for desktop: 5 changes, 1 removal, 47 unchanged
  + install  DEVCOM.JetBrainsMonoNerdFont                  3.3.0                [admin]
  ~ upgrade  Git.Git                                       2.55.0.3 → 2.56.0.4  [admin]
  ~ upgrade  JesseDuffield.lazygit                         0.64.0 → 0.66.1      [running]
  ~ apply    link localAppData\nvim -> ../nvim/.config/nvim
  ~ apply    Enable Windows features Microsoft-Windows-Subsystem-Linux, VirtualMachinePlatform  [admin]
  - remove   Old.App (winget package)                      no longer declared; uninstalls it
  = 47 unchanged (30 packages, 12 files, 2 settings, ...)
  i 3 packages newer than locked (kept; switch offers to update the lock): Microsoft.PowerShell, ...

  ! Switch asks once for administrator approval (UAC) for the 3 [admin] rows (Git.Git: installed machine-wide; DEVCOM.JetBrainsMonoNerdFont: no per-user installer).
  ! Close lazygit.exe (pid 12156) before switching: winget cannot upgrade a running portable app (JesseDuffield.lazygit), and a failed upgrade can remove its command.
  ! Uninstalling a package can remove its application data.
  ! Enable Windows features ... can require a Windows restart; Winix never restarts Windows.

winix switch would apply only these 5 changes, and remove the item marked "- remove" (after asking).
```

`winix switch` makes the same plan and then applies **only what is out of
date**, in dependency order:

- packages with `winget install` / `winget upgrade` (exact id, source and version);
- PowerShell script resources (files, links, Startup shortcuts, PATH, modules,
  WSL...) in one PowerShell 7 runner: check, apply, check again;
- other DSC resources (registry environment variables, Windows settings,
  `windows.dsc(...)`) with `dsc config set`, one resource at a time;
- raw `windows.raw` commands, on every switch.

Everything that needs administrator rights (machine-wide installs, packages
without a per-user installer, Windows features, machine environment variables,
Windows settings, `elevate: true`) runs in **one elevated step**: one UAC prompt
per switch, none when nothing machine-wide changes. Run `winix switch` as your
normal user; per-user packages and some DSC resources fail when the whole
switch runs elevated. A failed step only skips what depends on it; switch
reports every failure, exits non-zero, and the next switch retries. When
nothing is out of date, a switch takes about as long as the plan (seconds, not
minutes): the machine is inventoried once, and again after applying only if
something changed.

In a terminal, each phase shows a spinner with its elapsed time, then one line
when it finishes; while applying, the spinner names the step in progress (or
says it is waiting for the UAC prompt):

```text
✓ Read 30 installed packages (2.0s)
✓ Generated .winix/out/desktop/resources.json
✓ Checked 22 resources on this machine (9.0s)

Plan for desktop: 1 change, 51 unchanged
  + install  Proton.ProtonPass  1.43.0
  = 51 unchanged (29 packages, 12 files, ...)

Applying 1 change:
  ✓ install Proton.ProtonPass 1.43.0 (45s)
Applied 1, already in place 0, failed 0, skipped 0.
✓ Verified 32 managed resources (2.4s)

Done in 1m 01s.
```

Generated output per Windows host is `.winix/out/<host>/resources.json`: each
resource with its name, category, dependencies, elevation, and how to check
and apply it.

- `+` install, `~` change, `!` conflict (for example an exact pin older than the
  installed version: switch fails rather than downgrade), `?` could not be
  checked, `=` already in the desired state. `[admin]` marks changes that run
  in the elevated step and `[running]` packages that must be closed first; in a
  terminal the plan is coloured (not when piped, in CI, or with `NO_COLOR`).
- Packages come from one `winget export` (a batched DSC read confirms any it
  does not list before switch installs them). Every other resource runs its
  own test script, each isolated so one failure (often a missing elevation)
  only marks that resource `?`. Raw `windows.raw` commands always show as
  `~ run`, because they run on every switch.
- Packages about to upgrade are checked for running processes from winget's
  portable installs (zip/exe tools such as lazygit, under `WinGet\Packages`).
  winget replaces those files in place, so an upgrade fails while one runs and
  can leave its command removed from `WinGet\Links`. The plan warns, and
  `winix switch` stops before applying anything until you close them.
- Installs and upgrades that need administrator rights are listed: upgrades
  keep the scope a package was installed with (`winget list --details` reports
  `Installed Scope: Machine`), and installs use whichever installer winget
  picks (compared with its per-user one). They join switch's elevated step; the
  UAC prompt can open behind other windows. To get per-user installers where packages offer them, set winget's
  `installBehavior.preferences` (`"scope": "user"` and, since many manifests
  declare no scope, `"installerTypes": ["portable", "zip"]`).
- Switch holds a lock next to the applied-state file and records its process.
  If a switch is interrupted (closed terminal, killed process), the next one
  removes the lock once that process is gone; the state file is only ever
  replaced atomically.
- Machine checks need native Windows with `dsc` and PowerShell 7. Elsewhere (for
  example `plan` for a Windows host from WSL) it lists what the host declares.
- It is also the drift check: anything changed outside Winix shows up as `~`.

Related commands:

- `winix apply --dry` still prints the full generated files; `apply --diff`
  prints a unified diff against the last generated `.winix/out`.
- `winix inspect --host <name>` lists each feature once, the scopes it targets
  (`windows`, `homeManager`, ...), the Windows resources it declares and their
  `dependsOn` edges, and marks features that contribute nothing on that platform.
- `winix inspect --matrix` prints one table for the whole config: a row per
  feature, grouped by the profile (role) it comes through, and a column per host:
  `●` applies there, `·` included but nothing for that platform (the other OS's
  half of a shared profile), blank when not included.
- `winix check` warns about a feature that does nothing on a host only when the
  host lists it directly; features reached through a profile are expected to
  span platforms (a role used on Windows and Linux), so they stay quiet.
- `--offline` (apply, switch, plan) never resolves `winix-windows.lock` online and
  fails, naming what is missing, when a pin is absent. `--locked` also fails when
  the lock would change at all, including inline versions it does not record yet.
  Use it in CI or on a machine that should only apply what is committed.
- `--update-versions` (switch) raises the lock to every installed version newer
  than it without the `[y/N/a]` prompt, also when nothing can answer one (a
  setup script). It can't be combined with `--locked` or `--dry`.
- `winix-windows.lock` no longer has a top-level `generatedAt` timestamp, so
  machines sharing one lock stop conflicting on it. Older lock files that still
  contain it remain valid; it disappears on the next change.
- File resources share one PowerShell module instead of repeating their helper
  functions in every script. The first resource, `Winix PowerShell helpers`,
  installs it to `%LOCALAPPDATA%\Winix\powershell\WinixFiles-<hash>.psm1`
  (content-addressed, so workspaces on different Winix versions never clash).

## Windows removal and ownership

Native Windows `winix switch` keeps a separate applied-state inventory under
`%LOCALAPPDATA%\Winix\applied-<machine-and-user-hash>.json`. This is machine-local
state, not the version lockfile and not something to commit or copy to another
machine. Canonical workspace directories and host names identify recorded
requirements across activations by the same Windows account.

- A shortcut Winix creates or explicitly replaces becomes owned after successful
  activation. Removing its declaration removes that unchanged shortcut on the
  next successful switch, without stopping the running program. An already
  matching, pre-existing shortcut is not automatically adopted.
- A package absent before and present after successful activation becomes owned.
  Already-installed packages satisfy requirements without gaining uninstall
  ownership. Removing a declaration automatically uninstalls an unused,
  previously owned package after successful activation. Preview all cleanup with
  `winix switch --dry`. Uninstallers may remove application data.
- External resources are never swept. Other recorded hosts/workspaces retain
  their requirements; incompatible shared declarations fail before activation.
  Removing a host or moving a workspace does not automatically release its old
  recorded requirements.

After moving a checkout or renaming a host, explicitly transfer the old owner's
requirements to the current config directory and new host:

```powershell
winix state owners
winix state migrate-owner <old-owner-id> --host new-host --dry
winix state migrate-owner <old-owner-id> --host new-host --yes
winix switch --host new-host --dry
```

Run migration from the new config checkout. It changes inventory
metadata only, never evaluates config or activates/deletes resources. Every
resource's snapshots and removal rights, including external/unowned status, are
preserved; other owners stay recorded. The next switch still enforces shared
requirements, drift checks and removal confirmation. Migration requires `--yes`
unless previewing with `--dry`; old owners are never discarded automatically.

When packages or startup entries Winix created are no longer declared, the plan
lists them as `- remove` rows and `switch` asks
`Remove the item(s) marked "- remove" and continue? [y/N]` before activation.
Resources that are no longer declared but that Winix did not create are listed
with `i` and left alone. Declining or closing the prompt
cancels the whole switch without activation or cleanup. Switches without removals
and `--dry` do not prompt. Use `winix switch --yes` (or `-y`) to accept removals
for automation; noninteractive switches with removals require this flag.

During native Windows `switch`, a package without an inline `version` uses its
lock as a minimum version and fresh-install target. An absent package installs
the lock; an older installed version upgrades; a newer installed version is kept
and reported. The generated activation document targets that installed version,
not the older lock. External upgrades of owned packages retain ownership and
refresh the observed snapshot after successful activation. Pre-installed packages
remain unowned even when upgraded by Winix.

An inline declaration such as `windows.package({ id: "Git.Git", version: "2.44.0" })`
is exact. Installed version mismatches stop before activation, without an
automatic downgrade. Unequal versions that are not dotted numeric values cannot
be reliably ordered and fail with instructions to resolve them explicitly.

After a successful interactive switch that kept a newer floating package,
Winix asks `Update winix-windows.lock to <version>? [y/N]`. Declining keeps the
lock and still completes the switch. When several packages are newer, the
prompt also offers `a`: yes for this package and every one after it, with no
more questions. Dry/noninteractive runs never ask or
update observed-version pins; `--yes` confirms removals, not lock updates.
Normal missing-pin resolution remains unchanged. These defaults apply to
`winix switch`, not direct generated-script/DSC activation or plain `apply`.

Some machines come with a package that another installer put there, such as
an organization's repackaged PowerShell 7 MSI. winget lists it by name, but
`winget upgrade --id` reports "No installed package found", so it can't upgrade
it. Before upgrading, the plan asks winget for each package by id. One it can't
find is kept (`= keep`, with a `!` note) instead of failing the switch and
skipping everything after it. To let Winix manage it, uninstall that copy and
switch again: Winix then installs the locked version from winget.

If an upgrade fails anyway (for example winget's "The install technology of the
newer version specified is different from the current version installed"), the
switch reports it, but what depends on that package still applies: the older
version is still installed. A failed install still skips its dependents.

Startup file hashes and installed package versions still protect removals.
If the installed version is non-numeric or reported as `Unknown` (common for
self-updating installers), switch warns and emits that floating package without
a version, so activation ensures it is installed instead of reinstalling the
locked version every run. The lock entry is kept. Exact pins still require a
match, and automatic removal refuses non-comparable installed versions.
External shortcut edits, package downgrades, and exact-pin drift block
reconciliation rather than silently deleting or overwriting managed resources.
Restore the recorded resource, or explicitly
release Winix's removal rights without deleting anything:

```powershell
winix state forget startup komorebi --dry
winix state forget startup komorebi
winix state forget package winget Example.App
```

`state forget` preserves recorded requirements but releases ownership for that
resource across this user's inventory. If still declared, it remains required;
future creation or explicit shortcut replacement can grant ownership again.
It does not fix a stale owner identity; use explicit owner migration instead.
Package removal requires an exact installed-version match and uses exact ID,
source, and version selection.

Dry Windows switches inspect and report removals without changing inventory,
system resources, or generated output. `apply`, or running generated
scripts yourself, does not record ownership or perform cleanup. A failed/interrupted activation never grants new
ownership; partial installations can remain unmanaged. Removal progress is saved
after each successful removal so failures can be retried conservatively.
Concurrent switches are refused. After a crash, inspect the inventory and
`.lock`/`.tmp` siblings before manually clearing stale files.

This coordinates recorded activations for one user/machine, not other users,
unrecorded configurations, or independent installers running concurrently.
Losing the inventory loses deletion rights; Winix does not reconstruct ownership
from installed software, existing shortcuts, generated output, or lockfiles.
Files, modules, Registry values, and PATH entries do not yet have removal tracking.

See [`examples/windows/`](../../examples/windows) for every package form, and the
[ROADMAP](../../ROADMAP.md) for what's planned.
