import { defineInputs, input } from "winix";

export const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  nixpkgsStable: "github:NixOS/nixpkgs/nixos-25.11",
  flakeParts: input("github:hercules-ci/flake-parts", {
    follows: { "nixpkgs-lib": "nixpkgs" },
  }),
  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixDarwin: input("github:nix-darwin/nix-darwin", {
    follows: { nixpkgs: "nixpkgs" },
  }),
  nixHomebrew: "github:zhaofengli/nix-homebrew",
});
