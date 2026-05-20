import { darwin, home, nixos, type Fragment, type ZshOptions } from "winix";
import type { GitOptions } from "winix/types";

home.program("zsh", {
  enable: true,
  shellAliases: { g: "lazygit" },
});

nixos.raw({
  networking: { hostName: "wsl" },
  wsl: { enable: true },
  futureOption: { stillAllowed: true },
});

home.raw({
  programs: { zsh: { enable: true } },
  futureOption: { stillAllowed: true },
});

darwin.raw({
  networking: { hostName: "macbook-pro" },
  futureOption: { stillAllowed: true },
});

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
nixos.raw({ networking: { hostName: 123 } });
