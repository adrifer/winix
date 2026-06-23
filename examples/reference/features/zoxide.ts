import { feature, home } from "@adrifer/winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @category shell
 */
export const zoxide = feature("zoxide", () =>
  home.program("zoxide")
);
