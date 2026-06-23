/**
 * Example: escape hatches in practice.
 * Shows all three levels in a standalone config.
 */
import { workspace, host, rawModule, nix } from "@adrifer/winix";
import { defineInputs, input } from "@adrifer/winix";
import { account, feature, nixos, platforms, type Fragment } from "@adrifer/winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

export default workspace({
  inputs,

  hosts: [
    host("wsl-work", platforms.nixos(), [
      account.user("adrifer", () => ({ admin: true, stateVersion: "25.05" }))(),

      // Level 2: rawModule — legacy .nix file not yet migrated
      rawModule("./legacy/vscode-path.nix"),

      // Level 1: raw — inline Nix for a quick one-off
      nixos.raw(`
        environment.variables.DOTNET_ROOT =
          "''${pkgs.dotnet-sdk_9}/share/dotnet";
      `),

      // Level 3: nix.expr() inside a typed fragment
      vsCodePath(),
    ]),
  ],
});

/**
 * Level 3 example: nix.expr() inside a typed fragment.
 * Most of the fragment is typed, but one value needs raw Nix.
 */
const vsCodePath = feature("vscode-path", () => ({
  nixos: {
    environment: {
      interactiveShellInit: nix.expr(`
        win_home="$(wslpath -w "$HOME")"
        win_user="''${win_home##*/}"
        export PATH="$PATH:/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
      `),
    },
  },
}));
