import { feature, type Fragment } from "winix";

/**
 * @description Fuzzy finder (fzf) with shell integration
 * @example fzf()
 * @category tool
 */
export const fzf = feature("fzf", () => ({
  home: {
    programs: {
      fzf: { enable: true },
    },
  },
}));
