import { account, darwin, home, nix, nixos, windows, feature, profile, host, platforms, type Fragment, type ResourceHandle, type ZshOptions } from "@adrifer/winix";
import type { GitOptions } from "@adrifer/winix/types";

const icons: ResourceHandle = windows.powershell.module("Terminal-Icons");
const wslFeatures: ResourceHandle = windows.wsl({
  config: { wsl2: { memory: "16GB", processors: 8, networkingMode: "mirrored" } }, backup: true,
});
windows.wsl();
windows.optionalFeature("VirtualMachinePlatform", { enabled: true });
windows.wsl.distro("NixOS", {
  source: "nixos-wsl", installLocation: windows.knownFolder.localAppData("WSL/NixOS"),
  default: true, dependsOn: wslFeatures,
  setup: {
    repository: "https://github.com/example/dotfiles.git", ref: "main",
    configDirectory: "winix", host: "wsl-work", user: "alice", checkout: "/home/alice/dotfiles",
  },
});
// @ts-expect-error First-run setup requires a Linux host selection.
windows.wsl.distro("NixOS", { source: "nixos-wsl", installLocation: "D:/WSL/NixOS", setup: { repository: "https://example.com/repo", configDirectory: "winix" } });
// @ts-expect-error WSL image versions belong in the Windows lockfile.
windows.wsl.distro("NixOS", { source: "nixos-wsl", installLocation: "D:/WSL/NixOS", version: "latest" });
// @ts-expect-error Only implemented distro image sources are supported.
windows.wsl.distro("Ubuntu", { source: "ubuntu", installLocation: "D:/WSL/Ubuntu" });
// @ts-expect-error WSL networking modes use the supported enum.
windows.wsl({ config: { wsl2: { networkingMode: "custom" } } });
// @ts-expect-error WSL setup is callable, not a separate enable method.
windows.wsl.enable();
// @ts-expect-error WSL config belongs in the setup options.
windows.wsl.config({ wsl2: { memory: "16GB" } });
windows.file.symlink(
  windows.knownFolder.documents("PowerShell\\profile.ps1"),
  "../windows/profile.ps1",
  { dependsOn: icons, backup: true },
);
windows.file.copy(windows.knownFolder.localAppData("Winix\\config"), new URL("./config", import.meta.url));
// @ts-expect-error Module versions belong in the Windows lockfile.
windows.powershell.module("Terminal-Icons", { version: "0.11.0" });
// @ts-expect-error Only supported known-folder names are accepted.
windows.knownFolder.unknown();
const startup: ResourceHandle = windows.startup.command("terminal", {
  executable: "pwsh.exe",
  arguments: ["-File", windows.knownFolder.userProfile("start.ps1")],
  windowStyle: "minimized",
  dependsOn: icons,
});
// @ts-expect-error Startup commands require an executable.
windows.startup.command("missing", { dependsOn: startup });
// @ts-expect-error Startup window styles use named values, not arbitrary numbers.
windows.startup.command("invalid", { executable: "app.exe", windowStyle: 7 });
// @ts-expect-error Startup arguments must be strings or known-folder paths.
windows.startup.command("invalid", { executable: "app.exe", arguments: [42] });

home.program("zsh", {
  enable: true,
  shellAliases: { g: "lazygit" },
});
home.files({ ".zshenv": home.symlink("~/dotfiles/zsh/.zshenv") });

const adrifer = account.user("adrifer", () => ({ admin: true, shell: "zsh" }));
account.group("media", () => ({ members: [adrifer, "jellyfin"] }));

nixos({
  networking: { hostName: "wsl" },
  wsl: { enable: true },
  futureOption: { stillAllowed: true },
});
nixos.imports("inputs.nixos-wsl.nixosModules.wsl");
nixos.nix({ settings: { experimentalFeatures: ["nix-command", "flakes"] } });
nixos.boot({ kernelModules: ["tcp_bbr"] });
nixos.networking({ hostName: "demo", firewall: { allowedTCPPorts: [80, 443] } });
nixos.environment({ systemPackages: ["vim"], pathsToLink: ["/share/fish"] });
nixos.users({ users: { root: { shell: nix.pkg("bash") } } });
nixos.system({ stateVersion: "25.05", activationScripts: { demo: nix.script("echo demo") } });
nixos.i18n({ defaultLocale: "en_US.UTF-8", supportedLocales: ["en_US.UTF-8/UTF-8"] });
nixos.time({ timeZone: "America/Los_Angeles" });
nixos.fonts({ packages: ["noto-fonts"] });
nixos.security({ rtkit: { enable: true } });
nixos.virtualisation.ociContainer("demo", { image: "docker.io/library/nginx" });
nixos.systemd.service("demo", { script: "echo demo" });

