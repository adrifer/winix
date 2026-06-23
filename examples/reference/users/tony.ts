import { account } from "@adrifer/winix";

/**
 * @description User account configuration
 * @category user
 */
export const tony = account.user("tony", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));
