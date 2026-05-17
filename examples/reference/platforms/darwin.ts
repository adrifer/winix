import { platform } from "winix";

/**
 * @description macOS/nix-darwin base platform (aarch64-darwin)
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
