import { account, home, nix, nixos, darwin, type Fragment } from "winix";

// --- NixOS program helper with typed opts ---
// When NixosProgramOptions is populated (by generated types), these should autocomplete

// Basic enable-only usage (always works)
nixos.program("zsh");
nixos.program("openssh");

// With options (typed when generated types are available)
nixos.program("zsh", { enableCompletion: true });
nixos.imports("nixos-wsl");
nixos.nix({ gc: { automatic: true, dates: "weekly" } });
nixos.nix({ settings: { substituters: nix.lib.mkForce(["https://cache.nixos.org/"]) } });
nixos.boot({ kernelModules: ["tcp_bbr"], supportedFilesystems: ["btrfs"] });
nixos.networking({ hostName: "demo", firewall: { allowedTCPPorts: [80, 443] } });
nixos.environment({ systemPackages: ["vim"], pathsToLink: ["/share/fish"] });
nixos.users({ users: { root: { shell: nix.pkg("bash") } } });
nixos.system({ stateVersion: "25.05", activationScripts: { demo: nix.script("echo demo") } });
nixos.i18n({ defaultLocale: "en_US.UTF-8", supportedLocales: ["en_US.UTF-8/UTF-8"] });
nixos.time({ timeZone: "America/Los_Angeles" });
nixos.fonts({ packages: ["noto-fonts"], fontconfig: { defaultFonts: { monospace: ["JetBrains Mono"] } } });
nixos.security({ rtkit: { enable: true }, sudo: { wheelNeedsPassword: false } });
nixos.virtualisation({ podman: { enable: true }, ociContainers: { backend: "podman" } });
nixos.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" });
nixos.systemd.service("demo", { serviceConfig: { Type: "oneshot" }, script: "echo demo" });
nixos.systemd.timer("demo", { wantedBy: ["timers.target"] });
nixos.systemd.userService("demo", { description: "User Demo" });
nixos.systemd.tmpfiles(["d /srv/demo 0755 root root -"]);

// Fallback: unknown program name still works with Record<string, unknown>
nixos.program("my-custom-program", { someSetting: true });

// --- NixOS service helper with typed opts ---
nixos.service("openssh", { allowSFTP: true });
nixos.service("my-custom-service", { enable: true });

// --- home.program with typed opts ---
home.program("git", { userName: "test" });
home.program("zsh", { enableCompletion: true });
home.program("custom-thing", { whatever: true });
home.imports("inputs.hunk.homeManagerModules.default");
home.files({ ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv") });
home.configFile("nvim/init.lua", { text: "vim.o.number = true", force: true });

// --- darwin.program (no generated types yet, fallback only) ---
darwin.program("zsh", { enableSyntaxHighlighting: true });
darwin.imports("inputs.nix-homebrew.darwinModules.nix-homebrew");
darwin.nix({ gc: { automatic: true, interval: { Weekday: 0, Hour: 3, Minute: 0 } } });
darwin.nix({ settings: { substituters: nix.lib.mkForce(["https://cache.nixos.org/"]) } });
darwin.security({ pam: { services: { sudo_local: { touchIdAuth: true } } } });
darwin.homebrew({ enable: true, casks: ["visual-studio-code"], masApps: { "hidden-bar": 1452453066 } });
darwin.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"], KeepAlive: true } });
darwin.launchd.daemon("cleanup", { serviceConfig: { ProgramArguments: ["cleanup"], RunAtLoad: true } });
darwin.defaults({ dock: { autohide: true, "show-recents": false } });

// --- account namespace ---
const user = account.user("adrifer", () => ({ admin: true, shell: "zsh" }));
const group = account.group("media", () => ({ members: [user, "jellyfin"] }));

// --- Verify Fragment output is correct ---
const f1: Fragment = nixos.program("zsh", { enableCompletion: true });
const f2: Fragment = nixos.service("openssh");
const f3: Fragment = home.program("git", { userName: "Me" });
const f4: Fragment = darwin.defaults({ finder: { ShowPathbar: true } });
const f5: Fragment = user();
const f6: Fragment = group();

void f1;
void f2;
void f3;
void f4;
void f5;
void f6;
