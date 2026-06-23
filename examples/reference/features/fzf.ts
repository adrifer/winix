import { feature, home } from "@adrifer/winix";

/**
 * @description Fuzzy finder with shell integration
 * @category shell
 */
export const fzf = feature("fzf", () =>
  home.program("fzf")
);
