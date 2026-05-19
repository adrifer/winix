import { feature, programs } from "winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @category shell
 */
export const zoxide = feature("zoxide", () =>
  programs.enable("zoxide")
);
