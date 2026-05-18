import { feature, user } from "winix";

/**
 * @description User account configuration
 * @category user
 */
export const adrifer = feature("adrifer", () => [
  user("adrifer"),
  {
    nixos: {
      users: { users: { adrifer: { isNormalUser: true } } },
    },
  },
]);
