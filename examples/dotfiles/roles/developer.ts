import { feature, type Fragment } from "winix";
import { packages } from "winix/fragments";
import { git } from "../tools/git";
import { neovim } from "../tools/neovim";
import { zsh } from "../shell/zsh";
import { starship } from "../shell/starship";
import { fzf } from "../shell/fzf";
import { zoxide } from "../shell/zoxide";

/**
 * @description Developer role: composes shell, tools, and common packages
 * @category role
 */
export const developer = feature("developer", (): Fragment[] => [
  git(),
  neovim(),
  zsh(),
  starship(),
  fzf(),
  zoxide(),
  packages([
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
  ]),
]);
