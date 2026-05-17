import { type Fragment } from "winix";

/**
 * @description Neovim editor with EDITOR env var
 * @example neovim()
 * @category tool
 */
export function neovim(): Fragment {
  return {
    home: {
      packages: ["neovim"],
      sessionVariables: {
        EDITOR: "nvim",
      },
    },
  };
}
