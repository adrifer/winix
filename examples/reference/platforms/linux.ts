import { platform } from "@adrifer/winix";

/**
 * @description NixOS base platform (x86_64-linux)
 * @category platform
 */
export const nixos = platform("linux", (opts?: { stateVersion?: string }) => ({
  nixos: {
    nixpkgs: {
      hostPlatform: "x86_64-linux",
      config: { allowUnfree: true },
    },
    nix: {
      settings: { experimentalFeatures: ["nix-command", "flakes"] },
    },
    system: { stateVersion: opts?.stateVersion },
    homeManager: {
      useGlobalPkgs: true,
      useUserPackages: true,
    },
  },
}));
