import { platform } from "winix";

/**
 * @description NixOS base platform (x86_64-linux)
 * @example nixos({ stateVersion: "25.05" })
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

/**
 * @description macOS/nix-darwin base platform (aarch64-darwin)
 * @example darwin({ stateVersion: 6 })
 * @category platform
 */
export const darwin = platform("darwin", (opts?: { stateVersion?: number }) => ({
  darwin: {
    nixpkgs: {
      hostPlatform: "aarch64-darwin",
      config: { allowUnfree: true },
    },
    nix: {
      settings: { experimentalFeatures: ["nix-command", "flakes"] },
    },
    system: { stateVersion: opts?.stateVersion },
  },
}));
