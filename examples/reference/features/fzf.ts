import { feature, programs } from "winix";

/**
 * @description Fuzzy finder with shell integration
 * @category shell
 */
export const fzf = feature("fzf", () =>
  programs.enable("fzf")
);
