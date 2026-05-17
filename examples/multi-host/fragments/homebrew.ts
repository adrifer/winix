import { type Fragment } from "winix";

/**
 * @description Homebrew package manager for macOS via nix-homebrew
 * @example homebrew()
 * @category platform
 */
export function homebrew(): Fragment {
  return {
    darwin: {
      imports: ["nix-homebrew"],
      homebrew: {
        enable: true,
      },
    },
  };
}
