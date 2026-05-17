import { feature } from "winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @example zoxide()
 * @category tool
 */
export const zoxide = feature("zoxide", () => ({
  home: {
    programs: {
      zoxide: { enable: true },
    },
  },
}));
