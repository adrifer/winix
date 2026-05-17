import { feature } from "winix";
import { inputs } from "../inputs";

/**
 * @description Homebrew package manager for macOS via nix-homebrew
 * @example homebrew()
 * @category platform
 */
export const homebrew = feature("homebrew", () => ({
  darwin: {
    imports: [inputs.nixHomebrew],
    homebrew: {
      enable: true,
    },
  },
}));
