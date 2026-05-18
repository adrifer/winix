/**
 * Example: escape hatches in practice.
 * Shows all three levels in a standalone config.
 */
import { workspace, host, raw, rawModule, escape } from "winix";
import { defineInputs, input } from "winix";
import { platform, feature, type Fragment } from "winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

const nixos = platform("linux", () => ({
  nixos: {
    nixpkgs: { hostPlatform: "x86_64-linux" },
    nix: { settings: { experimentalFeatures: ["nix-command", "flakes"] } },
  },
}));

const user = feature("user", () => ({
  nixos: { users: { users: { adrifer: { isNormalUser: true } } } },
  home: { username: "adrifer" },
}));

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", nixos(), [
      user(),

      // Level 2: rawModule — legacy .nix file not yet migrated
      rawModule("./legacy/vscode-path.nix"),

      // Level 1: raw — inline Nix for a quick one-off
      raw.nixos(`
        environment.variables.DOTNET_ROOT =
          "''${pkgs.dotnet-sdk_9}/share/dotnet";
      `),

      // Level 3: escape() inside a typed fragment
      vsCodePath(),
    ]),
  ],
});

/**
 * Level 3 example: escape() inside a typed fragment.
 * Most of the fragment is typed, but one value needs raw Nix.
 */
const vsCodePath = feature("vscode-path", () => ({
  nixos: {
    environment: {
      interactiveShellInit: escape(`
        win_home="$(wslpath -w "$HOME")"
        win_user="''${win_home##*/}"
        export PATH="$PATH:/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
      `),
    },
  },
}));
