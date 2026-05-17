import { type Fragment } from "winix";
import { when, Platform } from "winix";

/**
 * @description Zsh shell with vi-mode, autosuggestions, syntax highlighting, and aliases
 * @example zsh()
 * @category shell
 */
export function zsh(): Fragment[] {
  return [
    // Shared config across all platforms
    {
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
    },

    // NixOS-specific aliases
    when(Platform.linux, {
      home: {
        programs: {
          zsh: {
            aliases: {
              i: "sudo nixos-rebuild switch --flake /etc/nixos",
              u: "nix flake update --flake /etc/nixos && sudo nixos-rebuild switch --flake /etc/nixos",
              gc: "sudo nix-collect-garbage -d",
            },
          },
        },
      },
    }),

    // macOS/darwin-specific aliases
    when(Platform.darwin, {
      home: {
        programs: {
          zsh: {
            aliases: {
              i: "sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
              u: "nix flake update --flake ~/dotfiles/nixos && sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
              gc: "nix-collect-garbage -d",
            },
          },
        },
      },
    }),
  ];
}
