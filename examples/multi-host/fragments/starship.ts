import { type Fragment } from "winix";

/**
 * @description Starship cross-shell prompt
 * @example starship()
 * @category shell
 */
export function starship(): Fragment {
  return {
    home: {
      programs: {
        starship: { enable: true },
      },
    },
  };
}
