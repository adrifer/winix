import { feature, program } from "winix";

/**
 * @description Zoxide (smart cd) with shell integration
 * @category shell
 */
export const zoxide = feature("zoxide", () =>
  program("zoxide", { enable: true })
);
