import { feature, home } from "@adrifer/winix";

/**
 * @description Starship cross-shell prompt
 * @category shell
 */
export const starship = feature("starship", () =>
  home.program("starship")
);
