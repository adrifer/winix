import { defineInputs, input } from "@adrifer/winix";

/**
 * Flake inputs for the reference configuration.
 *
 * Mirrors a real production setup with both unstable and stable nixpkgs
 * (stable is used via overlay for packages that break too often on
 * unstable, like Slack or 1Password), nix-darwin for macOS, and
 * NixOS-WSL for the WSL host.
 */
export const inputs = defineInputs({
  nixpkgs: "nixos-unstable",

  nixpkgsStable: input("github:NixOS/nixpkgs/nixos-25.11", {
    nixName: "nixpkgs-stable",
  }),

  homeManager: input("github:nix-community/home-manager", {
    follows: { nixpkgs: "nixpkgs" },
  }),

  homeManagerStable: input("github:nix-community/home-manager/release-25.11", {
    nixName: "home-manager-stable",
    follows: { nixpkgs: "nixpkgs-stable" },
  }),

  nixDarwin: input("github:nix-darwin/nix-darwin", {
    nixName: "nix-darwin",
    follows: { nixpkgs: "nixpkgs" },
  }),

  nixHomebrew: input("github:zhaofengli/nix-homebrew", {
    nixName: "nix-homebrew",
  }),

  nixosWsl: input("github:nix-community/NixOS-WSL", {
    follows: { nixpkgs: "nixpkgs" },
  }),
});
