import { type Fragment } from "winix";

/**
 * @description Fuzzy finder (fzf) with shell integration
 * @example fzf()
 * @category tool
 */
export function fzf(): Fragment {
  return {
    home: {
      programs: {
        fzf: { enable: true },
      },
    },
  };
}
