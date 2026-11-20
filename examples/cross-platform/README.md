# Cross-platform example

One checkout for a Windows PC, the NixOS-WSL distro it creates, and a Mac,
organised the way a real dotfiles repository grows:

```
winix.config.ts          inputs + machines
machines/                one file per computer
  desktop.ts             DESKTOP (Windows) + wsl-work (its WSL distro): one machine, two hosts
  macbook.ts             macbook (nix-darwin)
roles/                   what a kind of machine gets; roles span operating systems
  everywhere.ts          shell, starship, git, lazygit
  dev.ts                 node
  windows-desktop.ts     Windows Terminal
features/                one file per tool, with every OS it supports
  cli/                   shell (one alias table for zsh and PowerShell), starship, git, lazygit
  dev/                   node
  desktop/               windows-terminal
  system/                alice (the account), nixos-wsl (the distro), windows-interop
dotfiles/                config files the features link
```

A machine lists its roles; a role lists features; a feature declares its tool
for every platform (`home.*` for Linux, WSL and macOS, `windows.*` for
Windows) and each host gets the parts for its own platform. To add a tool, give
it one feature file and put it in a role; something only one machine needs goes
in that machine's file.

```bash
npx winix check
npx winix inspect --matrix          # every feature against every host
npx winix inspect --host macbook    # what each feature contributes there
npx winix apply --dry --locked --host DESKTOP
```

The [guides](../../docs/guides) quote this example, and
`tests/cross-platform-example.test.ts` evaluates and generates it, so the guide
code keeps working.

| File | Shows | Guide |
|---|---|---|
| `features/cli/lazygit.ts` | One feature, every platform | [Cross-platform feature](../../docs/guides/cross-platform-feature.md) |
| `features/cli/git.ts` | One settings object for Home Manager and Git for Windows | [Share git config](../../docs/guides/share-git-config.md) |
| `features/cli/shell.ts`, `features/desktop/windows-terminal.ts` | PowerShell profile with shared aliases, Terminal settings | [PowerShell and Terminal](../../docs/guides/powershell-and-terminal.md) |
| `features/cli/starship.ts` | The prompt on every platform | [PowerShell and Terminal](../../docs/guides/powershell-and-terminal.md#prompt-on-every-platform) |
| `machines/desktop.ts`, `features/system/nixos-wsl.ts` | A Windows host and its WSL host, paired by value | [Pair Windows and WSL](../../docs/guides/pair-windows-and-wsl.md) |
| `features/system/windows-interop.ts` | Windows programs from WSL | [Pair Windows and WSL](../../docs/guides/pair-windows-and-wsl.md#reach-windows-from-wsl) |

`winix-windows.lock` holds made-up pins so generation works offline; the WSL
setup repository (`https://github.com/example/dotfiles.git`) does not exist. In
your own checkout, use `repository: "self"` and let `winix apply` pin real versions.
