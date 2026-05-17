import { workspace, host, input } from "winix";
import { nixos, darwin } from "./fragments/platforms";
import { user } from "./fragments/user";
import { developer } from "./fragments/developer";
import { wsl } from "./fragments/wsl";
import { workSysctl } from "./fragments/work-sysctl";
import { homebrew } from "./fragments/homebrew";
import { packages } from "winix/fragments";

export default workspace({
  inputs: {
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
  },

  hosts: [
    host("wsl-work", [
      nixos({ stateVersion: "25.05" }),
      user("adrifer"),
      developer(),
      wsl({ defaultUser: "adrifer" }),
      workSysctl(),
      packages(["socat", "bubblewrap"]),
    ]),

    host("macbook-pro", [
      darwin({ stateVersion: 6 }),
      user("adrifer"),
      developer(),
      homebrew(),
    ]),
  ],
});
