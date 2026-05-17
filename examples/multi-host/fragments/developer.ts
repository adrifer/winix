import { type Fragment } from "winix";
import { git } from "./git";
import { zsh } from "./zsh";
import { neovim } from "./neovim";
import { starship } from "./starship";
import { fzf } from "./fzf";
import { zoxide } from "./zoxide";

/**
 * @description Developer role: shell, editor, git, and common CLI tools
 * @example developer()
 * @category role
 */
export function developer(): Fragment[] {
  return [
    git(),
    zsh(),
    neovim(),
    starship(),
    fzf(),
    zoxide(),
    commonPackages(),
  ];
}

function commonPackages(): Fragment {
  return {
    home: {
      packages: [
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
      ],
    },
  };
}
