# Cross-platform example

One checkout for three machines:

- `DESKTOP`: Windows. Creates the `NixOS` WSL distro and sets it up as `wsl-work`.
- `wsl-work`: NixOS on WSL, with shims that reach Windows programs.
- `macbook`: nix-darwin.

The [guides](../../docs/guides) quote this example, and
`tests/cross-platform-example.test.ts` evaluates and generates it, so the guide
code keeps working.

| File | Shows | Guide |
|---|---|---|
| `features/lazygit.ts` | One feature, every platform | [Cross-platform feature](../../docs/guides/cross-platform-feature.md) |
| `features/git.ts` | One settings object for Home Manager and Git for Windows | [Share git config](../../docs/guides/share-git-config.md) |
| `features/powershell-terminal.ts` | PowerShell profile, prompt, Terminal settings | [PowerShell and Terminal](../../docs/guides/powershell-and-terminal.md) |
| `features/starship.ts` | The prompt on every platform | [PowerShell and Terminal](../../docs/guides/powershell-and-terminal.md#prompt-on-every-platform) |
| `features/windows-interop.ts` | Windows programs from WSL | [Pair Windows and WSL](../../docs/guides/pair-windows-and-wsl.md#reach-windows-from-wsl) |
| `winix.config.ts` | Hosts paired by value | [Pair Windows and WSL](../../docs/guides/pair-windows-and-wsl.md) |

```bash
npx winix check
npx winix inspect --host macbook
npx winix apply --dry --locked --host DESKTOP
```

`winix-windows.lock` holds made-up pins so generation works offline; the WSL
setup repository (`https://github.com/example/dotfiles.git`) does not exist. In
your own checkout, use `repository: "self"` and let `winix apply` pin real versions.
