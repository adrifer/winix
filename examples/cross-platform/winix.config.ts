/**
 * Cross-platform example, laid out like a real dotfiles repository:
 *
 *   machines/   one file per computer (a Windows PC and its WSL distro are one machine)
 *   roles/      what a kind of machine gets; roles span operating systems
 *   features/   one file per tool, with every OS it supports
 *
 *   winix inspect --matrix           every feature against every host
 *   winix inspect --host DESKTOP     what each feature contributes there
 *   winix apply --dry --host wsl-work
 */

import { defineInputs, input, workspace } from "@adrifer/winix";
import { desktop } from "./machines/desktop.ts";
import { macbook } from "./machines/macbook.ts";

const inputs = defineInputs({
  nixpkgs: "nixos-unstable",
  homeManager: input("github:nix-community/home-manager", { follows: { nixpkgs: "nixpkgs" } }),
  nixDarwin: input("github:nix-darwin/nix-darwin", { nixName: "nix-darwin", follows: { nixpkgs: "nixpkgs" } }),
  nixosWsl: input("github:nix-community/NixOS-WSL", { follows: { nixpkgs: "nixpkgs" } }),
});

export default workspace({ inputs, hosts: [...desktop, macbook] });
