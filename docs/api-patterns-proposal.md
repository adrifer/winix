# Winix API Patterns Proposal

This document catalogs common NixOS, Home Manager, and nix-darwin configuration patterns found in real-world dotfiles, proposes Winix TypeScript APIs for each, and shows how the examples would translate.

---

## Table of Contents

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
14. [Locale & Timezone](#14-locale--timezone)
15. [Launchd (darwin)](#15-launchd-darwin)

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

darwin.keyboard(config: {
  enableKeyMapping?: boolean;
  remapCapsLockToControl?: boolean;
  remapCapsLockToEscape?: boolean;
  [key: string]: unknown;
}): Fragment
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
    showRecents: false,
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

darwin.keyboard({
  enableKeyMapping: true,
  remapCapsLockToControl: true,
});
```

---

## 2. Nix Daemon Settings

Configuring the Nix daemon itself: experimental features, substituters, trusted users, garbage collection, registry.

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

```ts
nix.daemon(config: {
  enable?: boolean;
  package?: PackageRef;
  settings?: {
    experimentalFeatures?: string[];
    trustedUsers?: string[];
    substituters?: string[];
    trustedPublicKeys?: string[];
    autoOptimiseStore?: boolean;
    buildersUseSubstitutes?: boolean;
    keepDerivations?: boolean;
    keepOutputs?: boolean;
    [key: string]: unknown;
  };
  gc?: { automatic?: boolean; interval?: string; options?: string };
  distributedBuilds?: boolean;
  buildMachines?: Array<{
    hostName: string;
    sshUser?: string;
    system: string;
    maxJobs?: number;
    supportedFeatures?: string[];
  }>;
  extraOptions?: string;
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nix.daemon({
  settings: {
    autoOptimiseStore: true,
    buildersUseSubstitutes: true,
    experimentalFeatures: ["nix-command", "flakes"],
    trustedUsers: ["root", "@wheel"],
    substituters: ["https://nix-community.cachix.org", "https://cache.nixos.org"],
    trustedPublicKeys: ["cache.nixos.org-1:6NCHdD59X431o0gWypbMrAURkbJ16ZPMQFGspcDShjY="],
  },
  gc: { automatic: true, interval: "weekly", options: "--delete-older-than 7d" },
});

nix.daemon({
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

Note: `nixos.sysctl()` already exists for kernel.sysctl settings.

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

User accounts with shell, groups, SSH keys, and home directories.

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

Currently `account()` handles basic user setup. This proposes extending it or adding a `nixos.user()` / `darwin.user()` helper:

```ts
nixos.user(name: string, config: {
  isNormalUser?: boolean;
  shell?: PackageRef;
  extraGroups?: string[];
  home?: string;
  description?: string;
  openssh?: {
    authorizedKeys?: {
      keys?: string[];
      keyFiles?: string[];
    };
  };
  [key: string]: unknown;
}): Fragment

darwin.user(name: string, config: {
  home?: string;
  shell?: PackageRef;
  description?: string;
  openssh?: {
    authorizedKeys?: {
      keys?: string[];
      keyFiles?: string[];
    };
  };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.user("mihai", {
  isNormalUser: true,
  shell: nix.pkg("zsh"),
  extraGroups: ["input", "libvirtd", "networkmanager", "plugdev", "video", "wheel"],
});

darwin.user("robert", {
  description: "Robert",
  home: "/Users/robert",
  openssh: {
    authorizedKeys: {
      keys: ["ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFkVAe4..."],
    },
  },
});
```

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

```ts
home.files(files: Record<string, string | { source: string } | { text: string }>): Fragment

// Shorthand for XDG config files (already exists as home.configFile/configFiles)
home.configFile(name: string, opts: { source?: string; text?: string; recursive?: boolean }): Fragment
home.configFiles(files: Record<string, { source?: string; text?: string }>): Fragment

// New: general home.file for arbitrary paths
home.file(path: string, opts: { source?: string; text?: string }): Fragment
home.homeFiles(files: Record<string, string | { source: string } | { text: string }>): Fragment
```

### Winix Translation

```ts
home.homeFiles({
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
nixos.container(name: string, config: {
  image: string;
  autoStart?: boolean;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  extraOptions?: string[];
  [key: string]: unknown;
}): Fragment

nixos.virtualisation(config: {
  podman?: { enable?: boolean; [key: string]: unknown };
  docker?: { enable?: boolean; [key: string]: unknown };
  ociContainers?: { backend?: "podman" | "docker" };
  libvirtd?: { enable?: boolean };
  [key: string]: unknown;
}): Fragment
```

### Winix Translation

```ts
nixos.virtualisation({
  podman: { enable: true },
  ociContainers: { backend: "podman" },
});

nixos.container("vrising", {
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

Hostname, DHCP, firewall, DNS. Note: `nixos.firewall()` already exists.

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

Extend the existing `nixos.firewall()` and add a general networking helper:

```ts
nixos.networking(config: {
  hostName?: string;
  hostId?: string;
  useDHCP?: boolean;
  interfaces?: Record<string, { useDHCP?: boolean; ipv4?: unknown }>;
  nameservers?: string[];
  firewall?: FirewallOptions;  // same as nixos.firewall()
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
});

// Or keep using the dedicated helper for firewall:
nixos.firewall({
  enable: true,
  allowedTCPPorts: [22, 80, 443],
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

## 14. Locale & Timezone

Internationalisation settings and timezone.

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
nixos.locale(config: {
  defaultLocale?: string;
  supportedLocales?: string[];
  timeZone?: string;
}): Fragment
```

### Winix Translation

```ts
nixos.locale({
  defaultLocale: "en_US.UTF-8",
  supportedLocales: ["en_US.UTF-8/UTF-8", "ja_JP.UTF-8/UTF-8"],
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
darwin.launchAgent(name: string, config: {
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
}): Fragment

darwin.launchDaemon(name: string, config: { ... }): Fragment  // system-level
```

### Winix Translation

```ts
darwin.launchAgent("emacs", {
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
| System Defaults (darwin) | ⭐⭐⭐⭐⭐ | ❌ Missing | Low | **P1** |
| Nix Daemon Settings | ⭐⭐⭐⭐⭐ | Partial (nix.gc exists) | Medium | **P1** |
| Boot Configuration | ⭐⭐⭐⭐ | Partial (sysctl exists) | Low | **P1** |
| Users & Groups | ⭐⭐⭐⭐ | Partial (account exists) | Medium | **P2** |
| Fonts | ⭐⭐⭐⭐ | ❌ Missing | Low | **P2** |
| Home Files & XDG | ⭐⭐⭐⭐ | Partial (configFile exists) | Low | **P2** |
| Containers & Virtualisation | ⭐⭐⭐ | ❌ Missing | Medium | **P2** |
| Systemd Services & Timers | ⭐⭐⭐⭐ | Partial (systemd exists) | Medium | **P2** |
| Security & PAM | ⭐⭐⭐ | ❌ Missing | Low | **P2** |
| Networking | ⭐⭐⭐⭐ | Partial (firewall exists) | Low | **P3** |
| Environment & etc | ⭐⭐⭐⭐ | Partial (packages exists) | Low | **P3** |
| Homebrew (darwin) | ⭐⭐⭐⭐ | ❌ Missing | Low | **P1** |
| Locale & Timezone | ⭐⭐⭐ | ❌ Missing | Low | **P3** |
| Launchd (darwin) | ⭐⭐ | ❌ Missing | Low | **P3** |
| Session Variables & Path | ⭐⭐⭐⭐ | ✅ Done | — | — |

### Notes

- **P1**: Essential for any real-world config. Most users need these immediately.
- **P2**: Common patterns that improve DX significantly over `nixos()` / `home()` / `darwin()` raw calls.
- **P3**: Nice-to-have helpers. Users can always use `nixos({ ... })` for these.
- All proposed helpers are **additive** — they produce fragments just like existing helpers. The `nixos()` / `home()` / `darwin()` callable remains the escape hatch for anything without a dedicated helper.
- Naming follows existing conventions: `namespace.verb()` or `namespace.noun()`.
