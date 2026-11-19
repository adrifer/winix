---
title: PowerShell profile and Windows Terminal
description: Keep your PowerShell profile, prompt and Terminal settings in the repo.
---

# PowerShell profile and Windows Terminal

Keep the files in your checkout and let Winix install the programs, link the
files where Windows expects them, and do it in the right order.

## The feature

From [`examples/cross-platform/features/powershell-terminal.ts`](../../examples/cross-platform/features/powershell-terminal.ts):

```ts
export const powershellTerminal = feature("powershell-terminal", ({ windows }) => {
  windows.package("Microsoft.PowerShell");
  const starship = windows.package("Starship.Starship");
  const terminal = windows.package("Microsoft.WindowsTerminal");
  const font = windows.package("DEVCOM.JetBrainsMonoNerdFont");
  // Installed from PSGallery and pinned in winix-windows.lock.
  const icons = windows.powershell.module("Terminal-Icons");

  const prompt = windows.file.symlink(
    windows.knownFolder.userProfile(".config\\starship.toml"),
    "./dotfiles/starship/starship.toml",
  );
  // Documents\PowerShell\Microsoft.PowerShell_profile.ps1, following OneDrive redirection.
  windows.powershell.profile("./dotfiles/powershell/Microsoft.PowerShell_profile.ps1", {
    dependsOn: [icons, starship, prompt],
  });
  // The packaged Terminal's LocalState\settings.json. Use { channel: "preview" } for Terminal Preview.
  windows.terminal.settings("./dotfiles/terminal/settings.json", {
    dependsOn: [terminal, font],
  });
});
```

And the files it links, under `examples/cross-platform/dotfiles/`:

```powershell
# powershell/Microsoft.PowerShell_profile.ps1
Import-Module Terminal-Icons
Invoke-Expression (&starship init powershell)
```

## What each helper does

- **`windows.powershell.profile(source, opts?)`** links PowerShell 7's
  current-user profile, resolving the Documents folder when the switch runs, so
  a OneDrive-redirected Documents works. `shell: "windowspowershell"` targets
  Windows PowerShell 5.1 instead.
- **`windows.terminal.settings(source, opts?)`** links the packaged Terminal's
  `settings.json` (`channel: "preview"` for Terminal Preview).
- **`windows.powershell.module(name)`** installs a module for the current user,
  pinned in `winix-windows.lock`. Modules install after the `Microsoft.PowerShell`
  package when the host declares it.
- **`windows.knownFolder.*`** (`userProfile`, `documents`, `localAppData`,
  `appData`, `desktop`, `programFiles`, `programFilesX86`) resolve on the
  machine during the switch, not where you generate the config.

Both file helpers symlink by default, so editing the file in the checkout
changes it on the machine immediately. Pass `mode: "copy"` to copy instead; a
copy that later changes on the machine is replaced by the next switch, which
moves the changed file to `.bak` (and stops if a `.bak` already exists).

## Why `dependsOn`

The profile imports `Terminal-Icons` and runs `starship`, and the Terminal
settings name the Nerd Font. With the handles in `dependsOn`, the first switch
on a new machine installs those before linking the files that use them, so the
first shell you open works. Creating symlinks needs Developer Mode
(`windows.setting({ DeveloperMode: true })`, which Winix then orders before
every symlink) or an elevated shell; `mode: "copy"` needs neither.

## On an existing machine

The first switch moves any profile or `settings.json` already there to
`<file>.bak`, then links yours. Preview it first:

```text
> winix plan --host DESKTOP
  ~ apply    link documents\PowerShell\Microsoft.PowerShell_profile.ps1 -> ./dotfiles/powershell/Microsoft.PowerShell_profile.ps1
  ~ apply    link localAppData\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json -> ./dotfiles/terminal/settings.json
```

To start from your current settings, copy them into the repo before the first
switch:

```powershell
Copy-Item $PROFILE .\dotfiles\powershell\Microsoft.PowerShell_profile.ps1
Copy-Item "$env:LOCALAPPDATA\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json" .\dotfiles\terminal\
```

## Prompt on every platform

Starship reads `~/.config/starship.toml` everywhere. To share the prompt with
Linux and macOS, move the link into a cross-platform feature
([`features/starship.ts`](../../examples/cross-platform/features/starship.ts)):

```ts
export const starship = feature("starship", ({ home, windows }) => {
  home.program("starship");
  home.configFiles({ "starship.toml": home.symlink("./dotfiles/starship/starship.toml") });
  windows.package("Starship.Starship");
  windows.file.symlink(windows.knownFolder.userProfile(".config\\starship.toml"), "./dotfiles/starship/starship.toml");
});
```

See [Write a cross-platform feature](cross-platform-feature.md).
