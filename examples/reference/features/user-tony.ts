import { account } from "@adrifer/winix";

/**
 * Primary user account. Context-aware: adjusts home directory,
 * system user config, and WSL default user based on the active
 * platform (NixOS vs nix-darwin).
 */
export const tony = account.user("tony", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));
