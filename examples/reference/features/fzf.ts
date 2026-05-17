import { feature } from "winix";

/**
 * @description Fuzzy finder with shell integration
 * @category shell
 */
export const fzf = feature("fzf", () => ({
  home: {
    programs: { fzf: { enable: true } },
  },
}));
