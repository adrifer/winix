/**
 * Example: escape hatches in practice.
 * Shows all three levels in a standalone config.
 */
import {
  account,
  defineInputs,
  feature,
  host,
  input,
  nix,
  nixos,
  platforms,
  rawModule,
  workspace,
} from "@adrifer/winix";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});

/**
 * Level 3 example: nix.expr() inside a typed fragment.
 * Most of the fragment is typed, but one value needs raw Nix.
 *
 * The Nix output for win_user needs a literal `''${...}` so the SHELL
 * (not Nix) expands the parameter expansion at runtime. In a TS template
 * that's `''` followed by `${...}`, with the second `${` escaped from
 * TS as `\${`.
 */
const vsCodePath = feature("vscode-path", () => ({
  nixos: {
    environment: {
      interactiveShellInit: nix.expr(`
        win_home="$(wslpath -w "$HOME")"
        win_user="''\${win_home##*/}"
        export PATH="$PATH:/mnt/c/Users/$win_user/AppData/Local/Programs/Microsoft VS Code Insiders/bin"
      `),
    },
  },
}));

export default workspace({
  inputs,

  hosts: [
    host("wsl", platforms.nixos(), [
      account.user("tony", () => ({ admin: true, stateVersion: "25.05" }))(),

      // Level 2: rawModule — legacy .nix file not yet migrated
      rawModule("./legacy/vscode-path.nix"),

      // Level 1: nixos.raw() — inline Nix for a quick one-off.
      // Nix `"..."` strings don't interpolate `${...}`, so this just emits
      // the literal Nix text (escape `${` from TS as `\${`).
      nixos.raw(`
        environment.variables.DOTNET_ROOT =
          "\${pkgs.dotnet-sdk_9}/share/dotnet";
      `),

      // Level 3: typed fragment with one nix.expr() value inside.
      vsCodePath(),
    ]),
  ],
});
