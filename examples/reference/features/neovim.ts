import { feature, home } from "winix";

/**
 * @description Neovim editor with EDITOR env var
 * @category tool
 */
export const neovim = feature("neovim", () => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);
