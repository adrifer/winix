import { feature, program } from "winix";

/**
 * @description Starship cross-shell prompt
 * @category shell
 */
export const starship = feature("starship", () =>
  program("starship", { enable: true })
);
