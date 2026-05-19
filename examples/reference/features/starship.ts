import { feature, programs } from "winix";

/**
 * @description Starship cross-shell prompt
 * @category shell
 */
export const starship = feature("starship", () =>
  programs.enable("starship")
);
