import { feature, home } from "@adrifer/winix";

/**
 * @description fzf fuzzy finder with zsh shell integration
 * @category shell
 */
export const fzf = feature("fzf", () =>
  home.program("fzf", { enableZshIntegration: true })
);
