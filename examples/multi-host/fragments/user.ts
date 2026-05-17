import { type Fragment } from "winix";

/**
 * @description Create a user with home-manager integration
 * @example user("adrifer")
 * @category user
 */
export function user(name: string): Fragment {
  return {
    nixos: {
      users: { users: { [name]: { isNormalUser: true } } },
    },
    home: {
      username: name,
    },
  };
}
