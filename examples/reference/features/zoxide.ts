import { feature, home } from "@adrifer/winix";

/**
 * @description zoxide smarter cd with zsh shell integration
 * @category shell
 */
export const zoxide = feature("zoxide", () =>
  home.program("zoxide", { enableZshIntegration: true })
);
