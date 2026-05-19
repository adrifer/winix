import { feature, platforms, zsh as zshConfig } from "winix";

/**
 * @description Zsh with vi-mode, autosuggestions, syntax highlighting, and platform aliases
 * @category shell
 */
export const zsh = feature("zsh", () =>
  zshConfig({
    plugins: ["zsh-vi-mode"],
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
      ...(platforms.nixos.isActive && {
        i: "sudo nixos-rebuild switch --flake /etc/nixos",
        u: "nix flake update --flake /etc/nixos && sudo nixos-rebuild switch --flake /etc/nixos",
        gc: "sudo nix-collect-garbage -d",
      }),
      ...(platforms.darwin.isActive && {
        i: "sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
        u: "nix flake update --flake ~/dotfiles/nixos && sudo darwin-rebuild switch --flake ~/dotfiles/nixos#macbook-pro",
        gc: "nix-collect-garbage -d",
      }),
    },
  })
);
