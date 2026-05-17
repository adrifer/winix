import { type Fragment } from "winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @example zoxide()
 * @category tool
 */
export function zoxide(): Fragment {
  return {
    home: {
      programs: {
        zoxide: { enable: true },
      },
    },
  };
}
