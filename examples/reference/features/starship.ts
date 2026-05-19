import { feature, home } from "winix";

/**
 * @description Starship cross-shell prompt
 * @category shell
 */
export const starship = feature("starship", () =>
  home.program("starship")
);
