import { account } from "@adrifer/winix";

/** The user account on Linux and macOS hosts (and the WSL distro's default user). */
export const alice = account.user("alice", () => ({
  admin: true,
  shell: "zsh",
  stateVersion: "25.05",
  wslDefault: true,
}));
