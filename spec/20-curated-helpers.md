# Spec 20 — Curated Authoring Helpers

## Overview

First-party helpers wrap common NixOS, Home Manager, and nix-darwin patterns into
ergonomic fragments. Users can always fall back to plain fragment objects for
anything not covered.

## Design Principles

1. **Helpers return `Fragment` or `LazyFragment`** — they compose like any other fragment.
2. **Namespace-first** — helper names should reveal their target scope.
3. **Opinionated but overridable** — sensible defaults, with explicit overrides.
4. **No hidden key conversion** — option keys are passed through as written.
5. **Typed options** — helper option interfaces are exported from `winix`.

## Helpers

### `nixos.*` and `darwin.*`

Platform-level helpers target NixOS or nix-darwin explicitly.

```ts
nixos.program("nix-ld", { libraries: nix.withPkgs(["icu", "zlib"]) })
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })
nixos.packages("ripgrep", "fd", "jq")
nixos.sysctl({ "fs.inotify.max_user_watches": 1048576 })
nixos.firewall({ allowedTCPPorts: [80, 443] })
nixos.systemd({ services: { backup: { script: nix.script`echo backup` } } })
nixos.raw("environment.variables.FOO = \"bar\";")

darwin.program("zsh")
darwin.service("some-agent")
darwin.packages("mas")
darwin.raw("system.defaults.dock.autohide = true;")
```

Program and service helpers add `enable: true` by default. Explicit `enable` in
`opts` wins.

### `account(username: string, opts?: AccountOpts): LazyFragment`

Declares Home Manager user settings and platform-specific system user settings.

```ts
account("adrifer", {
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
})
```

Options:

```ts
interface AccountOpts {
  admin?: boolean;
  shell?: string | PackageRef;
  homeDirectory?: string;
  stateVersion?: string;
  sessionVariables?: Record<string, string>;
  groups?: string[];
  uid?: number;
  wslDefault?: boolean;
}
```

### `home.program(name, opts?): Fragment`

Home Manager program configuration with `enable: true` by default.

```ts
home.program("git", {
  userName: "Adrian Fernandez Garcia",
  userEmail: "tracker086@outlook.com",
  extraConfig: {
    init: { defaultBranch: "main" },
    diff: { tool: "nvimdiff" },
  },
})

home.program("fzf", { enableZshIntegration: true })
home.program("git", { enable: false })
```

Output: `{ homeManager: { programs: { [name]: { enable: true, ...opts } } } }`.
Explicit `enable` in `opts` wins.

### `home.service(name, opts?): Fragment`

Home Manager service configuration with `enable: true` by default.

```ts
home.service("syncthing", { tray: true })
```

Output: `{ homeManager: { services: { [name]: { enable: true, ...opts } } } }`.

### `home.env()` / `home.path()`

Home Manager shell environment helpers.

```ts
home.env({ EDITOR: "nvim", BROWSER: "wslview" })
home.path("$HOME/.local/bin", "$HOME/go/bin")
```

### `home.packages()` / `home.configFile()` / `home.raw()` / `home.activation()`

Home Manager package and XDG config-file helpers.

```ts
home.packages("neovim", "ripgrep")
home.configFile("nvim/init.lua", { text: "vim.o.number = true" })
home.raw("programs.zsh.initExtra = ''echo raw'';")
home.activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })
```

`nix.gc({ olderThan: "14d" })` remains available for NixOS garbage collection.

## Removed Helpers

These older helpers are intentionally not part of the public API:

- `program()` and all `program.*` variants
- `programs.enable()`
- `git()`
- `user()`
- `shell()`

Use `nixos.*`, `darwin.*`, `home.program()`, `home.service()`, `account()`,
`home.env()`, `home.path()`, or plain fragments instead.

## File Structure

```text
src/helpers/
├── account.ts
├── darwin.ts
├── home.ts
├── nixos.ts
└── ...
```

All public helpers are re-exported from `src/helpers/index.ts` and `src/index.ts`.
