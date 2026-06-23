import { feature, home } from "@adrifer/winix";

/**
 * @description Neovim with EDITOR exported for shells/git
 * @category editor
 */
export const neovim = feature("neovim", () => [
  home.packages("neovim"),
  home.env({ EDITOR: "nvim" }),
]);
