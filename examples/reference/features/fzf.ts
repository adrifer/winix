import { feature, program } from "winix";

/**
 * @description Fuzzy finder with shell integration
 * @category shell
 */
export const fzf = feature("fzf", () =>
  program("fzf", { enable: true })
);
