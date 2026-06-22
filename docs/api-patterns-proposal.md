# Winix API Patterns Proposal

This document catalogs common NixOS, Home Manager, and nix-darwin configuration patterns found in real-world dotfiles, proposes Winix TypeScript APIs for each, and shows how the examples would translate.

---

## Table of Contents

- [API Shape Rules](#api-shape-rules)
- [Current API Migrations](#current-api-migrations)

1. [System Defaults (darwin)](#1-system-defaults-darwin)
2. [Nix Daemon Settings](#2-nix-daemon-settings)
3. [Boot Configuration](#3-boot-configuration)
4. [Users & Groups](#4-users--groups)
5. [Fonts](#5-fonts)
6. [Home Files & XDG](#6-home-files--xdg)
7. [Home Session Variables & Path](#7-home-session-variables--path)
8. [Containers & Virtualisation](#8-containers--virtualisation)
9. [Systemd Services & Timers](#9-systemd-services--timers)
10. [Security & PAM](#10-security--pam)
11. [Networking](#11-networking)
12. [Environment (system packages & etc files)](#12-environment-system-packages--etc-files)
13. [Homebrew (darwin)](#13-homebrew-darwin)
14. [I18n & Timezone](#14-i18n--timezone)
15. [Launchd (darwin)](#15-launchd-darwin)

---

## API Shape Rules

Use these rules when adding or reviewing Winix helpers:

1. **Mirror the parent Nix namespace by default.** If a Nix option is pure config passthrough under `networking.*`, `boot.*`, `security.*`, etc., prefer one parent helper with an object: `nixos.networking({ firewall, nat })`, `nixos.boot({ loader, initrd })`, `nixos.security({ pam, sudo })`.
2. **Avoid root-level aliases for nested options.** Do not add `nixos.firewall()`, `nixos.networkmanager()`, `nixos.nat()`, etc. unless the helper represents a major Winix concept rather than a shortcut to a nested Nix path.
3. **Use named helpers for keyed collections or awkward workflows.** Options like systemd units, launchd agents, Home Manager files, and OCI containers are keyed by name and verbose as raw objects, so helpers are justified.
4. **Put keyed helpers under the owning namespace when possible.** Prefer `nixos.systemd.service()`, `darwin.launchd.agent()`, and `nixos.virtualisation.ociContainer()` over unrelated root helpers.
5. **Keep justified ergonomic exceptions explicit.** Helpers like `nixos.sysctl()` are acceptable when the concept is commonly discussed independently from its Nix path (`boot.kernel.sysctl`), but they should be documented as exceptions.

## Current API Migrations

These existing helpers should change as part of this API proposal:

| Current helper | Decision | Final API | Reason |
|---|---|---|---|
| `nix.gc()` | **Remove** | `nixos.nix({ gc })` / `darwin.nix({ gc })` | GC is platform config, not an expression-builder concern. |
| `nixos.firewall()` | **Remove** | `nixos.networking({ firewall })` | Firewall is pure passthrough for `networking.firewall`; a root helper is unnecessary. |
| `account(name, opts)` | **Remove** | `account.user(name, factory)` | Account users should be reusable factories like features/profiles; no compatibility alias is needed before a stable release. |
| `home.configFile()` / `home.configFiles()` file shape | **Keep, widen accepted options** | Shared `HomeFile` used by `home.files()`, `home.configFile()`, and `home.configFiles()` | Same Home Manager file options should be accepted consistently. |
| `nixos.systemd(opts)` | **Keep, extend as callable namespace** | Keep `nixos.systemd(config)` and add `nixos.systemd.service()`, `.timer()`, `.userService()`, `.tmpfiles()` | Systemd unit collections are keyed and benefit from focused helpers. |

No other existing helpers are intentionally removed by this proposal. Existing helpers such as `nixos.sysctl()`, `home.env()`, `home.path()`, `nixos.packages()`, `darwin.packages()`, and `home.packages()` remain valid unless a future proposal explicitly lists them here.

---

## 1. System Defaults (darwin)

macOS system preferences controlled declaratively. This is one of the most popular nix-darwin patterns.

### Nix Examples

```nix
# From dustinlyons/nixos-config
system.defaults = {
  NSGlobalDomain = {
    AppleShowAllExtensions = true;
    ApplePressAndHoldEnabled = false;
    KeyRepeat = 2;
    InitialKeyRepeat = 15;
    "com.apple.mouse.tapBehavior" = 1;
    "com.apple.sound.beep.volume" = 0.0;
  };
  dock = {
    autohide = false;
    show-recents = false;
    orientation = "bottom";
    tilesize = 48;
  };
  finder = {
    _FXShowPosixPathInTitle = false;
    ShowPathbar = true;
    FXDefaultSearchScope = "SCcf";
    FXPreferredViewStyle = "clmv";
  };
  trackpad = {
    Clicking = true;
    TrackpadThreeFingerDrag = true;
  };
};

system.keyboard = {
  enableKeyMapping = true;
  remapCapsLockToControl = true;
};
```

```nix
# From clo4/nix-dotfiles
system.defaults.NSGlobalDomain = {
  ApplePressAndHoldEnabled = false;
  AppleShowAllExtensions = true;
  NSAutomaticCapitalizationEnabled = false;
  NSAutomaticPeriodSubstitutionEnabled = false;
  NSAutomaticSpellingCorrectionEnabled = false;
  NSWindowShouldDragOnGesture = true;
  InitialKeyRepeat = 15;
  KeyRepeat = 2;
  "com.apple.keyboard.fnState" = false;
};

system.defaults.dock.autohide = true;

system.defaults.finder = {
  ShowPathbar = true;
  FXDefaultSearchScope = "SCcf";
  FXPreferredViewStyle = "clmv";
};
```

### Proposed API

Single flat helper. No sub-helpers (`.defaults.dock()`, etc.) because there's no special logic (no implicit `enable: true` or platform conditionals). Types provide autocomplete for all sections.

```ts
darwin.defaults(config: {
  NSGlobalDomain?: { ... };
  dock?: { ... };
  finder?: { ... };
  trackpad?: { ... };
  loginwindow?: { ... };
  screencapture?: { ... };
  screensaver?: { ... };
  [key: string]: unknown;
}): Fragment
```

Keyboard goes through the main `darwin()` callable since it's just `system.keyboard`:

```ts
darwin({ system: { keyboard: { ... } } })
```

### Winix Translation

```ts
darwin.defaults({
  NSGlobalDomain: {
    AppleShowAllExtensions: true,
    ApplePressAndHoldEnabled: false,
    KeyRepeat: 2,
    InitialKeyRepeat: 15,
    "com.apple.mouse.tapBehavior": 1,
    "com.apple.sound.beep.volume": 0.0,
  },
  dock: {
    autohide: false,
    "show-recents": false,
    orientation: "bottom",
    tilesize: 48,
  },
  finder: {
    ShowPathbar: true,
    FXDefaultSearchScope: "SCcf",
    FXPreferredViewStyle: "clmv",
  },
  trackpad: {
    Clicking: true,
    TrackpadThreeFingerDrag: true,
  },
});

darwin({ system: { keyboard: { enableKeyMapping: true, remapCapsLockToControl: true } } });
```

---

## 2. Nix Daemon Settings

Configuring the Nix daemon itself: experimental features, substituters, trusted users, garbage collection, registry.

The `nix` section exists in both NixOS and darwin with ~90% overlap. The differences are minor: darwin uses `interval` for gc scheduling vs NixOS `dates`, and NixOS has Linux-specific options (daemonCPUSchedPolicy, sshServe, firewall). The shared parts (settings, registry, buildMachines) are identical.

### Nix Examples

```nix
# From fufexan/dotfiles
nix = {
  package = pkgs.lix;
  registry = lib.mapAttrs (_: v: { flake = v; }) flakeInputs;
  nixPath = lib.mapAttrsToList (key: _: "${key}=flake:${key}") config.nix.registry;
  settings = {
    auto-optimise-store = true;
    builders-use-substitutes = true;
    experimental-features = [ "nix-command" "flakes" ];
    flake-registry = "/etc/nix/registry.json";
    keep-derivations = true;
    keep-outputs = true;
    trusted-users = [ "root" "@wheel" ];
  };
};
```

```nix
# From clo4/nix-dotfiles
nix.enable = true;
nix.settings.experimental-features = [ "nix-command" "flakes" ];
nix.settings.trusted-users = [ "@admin" ];
nix.channel.enable = false;
nix.distributedBuilds = true;
nix.buildMachines = [{
  hostName = "homeserver1";
  sshUser = "robert";
  system = "x86_64-linux";
  maxJobs = 8;
  supportedFeatures = [ "kvm" "benchmark" "big-parallel" ];
}];
```

```nix
# From dustinlyons/nixos-config (darwin)
nix = {
  enable = false;
  package = pkgs.nix;
  settings = {
    trusted-users = [ "@admin" "${user}" ];
    substituters = [
      "https://nix-community.cachix.org"
      "https://cache.nixos.org"
    ];
    trusted-public-keys = [
      "cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="
    ];
  };
  extraOptions = ''
    experimental-features = nix-command flakes
  '';
};
```

### Proposed API

Platform-specific helpers: `nixos.nix()` and `darwin.nix()`. No sub-helpers (gc, settings, etc.) because none have special logic — they're all pure config passthrough. The bundled types provide autocomplete.

The existing `nix` namespace stays as-is (expression builders: `nix.pkg()`, `nix.str`, `nix.expr()`, etc.). The current `nix.gc()` helper is removed in favor of `nixos.nix({ gc: { ... } })` / `darwin.nix({ gc: { ... } })`.

```ts
nixos.nix(config: {
  enable?: boolean;
  package?: PackageRef;
  settings?: { ... };  // typed from generated options
  gc?: { automatic?: boolean; dates?: string; options?: string; ... };
  optimise?: { automatic?: boolean; dates?: string };
  registry?: Record<string, unknown>;
  nixPath?: string[];
  distributedBuilds?: boolean;
  buildMachines?: Array<{ ... }>;
  extraOptions?: string;
  channel?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment

darwin.nix(config: {
  enable?: boolean;
  package?: PackageRef;
  settings?: { ... };  // typed from generated options
  gc?: { automatic?: boolean; interval?: { Weekday?: number; Hour?: number; Minute?: number }; options?: string; ... };
  optimise?: { automatic?: boolean; interval?: { ... } };
  registry?: Record<string, unknown>;
  nixPath?: string[];
  distributedBuilds?: boolean;
  buildMachines?: Array<{ ... }>;
  extraOptions?: string;
  channel?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
// NixOS
nixos.nix({
  settings: {
    autoOptimiseStore: true,
    buildersUseSubstitutes: true,
    experimentalFeatures: ["nix-command", "flakes"],
    trustedUsers: ["root", "@wheel"],
    substituters: ["https://nix-community.cachix.org", "https://cache.nixos.org"],
    trustedPublicKeys: ["cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="],
  },
  gc: { automatic: true, dates: "weekly", options: "--delete-older-than 7d" },
});

// darwin
darwin.nix({
  settings: {
    experimentalFeatures: ["nix-command", "flakes"],
    trustedUsers: ["@admin"],
  },
  gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } },
});

// Distributed builds (same on both)
nixos.nix({
  distributedBuilds: true,
  buildMachines: [{
    hostName: "homeserver1",
    sshUser: "robert",
    system: "x86_64-linux",
    maxJobs: 8,
    supportedFeatures: ["kvm", "benchmark", "big-parallel"],
  }],
});
```

---

## 3. Boot Configuration

Kernel modules, bootloader, initrd, sysctl (security/performance tuning).

### Nix Examples

```nix
# From clo4/nix-dotfiles (homeserver)
boot.loader.efi.canTouchEfiVariables = true;
boot.initrd.availableKernelModules = [
  "xhci_pci" "ahci" "nvme" "usbhid" "usb_storage" "sd_mod"
];
boot.kernelModules = [ "kvm-intel" ];
boot.kernelPackages = pkgs.linuxPackages_latest;
boot.supportedFilesystems = [ "btrfs" ];
boot.initrd.supportedFilesystems = [ "btrfs" ];
```

```nix
# From fufexan/dotfiles — security hardening via sysctl
boot.kernel.sysctl = {
  "kernel.sysrq" = 0;
  "net.ipv4.icmp_ignore_bogus_error_responses" = 1;
  "net.ipv4.conf.default.rp_filter" = 1;
  "net.ipv4.conf.all.rp_filter" = 1;
  "net.ipv4.conf.all.accept_source_route" = 0;
  "net.ipv4.conf.all.send_redirects" = 0;
  "net.ipv4.tcp_syncookies" = 1;
  "net.ipv4.tcp_rfc1337" = 1;
  "net.ipv4.tcp_fastopen" = 3;
  "net.ipv4.tcp_congestion_control" = "bbr";
  "net.core.default_qdisc" = "cake";
};
boot.kernelModules = [ "tcp_bbr" ];
```

### Proposed API

```ts
nixos.boot(config: {
  loader?: {
    systemdBoot?: { enable?: boolean; configurationLimit?: number };
    grub?: { enable?: boolean; device?: string; efiSupport?: boolean };
    efi?: { canTouchEfiVariables?: boolean };
  };
  kernelModules?: string[];
  kernelPackages?: PackageRef;
  extraModulePackages?: PackageRef[];
  supportedFilesystems?: string[];
  initrd?: {
    availableKernelModules?: string[];
    kernelModules?: string[];
    supportedFilesystems?: string[];
  };
}): Fragment
```

Note: `nixos.sysctl()` already exists for `boot.kernel.sysctl`. This is an intentional ergonomic exception because sysctl is commonly discussed as its own concept.

### Winix Translation

```ts
nixos.boot({
  loader: {
    efi: { canTouchEfiVariables: true },
  },
  initrd: {
    availableKernelModules: ["xhci_pci", "ahci", "nvme", "usbhid", "usb_storage", "sd_mod"],
    supportedFilesystems: ["btrfs"],
  },
  kernelModules: ["kvm-intel", "tcp_bbr"],
  kernelPackages: "pkgs.linuxPackages_latest",
  supportedFilesystems: ["btrfs"],
});

nixos.sysctl({
  "kernel.sysrq": 0,
  "net.ipv4.tcp_syncookies": 1,
  "net.ipv4.tcp_fastopen": 3,
  "net.ipv4.tcp_congestion_control": "bbr",
  "net.core.default_qdisc": "cake",
});
```

---

## 4. Users & Groups

System users, groups, SSH keys, shells, per-user packages, WSL defaults, and optional Home Manager user configuration.

NixOS encodes this across `users.users`, `users.groups`, and often `home-manager.users`, but in Winix these belong to the existing account domain because they all describe local accounts. The current `account(name, config)` helper should become an `account` namespace with explicit `account.user()` and `account.group()` helpers.

These helpers should follow the same pattern as `feature()`: define a reusable factory once, then call it inside hosts/profiles with `adrifer()`, `mediaGroup()`, etc. This keeps top-level user configuration consistent across Winix: exported helpers are always factories, and host/profile entries always call those factories to instantiate fragments.

### Nix Examples

```nix
# From fufexan/dotfiles
users.users.mihai = {
  isNormalUser = true;
  shell = pkgs.zsh;
  extraGroups = [
    "input" "libvirtd" "networkmanager" "plugdev" "video" "wheel"
  ];
};
```

```nix
# From clo4/nix-dotfiles (darwin)
users.users.robert = {
  description = "Robert";
  home = "/Users/robert";
  openssh.authorizedKeys.keys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFkVAe4iwrprDibMgY1m0BeUPgrKBRErKRfLfxjVl+lu"
  ];
};
```

```nix
# From clo4/nix-dotfiles (NixOS server)
users.users.robert = {
  isNormalUser = true;
  extraGroups = [ "wheel" ];
  openssh.authorizedKeys.keyFiles = [
    "${flake}/hosts/macbook-air/id_ed25519.pub"
  ];
};
```

### Proposed API

Extend the existing account helper rather than adding `nixos.user()` / `nixos.group()` or `darwin.user()` / `darwin.group()` helpers.

```ts
type AccountUserRef = {
  readonly kind: "account.user";
  readonly name: string;
};

type AccountGroupMember = AccountUserRef | string;

interface AccountUserFactory<T extends unknown[] = []> {
  (...args: T): LazyFragment;
  readonly id: string;
  readonly name: string;
  readonly kind: "account.user";
  readonly isActive: boolean;
}

interface AccountGroupFactory<T extends unknown[] = []> {
  (...args: T): LazyFragment;
  readonly id: string;
  readonly name: string;
  readonly kind: "account.group";
  readonly isActive: boolean;
}

account.user(name: string, factory: () => {
  // Winix conveniences
  admin?: boolean;          // Adds wheel/admin groups for the active platform.
  stateVersion?: string;    // Sets the matching Home Manager state version.
  wslDefault?: boolean;     // Marks this user as the default WSL user on NixOS-WSL.

  // NixOS/darwin users.users.<name>
  description?: string;
  isNormalUser?: boolean;
  isSystemUser?: boolean;
  uid?: number;
  group?: string;
  extraGroups?: string[];
  shell?: PackageRef | string;
  packages?: PackageRef[];
  home?: string;
  openssh?: {
    authorizedKeys?: string[];
    authorizedKeyFiles?: string[];
  };
  hashedPasswordFile?: string;

  // Optional Home Manager config for home-manager.users.<name>
  homeManager?: Fragment;

  [key: string]: unknown;
}): AccountUserFactory

account.group(name: string, factory?: () => {
  gid?: number;
  members?: AccountGroupMember[];
  [key: string]: unknown;
}): AccountGroupFactory
```

`account.user()` defines a reusable account factory. Calling the returned factory maps to `users.users.<name>`. If `homeManager` or `stateVersion` is provided, it also emits `home-manager.users.<name>`. The factory itself is also an `AccountUserRef`, so it can be passed to `account.group()` without duplicating the username.

`account.group()` defines a reusable group factory. Calling the returned factory maps to `users.groups.<name>`.

Group members should accept both user references and raw strings. References avoid duplicating local account names; strings are still needed for users created by other modules or packages.

### Winix Translation

```ts
export const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));

export const mediaGroup = account.group("media", () => ({
  gid: 1000,
  members: [adrifer, "jellyfin"],
}));

host("wsl-work", platforms.nixos({ stateVersion: "25.05" }), [
  wsl(),
  adrifer(),
  mediaGroup(),
]);

export const mihai = account.user("mihai", () => ({
  isNormalUser: true,
  shell: nix.pkg("zsh"),
  extraGroups: ["input", "libvirtd", "networkmanager", "plugdev", "video", "wheel"],
}));

export const robert = account.user("robert", () => ({
  description: "Robert",
  home: "/Users/robert",
  openssh: {
    authorizedKeys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFkVAe4..."],
  },
  homeManager: {
    programs: {
      git: {
        enable: true,
        userName: "Robert",
      },
    },
  },
}));
```

### Rationale

`account.user()` / `account.group()` are the preferred ergonomic APIs for managed users and groups. `nixos.users()` remains available as a parent namespace passthrough for system-level cases that are not account concepts, such as configuring `users.users.root.shell`.

Moving from `account(name, config)` to `account.user(name, factory)` makes the account namespace extensible for groups and per-user Home Manager wiring. Returning factories also keeps account helpers aligned with `feature()` and `profile()`: define once, call in the host/profile where the fragment should be active. The old callable `account(name, opts)` is removed.

---

## 5. Fonts

System-wide font packages and fontconfig defaults.

### Nix Examples

```nix
# From fufexan/dotfiles
fonts = {
  packages = with pkgs; [
    material-symbols
    libertinus
    noto-fonts
    noto-fonts-cjk-sans
    noto-fonts-color-emoji
    roboto
    (google-fonts.override { fonts = [ "Inter" ]; })
    jetbrains-mono
    nerd-fonts.jetbrains-mono
    nerd-fonts.symbols-only
  ];
  enableDefaultPackages = false;
  fontconfig.defaultFonts = {
    serif = [ "Libertinus Serif" ];
    sansSerif = [ "Inter" ];
    monospace = [ "JetBrains Mono Nerd Font" ];
    emoji = [ "Noto Color Emoji" ];
  };
};
```

### Proposed API

```ts
nixos.fonts(config: {
  packages: PackageRef[];
  enableDefaultPackages?: boolean;
  fontconfig?: {
    defaultFonts?: {
      serif?: string[];
      sansSerif?: string[];
      monospace?: string[];
      emoji?: string[];
    };
  };
}): Fragment
```

### Winix Translation

```ts
nixos.fonts({
  packages: [
    "material-symbols",
    "libertinus",
    "noto-fonts",
    "noto-fonts-cjk-sans",
    "noto-fonts-color-emoji",
    "jetbrains-mono",
    "nerd-fonts.jetbrains-mono",
    "nerd-fonts.symbols-only",
  ],
  enableDefaultPackages: false,
  fontconfig: {
    defaultFonts: {
      serif: ["Libertinus Serif"],
      sansSerif: ["Inter"],
      monospace: ["JetBrains Mono Nerd Font"],
      emoji: ["Noto Color Emoji"],
    },
  },
});
```

---

## 6. Home Files & XDG

Declaratively managing dotfiles via `home.file` and XDG config/data files.

### Nix Examples

```nix
# From clo4/nix-dotfiles — symlinking config dirs
home.file = {
  ".config/ghostty/config".source = "config/ghostty/config";
  ".config/helix".source = "config/helix";
  ".config/kitty".source = "config/kitty";
  ".config/nvim".source = "config/nvim";
  ".config/tmux".source = "config/tmux";
  ".config/git".source = "config/git";
  ".config/fish/conf.d".source = "config/fish/conf.d";
  ".config/fish/functions".source = "config/fish/functions";
  ".config/fish/config.fish".source = "config/fish/config.fish";
  ".zshenv".source = "config/zsh/home_zshenv";
  ".npmrc".source = "config/npm/npmrc";
};
```

```nix
# XDG config files via home-manager
xdg.configFile."git/allowed_signers".text = ''
  mihai@fufexan.net namespaces="git" ssh-ed25519 AAAA...
'';
```

### Proposed API

`home.configFile()` / `home.configFiles()` already exist for XDG config files. Add `home.files()` for arbitrary home paths, and use the same file-entry shape across both APIs:

```ts
type HomeFile = {
  source?: string | NixExpr;
  text?: string;
  recursive?: boolean;
  executable?: boolean;
  force?: boolean;
};

// New: arbitrary home-relative file management
home.files(files: Record<string, HomeFile>): Fragment

// Already exists: XDG config files (~/.config/...)
home.configFile(name: string, opts: HomeFile): Fragment
home.configFiles(files: Record<string, HomeFile>): Fragment

// Convenience for live, out-of-store symlinks
home.symlink(path: string, opts?: Omit<HomeFile, "source" | "text">): HomeFile
```

`source` already produces Home Manager-managed symlinks. `home.symlink()` is for the common dotfiles workflow where the target should point at a live checkout outside the Nix store via `config.lib.file.mkOutOfStoreSymlink`.

### Winix Translation

```ts
home.files({
  ".config/ghostty/config": { source: "config/ghostty/config" },
  ".config/helix": { source: "config/helix" },
  ".config/kitty": { source: "config/kitty" },
  ".config/nvim": { source: "config/nvim" },
  ".config/git": { source: "config/git" },
  ".zshenv": { source: "config/zsh/home_zshenv" },
  ".npmrc": { source: "config/npm/npmrc" },
});

home.configFile("git/allowed_signers", {
  text: 'mihai@fufexan.net namespaces="git" ssh-ed25519 AAAA...',
});

home.configFiles({
  nvim: home.symlink("~/dotfiles/nvim/.config/nvim", { recursive: true }),
  yazi: home.symlink("~/dotfiles/yazi/.config/yazi", { recursive: true }),
});

home.files({
  ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv"),
  ".npmrc": home.symlink("~/dotfiles/npm/.npmrc"),
});
```

---

## 7. Home Session Variables & Path

Environment variables and PATH additions for the user session.

### Nix Examples

```nix
# From clo4/nix-dotfiles
home.sessionVariables = {
  FISH_GREETING_CHECK_SUDO_TOUCHID = "1";
  NIX_CONFIG_REV = flake.rev or flake.dirtyRev;
  NIX_CONFIG_DIR = config.my.config.directory;
  ZDOTDIR = "$HOME/.config/zsh";
  DELTA_PAGER = "less -R";
};
```

```nix
# From dustinlyons — PATH in zsh initExtra
export PATH=$HOME/.pnpm-packages/bin:$HOME/.npm-packages/bin:$HOME/bin:$PATH
```

### Proposed API

Already exists: `home.env()` and `home.path()`.

```ts
home.env(vars: Record<string, string>): Fragment
home.path(...paths: string[]): Fragment
```

### Winix Translation

```ts
home.env({
  FISH_GREETING_CHECK_SUDO_TOUCHID: "1",
  ZDOTDIR: "$HOME/.config/zsh",
  DELTA_PAGER: "less -R",
});

home.path(
  "$HOME/.pnpm-packages/bin",
  "$HOME/.npm-packages/bin",
  "$HOME/bin",
);
```

✅ Already implemented.

---

## 8. Containers & Virtualisation

OCI containers (Docker/Podman), VMs, and related config.

### Nix Examples

```nix
# From clo4/nix-dotfiles
virtualisation.podman.enable = true;
virtualisation.oci-containers.backend = "podman";
virtualisation.oci-containers.containers.vrising = {
  image = "docker.io/trueosiris/vrising";
  autoStart = true;
  ports = [
    "9876:9876/udp"
    "9877:9877/udp"
  ];
  volumes = [
    "/srv/vrising/server:/mnt/vrising/server"
    "/srv/vrising/data:/mnt/vrising/persistentdata"
  ];
  environment = {
    TZ = config.time.timeZone;
    SERVERNAME = "vrising-clo4";
  };
  extraOptions = [ "--network=bridge" ];
};
```

### Proposed API

```ts
type OciContainerOptions = {
  image: string;
  autoStart?: boolean;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  extraOptions?: string[];
  [key: string]: unknown;
};

nixos.virtualisation(config: {
  podman?: { enable?: boolean; [key: string]: unknown };
  docker?: { enable?: boolean; [key: string]: unknown };
  ociContainers?: {
    backend?: "podman" | "docker";
    containers?: Record<string, OciContainerOptions>;
  };
  libvirtd?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment

// Convenience for the keyed OCI container collection
nixos.virtualisation.ociContainer(name: string, config: OciContainerOptions): Fragment
```

`oci-containers.containers` is a keyed collection, so a focused helper is useful, but it stays under the owning `virtualisation` namespace instead of becoming a root-level `nixos.container()` alias.

### Winix Translation

```ts
nixos.virtualisation({
  podman: { enable: true },
  ociContainers: { backend: "podman" },
});

nixos.virtualisation.ociContainer("vrising", {
  image: "docker.io/trueosiris/vrising",
  autoStart: true,
  ports: ["9876:9876/udp", "9877:9877/udp"],
  volumes: [
    "/srv/vrising/server:/mnt/vrising/server",
    "/srv/vrising/data:/mnt/vrising/persistentdata",
  ],
  environment: {
    TZ: "Australia/Sydney",
    SERVERNAME: "vrising-clo4",
  },
  extraOptions: ["--network=bridge"],
});
```

---

## 9. Systemd Services & Timers

Custom systemd services, user services, and timers. Note: `nixos.systemd()` already exists but is basic.

### Nix Examples

```nix
# From dustinlyons/nixos-config — user services
systemd.user.services.atlas-devenv = {
  description = "Start atlas server in tmux";
  wantedBy = [ "default.target" ];
  after = [ "graphical-session.target" ];
  serviceConfig = {
    Type = "forking";
    ExecStart = "${startScript}";
    ExecStop = "${tmux} kill-session -t atlas";
    RemainAfterExit = "no";
    Environment = [ "PATH=..." ];
  };
};

# From dustinlyons — timers
systemd.timers.world-buff-fetcher = {
  description = "Run Playwright script hourly from 6am to 10pm";
  wantedBy = [ "timers.target" ];
  timerConfig = {
    OnCalendar = "*-*-* 06..22:00:00";
    Persistent = true;
    RandomizedDelaySec = "30s";
  };
};
```

```nix
# From clo4/nix-dotfiles — tmpfiles
systemd.tmpfiles.rules = [
  "d /srv/vrising 0700 root root -"
  "d /srv/vrising/server 0700 root root -"
];

# Extending a podman-generated service
systemd.services.podman-vrising = {
  after = [ "network.target" ];
  requires = [ "network.target" ];
};
```

### Proposed API

```ts
nixos.systemd(config: SystemdOptions): Fragment

nixos.systemd.service(name: string, config: {
  description?: string;
  wantedBy?: string[];
  after?: string[];
  requires?: string[];
  serviceConfig?: {
    Type?: "simple" | "forking" | "oneshot" | "notify";
    ExecStart?: string;
    ExecStop?: string;
    User?: string;
    Group?: string;
    WorkingDirectory?: string;
    Environment?: string[];
    RemainAfterExit?: boolean | string;
    [key: string]: unknown;
  };
  script?: string;
}): Fragment

nixos.systemd.userService(name: string, config: { ... }): Fragment

nixos.systemd.timer(name: string, config: {
  description?: string;
  wantedBy?: string[];
  timerConfig?: {
    OnCalendar?: string;
    OnBootSec?: string;
    OnUnitActiveSec?: string;
    Persistent?: boolean;
    RandomizedDelaySec?: string;
  };
}): Fragment

nixos.systemd.tmpfiles(rules: string[]): Fragment
```

The parent `nixos.systemd()` helper remains available for raw systemd passthrough. The named helpers are justified because services, timers, user services, and tmpfiles are keyed collections or list-oriented workflows.

### Winix Translation

```ts
nixos.systemd.userService("atlas-devenv", {
  description: "Start atlas server in tmux",
  wantedBy: ["default.target"],
  after: ["graphical-session.target"],
  serviceConfig: {
    Type: "forking",
    ExecStart: "${startScript}",
    ExecStop: "${tmux} kill-session -t atlas",
    RemainAfterExit: "no",
    Environment: ["PATH=/run/current-system/sw/bin:..."],
  },
});

nixos.systemd.timer("world-buff-fetcher", {
  description: "Run Playwright script hourly",
  wantedBy: ["timers.target"],
  timerConfig: {
    OnCalendar: "*-*-* 06..22:00:00",
    Persistent: true,
    RandomizedDelaySec: "30s",
  },
});

nixos.systemd.tmpfiles([
  "d /srv/vrising 0700 root root -",
  "d /srv/vrising/server 0700 root root -",
]);
```

---

## 10. Security & PAM

Sudo configuration, PAM services, and security policies.

### Nix Examples

```nix
# From fufexan/dotfiles
security = {
  pam.services.hyprlock.text = "auth include login";
  rtkit.enable = true;
  sudo.wheelNeedsPassword = false;
};
```

```nix
# From clo4/nix-dotfiles (darwin)
security.pam.services.sudo_local.touchIdAuth = true;
```

### Proposed API

```ts
nixos.security(config: {
  sudo?: {
    wheelNeedsPassword?: boolean;
    extraRules?: Array<{ groups?: string[]; commands?: Array<{ command: string; options?: string[] }> }>;
    [key: string]: unknown;
  };
  pam?: {
    services?: Record<string, { text?: string; touchIdAuth?: boolean; [key: string]: unknown }>;
  };
  rtkit?: { enable?: boolean };
  polkit?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment

darwin.security(config: {
  pam?: {
    services?: Record<string, { touchIdAuth?: boolean; [key: string]: unknown }>;
  };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.security({
  rtkit: { enable: true },
  sudo: { wheelNeedsPassword: false },
  pam: {
    services: {
      hyprlock: { text: "auth include login" },
    },
  },
});

darwin.security({
  pam: {
    services: {
      sudo_local: { touchIdAuth: true },
    },
  },
});
```

---

## 11. Networking

Hostname, DHCP, firewall, DNS.

### Nix Examples

```nix
# From clo4/nix-dotfiles
networking.hostName = "homeserver1";
networking.hostId = "027fb931";
networking.useDHCP = true;
```

```nix
# Basic firewall (already supported)
networking.firewall = {
  enable = true;
  allowedTCPPorts = [ 22 80 443 8384 ];
  allowedUDPPorts = [ 51820 ];
};
```

### Proposed API

Add a general networking helper. Firewall stays inside this parent helper because it is pure passthrough for `networking.firewall`.

```ts
nixos.networking(config: {
  hostName?: string;
  hostId?: string;
  useDHCP?: boolean;
  interfaces?: Record<string, { useDHCP?: boolean; ipv4?: unknown }>;
  nameservers?: string[];
  firewall?: FirewallOptions;
  wireless?: { enable?: boolean; [key: string]: unknown };
  networkmanager?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.networking({
  hostName: "homeserver1",
  hostId: "027fb931",
  useDHCP: true,
  firewall: {
    enable: true,
    allowedTCPPorts: [22, 80, 443],
  },
});
```

---

## 12. Environment (system packages & etc files)

System-wide packages and declarative /etc file management.

### Nix Examples

```nix
# From clo4/nix-dotfiles
environment.systemPackages = [ pkgs.fish pkgs.mosh ];

environment.pathsToLink = [
  "/share/fish/vendor_completions.d"
  "/share/fish/vendor_functions.d"
];

# Declarative /etc file
environment.etc."ssh/sshd_config.d/999-disable-password-auth.conf".text = ''
  PermitRootLogin no
  PasswordAuthentication no
  KbdInteractiveAuthentication no
  UsePAM no
'';
```

```nix
# From fufexan/dotfiles
environment.variables.NH_FLAKE = "/home/mihai/Projects/dotfiles";
environment.variables.NIXOS_OZONE_WL = "1";
```

### Proposed API

`nixos.packages()` / `darwin.packages()` already exists. Add:

```ts
nixos.environment(config: {
  systemPackages?: PackageRef[];
  variables?: Record<string, string>;
  pathsToLink?: string[];
  etc?: Record<string, { text?: string; source?: string; mode?: string }>;
  shells?: PackageRef[];
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.environment({
  systemPackages: ["fish", "mosh"],
  variables: {
    NIXOS_OZONE_WL: "1",
  },
  pathsToLink: [
    "/share/fish/vendor_completions.d",
    "/share/fish/vendor_functions.d",
  ],
  etc: {
    "ssh/sshd_config.d/999-disable-password-auth.conf": {
      text: `PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
UsePAM no`,
    },
  },
});
```

---

## 13. Homebrew (darwin)

Managing macOS apps via Homebrew casks and Mac App Store.

### Nix Examples

```nix
# From dustinlyons/nixos-config
homebrew = {
  enable = true;
  casks = [
    "claude" "discord" "slack" "telegram" "zoom"
    "visual-studio-code" "google-chrome"
    "raycast" "appcleaner" "vlc" "steam"
  ];
  masApps = {
    "hidden-bar" = 1452453066;
    "wireguard" = 1451685025;
  };
};
```

```nix
# From clo4/nix-dotfiles (via nix-homebrew)
nix-homebrew.enable = true;
nix-homebrew.user = "robert";
```

### Proposed API

```ts
darwin.homebrew(config: {
  enable?: boolean;
  casks?: string[];
  brews?: string[];
  taps?: string[];
  masApps?: Record<string, number>;
  onActivation?: {
    cleanup?: "none" | "uninstall" | "zap";
    autoUpdate?: boolean;
    upgrade?: boolean;
  };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
darwin.homebrew({
  enable: true,
  casks: [
    "claude", "discord", "slack", "telegram", "zoom",
    "visual-studio-code", "google-chrome",
    "raycast", "appcleaner", "vlc", "steam",
  ],
  masApps: {
    "hidden-bar": 1452453066,
    "wireguard": 1451685025,
  },
  onActivation: {
    cleanup: "zap",
    autoUpdate: true,
    upgrade: true,
  },
});
```

---

## 14. I18n & Timezone

Internationalisation settings and timezone. These are separate Nix namespaces, so they use separate Winix helpers.

### Nix Examples

```nix
# From fufexan/dotfiles
i18n = {
  defaultLocale = "en_US.UTF-8";
  supportedLocales = [
    "en_US.UTF-8/UTF-8"
    "ja_JP.UTF-8/UTF-8"
    "ro_RO.UTF-8/UTF-8"
  ];
};

time.timeZone = "Europe/Bucharest";
```

### Proposed API

```ts
nixos.i18n(config: {
  defaultLocale?: string;
  supportedLocales?: string[];
  [key: string]: unknown;
}): Fragment

nixos.time(config: {
  timeZone?: string;
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.i18n({
  defaultLocale: "en_US.UTF-8",
  supportedLocales: ["en_US.UTF-8/UTF-8", "ja_JP.UTF-8/UTF-8"],
});

nixos.time({
  timeZone: "America/Los_Angeles",
});
```

---

## 15. Launchd (darwin)

macOS user/system agents (equivalent of systemd on Linux).

### Nix Examples

```nix
# From dustinlyons/nixos-config
launchd.user.agents.emacs = {
  path = [ config.environment.systemPath ];
  serviceConfig = {
    KeepAlive = true;
    ProgramArguments = [
      "/bin/sh" "-c"
      "${pkgs.emacs}/bin/emacs --fg-daemon"
    ];
    StandardErrorPath = "/tmp/emacs.err.log";
    StandardOutPath = "/tmp/emacs.out.log";
  };
};
```

### Proposed API

```ts
darwin.launchd(config: {
  user?: { agents?: Record<string, LaunchdAgentOptions> };
  daemons?: Record<string, LaunchdAgentOptions>;
  [key: string]: unknown;
}): Fragment

type LaunchdAgentOptions = {
  path?: string[];
  serviceConfig: {
    KeepAlive?: boolean;
    ProgramArguments: string[];
    RunAtLoad?: boolean;
    StandardErrorPath?: string;
    StandardOutPath?: string;
    WorkingDirectory?: string;
    EnvironmentVariables?: Record<string, string>;
    [key: string]: unknown;
  };
};

// Convenience for keyed launchd collections
darwin.launchd.agent(name: string, config: LaunchdAgentOptions): Fragment

darwin.launchd.daemon(name: string, config: LaunchdAgentOptions): Fragment  // system-level
```

Launchd agents/daemons are keyed collections, so named helpers are useful, but they stay under the owning `launchd` namespace instead of root-level `darwin.launchAgent()` / `darwin.launchDaemon()` helpers.

### Winix Translation

```ts
darwin.launchd.agent("emacs", {
  path: [nix.expr("config.environment.systemPath")],
  serviceConfig: {
    KeepAlive: true,
    ProgramArguments: ["/bin/sh", "-c", "${pkgs.emacs}/bin/emacs --fg-daemon"],
    StandardErrorPath: "/tmp/emacs.err.log",
    StandardOutPath: "/tmp/emacs.out.log",
  },
});
```

---

## Summary: Priority Matrix

| Pattern | Usage Frequency | Current Status | Complexity | Priority |
|---------|----------------|----------------|------------|----------|
| System Defaults (darwin) | ⭐⭐⭐⭐⭐ | ✅ Done | Low | **P1** |
| Nix Settings (`nixos.nix()` / `darwin.nix()`) | ⭐⭐⭐⭐⭐ | ✅ Done | Medium | **P1** |
| Boot Configuration | ⭐⭐⭐⭐ | ✅ Done | Low | **P1** |
| Users & Groups | ⭐⭐⭐⭐ | ✅ Done | Medium | **P2** |
| Fonts | ⭐⭐⭐⭐ | ✅ Done | Low | **P2** |
| Home Files & XDG | ⭐⭐⭐⭐ | ✅ Done | Low | **P2** |
| Containers & Virtualisation | ⭐⭐⭐ | ✅ Done | Medium | **P2** |
| Systemd Services & Timers | ⭐⭐⭐⭐ | ✅ Done | Medium | **P2** |
| Security & PAM | ⭐⭐⭐ | ✅ Done | Low | **P2** |
| Networking | ⭐⭐⭐⭐ | ✅ Done | Low | **P3** |
| Environment & etc | ⭐⭐⭐⭐ | ✅ Done | Low | **P3** |
| Homebrew (darwin) | ⭐⭐⭐⭐ | ✅ Done | Low | **P1** |
| I18n & Timezone | ⭐⭐⭐ | ✅ Done | Low | **P3** |
| Launchd (darwin) | ⭐⭐ | ✅ Done | Low | **P3** |
| Session Variables & Path | ⭐⭐⭐⭐ | ✅ Done | — | — |

### Design Decisions

- **`nix` namespace** stays as expression builders (`nix.pkg()`, `nix.str`, `nix.expr()`, etc.)
- **`nix.gc()` removed** — replaced by `nixos.nix({ gc: { ... } })` / `darwin.nix({ gc: { ... } })`
- **`nixos.firewall()` removed** — replaced by `nixos.networking({ firewall: { ... } })`
- **`darwin.defaults()`** — single flat helper, no sub-helpers (`.defaults.dock()`, etc.) because there's no implicit logic, just typed passthrough
- **`nixos.nix()` / `darwin.nix()`** — platform-specific, no sub-helpers (gc, settings all go as config keys). Different platforms have different gc scheduling (dates vs interval)
- **Nested pure config stays under its parent namespace** — e.g. `nixos.networking({ firewall })`, not `nixos.firewall()`
- **Keyed collections may get named helpers** — but under their owning namespace, e.g. `nixos.systemd.service()`, `nixos.virtualisation.ociContainer()`, `darwin.launchd.agent()`
- **Root-level shortcut helpers require explicit justification** — `nixos.sysctl()` is kept as a documented ergonomic exception for `boot.kernel.sysctl`
- **No cross-platform magic** — helpers are explicit per-platform. Users who want shared config put it in a feature with both calls.

### Notes

- **P1**: Essential for any real-world config. Most users need these immediately.
- **P2**: Common patterns that improve DX significantly over `nixos()` / `home()` / `darwin()` raw calls.
- **P3**: Nice-to-have helpers. Users can always use `nixos({ ... })` for these.
- Most proposed helpers are **additive** — the exceptions are listed in [Current API Migrations](#current-api-migrations). All helpers produce fragments, and the `nixos()` / `home()` / `darwin()` callable remains the escape hatch for anything without a dedicated helper.
- Naming follows existing conventions: `namespace.verb()` or `namespace.noun()`.
