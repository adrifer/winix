import { profile } from "@adrifer/winix";
import { dotfiles } from "../features/dotfiles";
import { fzf } from "../features/fzf";
import { git } from "../features/git";
import { javascript } from "../features/javascript";
import { neovim } from "../features/neovim";
import { packages } from "../features/packages";
import { starship } from "../features/starship";
import { zoxide } from "../features/zoxide";
import { zsh } from "../features/zsh";

/**
 * Shared Home Manager baseline: the user-space stuff that's identical
 * across every host (Linux, macOS, WSL).
 */
export const homeBase = profile("home-base", [
  packages(),
  javascript(),
  neovim(),
  dotfiles(),
  zsh(),
  starship(),
  fzf(),
  zoxide(),
  git(),
]);
