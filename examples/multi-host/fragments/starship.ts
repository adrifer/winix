import { feature } from "winix";

/**
 * @description Starship cross-shell prompt
 * @example starship()
 * @category shell
 */
export const starship = feature("starship", () => ({
  home: {
    programs: {
      starship: { enable: true },
    },
  },
}));
