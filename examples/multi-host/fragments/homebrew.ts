import { type Fragment } from "winix";
import { inputs } from "../inputs";

/**
 * @description Homebrew package manager for macOS via nix-homebrew
 * @example homebrew()
 * @category platform
 */
export function homebrew(): Fragment {
  return {
    darwin: {
      imports: [inputs.nixHomebrew],
      homebrew: {
        enable: true,
      },
    },
  };
}
