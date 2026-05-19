import { packages, profile } from "winix";
import { git } from "../features/git";
import { neovim } from "../features/neovim";
import { zsh } from "../features/zsh";
import { starship } from "../features/starship";
import { fzf } from "../features/fzf";
import { zoxide } from "../features/zoxide";

/**
 * @description Developer role: composes shell, tools, and common packages
 * @category role
 */
export const developer = profile("developer", [
  git(),
  neovim(),
  zsh(),
  starship(),
  fzf(),
  zoxide(),
  packages(
    "wget",
    "curl",
    "eza",
    "bat",
    "tree",
    "fastfetch",
    "unzip",
    "yazi",
    "powershell",
    "ripgrep",
    "fd",
    "jq",
    "openssl",
    "lazygit",
    "gh",
    "icu",
    "mkcert",
    "nixfmt",
    "nixd",
    "azure-cli",
    "python3",
    "gnumake",
  ),
]);
