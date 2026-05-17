import { type Fragment } from "winix";

/**
 * @description Zsh shell with vi-mode, autosuggestions, syntax highlighting, and aliases
 * @example zsh()
 * @category shell
 */
export function zsh(): Fragment {
  return {
    home: {
      programs: {
        zsh: {
          enable: true,
          autosuggestion: { enable: true },
          completion: { enable: true },
          syntaxHighlighting: { enable: true },
          plugins: [{ name: "zsh-vi-mode", package: "zsh-vi-mode" }],
          aliases: {
            ls: "eza -lh --group-directories-first --icons=auto",
            lsa: "ls -a",
            lt: "eza --tree --level=2 --long --icons --git",
            ff: "fzf --preview 'bat --style=numbers --color=always {}'",
            grep: "grep --color=auto",
            g: "lazygit",
            lg: "lazygit",
            cd: "zd",
            ci: "code-insiders",
            n: "nvim",
            "..": "cd ..",
            "...": "cd ../..",
          },
        },
      },
    },
  };
}
