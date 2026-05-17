import { type Fragment } from "winix";
import { nixos } from "./platforms";
import { darwin } from "./platforms";
import { wsl } from "./wsl";

/**
 * @description Zsh shell with vi-mode, autosuggestions, syntax highlighting, and platform-conditional aliases
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

            // Platform-conditional: native TS spreads + .isActive
            ...(nixos.isActive && {
              i: "sudo nixos-rebuild switch --flake /etc/nixos",
              u: "nix flake update --flake /etc/nixos && sudo nixos-rebuild switch --flake /etc/nixos",
              gc: "sudo nix-collect-garbage -d",
            }),
            ...(darwin.isActive && {
              i: "sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
              u: "nix flake update --flake ~/dotfiles/nixos && sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
              gc: "nix-collect-garbage -d",
            }),
          },
        },
      },
    },
  };
}

/**
 * @description Git credential helper, auto-selects Windows helper when WSL is active
 * @example gitCredential()
 * @category tool
 */
export function gitCredential(): Fragment {
  return {
    home: {
      programs: {
        git: {
          credentialHelper: wsl.isActive
            ? "git-credential-manager-windows"
            : "git-credential-manager",
        },
      },
    },
  };
}
