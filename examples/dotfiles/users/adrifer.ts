import { feature } from "winix";

/**
 * @description User account configuration
 * @category user
 */
export const adrifer = feature("adrifer", () => ({
  nixos: {
    users: { users: { adrifer: { isNormalUser: true } } },
  },
  home: {
    username: "adrifer",
  },
}));
