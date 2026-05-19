import { feature, home } from "winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @category shell
 */
export const zoxide = feature("zoxide", () =>
  home.program("zoxide")
);
