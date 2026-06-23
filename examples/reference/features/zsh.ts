import { feature, home, platforms } from "@adrifer/winix";

/**
 * @description Zsh with vi-mode, autosuggestions, syntax highlighting, and platform aliases
 * @category shell
 */
export const zsh = feature("zsh", () =>
  home.program("zsh", {
    enableCompletion: true,
    autosuggestion: { enable: true },
    syntaxHighlighting: { enable: true },
    plugins: [{ name: "zsh-vi-mode" }],
    shellAliases: {
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
        i: "cd ~/config/winix && npx @adrifer/winix switch --host workstation",
        u: "cd ~/config/winix && npx @adrifer/winix update && npx @adrifer/winix switch --host workstation",
        gc: "nix-collect-garbage -d",
      }),
    },
  })
);
