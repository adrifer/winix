import { account, darwin, home, nix, nixos, type Fragment, type ZshOptions } from "@adrifer/winix";
import type { GitOptions } from "@adrifer/winix/types";

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
nixos.imports("nixos-wsl");
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
