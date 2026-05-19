import { account, profile } from "winix";

/**
 * @description User account configuration
 * @category user
 */
export const adrifer = profile("adrifer", [
  account("adrifer", { admin: true, shell: "zsh", stateVersion: "25.05", wslDefault: true }),
]);
