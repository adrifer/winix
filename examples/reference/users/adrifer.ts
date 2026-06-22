import { account } from "winix";

/**
 * @description User account configuration
 * @category user
 */
export const adrifer = account.user("adrifer", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));
