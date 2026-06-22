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

### `nixos()` / `nixos.*` and `darwin()` / `darwin.*`

Platform-level helpers target NixOS or nix-darwin explicitly. The namespace
itself is callable for typed option objects; methods cover common patterns, and
`.raw()` is reserved for raw Nix string literals.

```ts
nixos({ networking: { hostName: "wsl" } })
nixos.imports("inputs.nixos-wsl.nixosModules.default")
nixos.program("nix-ld", { libraries: nix.withPkgs(["icu", "zlib"]) })
nixos.service("openssh", { settings: { PermitRootLogin: "no" } })
nixos.packages("ripgrep", "fd", "jq")
nixos.nix({ gc: { automatic: true, dates: "weekly" } })
nixos.boot({ kernelModules: ["tcp_bbr"] })
nixos.networking({ firewall: { allowedTCPPorts: [80, 443] } })
nixos.environment({ systemPackages: ["vim"], variables: { EDITOR: "vim" } })
nixos.users({ users: { root: { shell: nix.pkg("bash") } } })
nixos.system({ stateVersion: "25.05" })
nixos.i18n({ defaultLocale: "en_US.UTF-8" })
nixos.time({ timeZone: "America/Los_Angeles" })
nixos.fonts({ packages: ["noto-fonts"] })
nixos.security({ rtkit: { enable: true } })
nixos.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" })
nixos.sysctl({ "fs.inotify.max_user_watches": 1048576 })
nixos.systemd.service("backup", { script: nix.script`echo backup` })
nixos.raw("environment.variables.FOO = \"bar\";")

darwin({ homebrew: { enable: true } })
darwin.imports("inputs.nix-homebrew.darwinModules.nix-homebrew")
darwin.program("zsh")
darwin.service("some-agent")
darwin.packages("mas")
darwin.nix({ gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } } })
darwin.homebrew({ enable: true, casks: ["visual-studio-code"] })
darwin.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] } })
darwin.defaults({ dock: { autohide: true } })
darwin.raw("system.activationScripts.example.text = \"echo hello\";")
```

Program and service helpers add `enable: true` by default. Explicit `enable` in
`opts` wins.

Type contract:

```ts
interface NixosHelper {
  (config: NixosOptions): Fragment;
  raw(config: string): Fragment;
  imports(...imports: string[]): Fragment;
  program<const K extends string>(name: K, opts?: ProgramOptions<NixosProgramOptions, K>): Fragment;
  service<const K extends string>(name: K, opts?: ServiceOptions<NixosServiceOptions, K>): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  nix(config: NixOptions): Fragment;
  boot(config: BootOptions): Fragment;
  networking(config: NetworkingOptions): Fragment;
  environment(config: EnvironmentOptions): Fragment;
  users(config: UsersOptions): Fragment;
  system(config: NixosSystemOptions): Fragment;
  i18n(config: I18nOptions): Fragment;
  time(config: TimeOptions): Fragment;
  fonts(config: FontsOptions): Fragment;
  security(config: NixosSecurityOptions): Fragment;
  virtualisation: VirtualisationHelper;
  sysctl(settings: SysctlSettings): Fragment;
  systemd(opts: SystemdOptions): Fragment;
}

interface DarwinHelper {
  (config: DarwinOptions): Fragment;
  raw(config: string): Fragment;
  imports(...imports: string[]): Fragment;
  program<const K extends string>(name: K, opts?: ProgramOptions<DarwinProgramOptions, K>): Fragment;
  service<const K extends string>(name: K, opts?: ServiceOptions<DarwinServiceOptions, K>): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  nix(config: NixOptions): Fragment;
  homebrew(config: HomebrewOptions): Fragment;
  launchd: LaunchdHelper;
  defaults(config: DarwinDefaults): Fragment;
}
```

### `account.user()` / `account.group()`

Declares reusable Home Manager user settings, platform-specific system user settings, and local groups.

```ts
const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

const media = account.group("media", () => ({
  members: [adrifer, "jellyfin"],
}));

host("wsl-work", platforms.nixos(), [adrifer(), media()])
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
  extraGroups?: string[];
  uid?: number;
  wslDefault?: boolean;
}
```

`account.user()` and `account.group()` return factories like `feature()` and `profile()`.
The old `account(name, opts)` callable is removed.

### `home()` / `home.program(name, opts?): Fragment`

Home Manager program configuration with `enable: true` by default.

```ts
home({ programs: { git: { enable: true } } })

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

### `home.imports()` / `home.packages()` / `home.files()` / `home.configFile()` / `home.raw()` / `home.activation()`

Home Manager module import, package, arbitrary home-file, XDG config-file, and activation helpers.

```ts
home.imports("inputs.hunk.homeManagerModules.default")
home.packages("neovim", "ripgrep")
home.files({ ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv") })
home.configFile("nvim/init.lua", { text: "vim.o.number = true" })
home.raw("programs.zsh.initExtra = ''echo raw'';")
home.activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })
```

Garbage collection is platform config: use `nixos.nix({ gc })` or `darwin.nix({ gc })`.

Type contract:

```ts
interface HomeHelper {
  (config: HomeOptions): Fragment;
  raw(config: string): Fragment;
  imports(...imports: string[]): Fragment;
  program<const K extends string>(name: K, opts?: ProgramOptions<HomeProgramOptions, K>): Fragment;
  service<const K extends string>(name: K, opts?: ServiceOptions<HomeServiceOptions, K>): Fragment;
  env(vars: Record<string, string>): Fragment;
  path(...paths: string[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  files(files: Record<string, HomeFile>): Fragment;
  configFile(name: string, opts: HomeFile): Fragment;
  configFiles(files: Record<string, HomeFile>): Fragment;
  symlink(path: string, opts?: Omit<HomeFile, "source" | "text">): HomeFile;
  activation(name: string, opts: ActivationOpts): Fragment;
}
```

`nixos(config)`, `home(config)`, and `darwin(config)` accept typed option
objects only. `nixos.raw(expr)`, `home.raw(expr)`, and `darwin.raw(expr)` accept
raw Nix strings only.

## Removed Helpers

These older helpers are intentionally not part of the public API:

- `program()` and all `program.*` variants
- `programs.enable()`
- `git()`
- `user()`
- `shell()`

Use `nixos.*`, `darwin.*`, `home.program()`, `home.service()`, `account.user()`,
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