home({
  programs: { zsh: { enable: true } },
  futureOption: { stillAllowed: true },
});
home.imports("inputs.hunk.homeManagerModules.default");

darwin({
  networking: { hostName: "macbook-pro" },
  futureOption: { stillAllowed: true },
});
darwin.imports("inputs.nix-homebrew.darwinModules.nix-homebrew");
darwin.nix({ settings: { experimentalFeatures: ["nix-command", "flakes"] } });
darwin.nix({ settings: { substituters: nix.lib.mkForce(["https://cache.nixos.org/"]) } });
darwin.security({ pam: { services: { sudo_local: { touchIdAuth: true } } } });
darwin.homebrew({ enable: true, casks: ["visual-studio-code"], masApps: { "hidden-bar": 1452453066 } });
darwin.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"], KeepAlive: true } });
darwin.launchd.daemon("cleanup", { serviceConfig: { ProgramArguments: ["cleanup"], RunAtLoad: true } });
darwin.defaults({
  dock: { autohide: true, "show-recents": false },
  finder: { ShowPathbar: true },
});

nixos.raw("{ boot.loader.grub.enable = true; }");
home.raw("programs.git.enable = true;");
darwin.raw("homebrew.enable = true;");

const gitOptions: GitOptions = {
  enable: true,
  settings: {
    credential: {
      "https://dev.azure.com": { useHttpPath: true },
    },
  },
};

const fragment: Fragment = {
  nixos: {
    networking: {
      hostName: "wsl",
      firewall: { allowedTCPPorts: [8384] },
    },
    wsl: {
      enable: true,
      defaultUser: "adrifer",
    },
  },
  homeManager: {
    home: {
      username: "adrifer",
    },
    programs: {
      zsh: { enable: true },
      git: gitOptions,
    },
  },
  darwin: {
    networking: { hostName: "macbook-pro" },
    homebrew: {
      enable: true,
      casks: ["visual-studio-code@insiders"],
    },
    "nix-homebrew": {
      enable: true,
      user: "adrifer",
    },
  },
};

void fragment;

// @ts-expect-error known option has the wrong value type
const badZsh: ZshOptions = { enable: "yes" };

void badZsh;

// @ts-expect-error known NixOS option has the wrong value type
nixos({ networking: { hostName: 123 } });

// @ts-expect-error callable helpers accept typed option objects, not raw Nix strings
nixos("{ some nix code }");

// @ts-expect-error .raw() accepts raw Nix strings, not option objects
nixos.raw({ networking: { hostName: "wsl" } });

// --- Authoring callbacks may be effect-only (return void) ---
// Before the AuthoringResult fix these failed to type-check because the
// callback was inferred as `() => void`, which was not assignable to a
// `=> FragmentResult` parameter.

// feature: declare purely by effect, no return.
const devFeature = feature("dev", ({ home, windows }) => {
  home.program("git");
  windows.package("Git.Git");
  const editor = windows.env.set("EDITOR", "nvim");
  windows.path.add("%USERPROFILE%\\.local\\bin", { dependsOn: editor });
  windows.path.remove("%USERPROFILE%\\.old-bin", { scope: "machine" });
});
void devFeature;

// @ts-expect-error env is a namespace with intention-named methods, not a callable
windows.env({ name: "EDITOR", value: "nvim" });

// @ts-expect-error path is a namespace with intention-named methods, not a callable
windows.path({ value: "%USERPROFILE%\\.local\\bin" });

// @ts-expect-error scope must be user or machine
windows.env.set("EDITOR", "nvim", { scope: "process" });

// feature: returning a fragment still type-checks (back-compat).
const gitFeature = feature("git", ({ home }) => home.program("git"));
void gitFeature;

// feature: mixed effect + return.
const mixedFeature = feature("mixed", ({ home }) => {
  home.program("bat");
  return home.program("eza");
});
void mixedFeature;

// profile: only accepts an array of entries (features + bare fragments),
// never a callback. The array form is the only authoring form for profiles.
const devProfile = profile("dev", [
  gitFeature(),
  mixedFeature(),
]);
void devProfile;

// profile rejects a callback at the type level (profiles group features; they
// cannot declare by effect or take injected context).
// @ts-expect-error profile() does not accept an authoring callback
profile("dev-bad", ({ home }) => {
  home.program("ripgrep");
});

// host (callback body): effect-only inline declarations.
const wslHost = host("wsl", platforms.nixos({ stateVersion: "25.05" }), ({ nixos, home }) => {
  nixos.imports("inputs.nixos-wsl.nixosModules.wsl");
  home.packages("socat");
});
void wslHost;
