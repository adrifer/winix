import { feature } from "winix";

/**
 * @description Neovim editor with EDITOR env var
 * @example neovim()
 * @category tool
 */
export const neovim = feature("neovim", () => ({
  home: {
    packages: ["neovim"],
    sessionVariables: {
      EDITOR: "nvim",
    },
  },
}));
