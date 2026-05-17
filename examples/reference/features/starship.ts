import { feature } from "winix";

/**
 * @description Starship cross-shell prompt
 * @category shell
 */
export const starship = feature("starship", () => ({
  home: {
    programs: { starship: { enable: true } },
  },
}));
