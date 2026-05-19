import { feature } from "winix";

/**
 * @description Homebrew package manager for macOS via nix-homebrew
 * @category platform
 */
export const homebrew = feature("homebrew", () => ({
  darwin: {
    "nix-homebrew": {
      user: "adrifer",
    },
    homebrew: { enable: true },
  },
}));
