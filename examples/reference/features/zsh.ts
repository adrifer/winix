import { feature, home, nix, platforms } from "@adrifer/winix";
import { wsl } from "./wsl";

/**
 * @description zsh with vi-mode, completions, syntax highlighting, and per-platform aliases
 * @category shell
 */
export const zsh = feature("zsh", () => {
  // Cross-platform shell helpers: `y` jumps to yazi's exit cwd, `zd`
  // is a smart cd that falls back to zoxide when the path doesn't exist.
  const baseInit = nix.script(`
    export ZVM_VI_INSERT_ESCAPE_BINDKEY=jj

    y() {
      local tmp cwd
      tmp="$(mktemp -t yazi-cwd.XXXXXX)"
      yazi "$@" --cwd-file="$tmp"
      if cwd="$(command cat -- "$tmp")" && [[ -n "$cwd" && "$cwd" != "$PWD" ]]; then
        builtin cd -- "$cwd"
      fi
      rm -f -- "$tmp"
    }

    zd() {
      if [ $# -eq 0 ]; then
        builtin cd ~ && return
      elif [ -d "$1" ]; then
        builtin cd "$1"
      else
        z "$@" && pwd || echo "Error: Directory not found"
      fi
    }
  `);

  const initParts = [baseInit];

  // Inside WSL, point $BROWSER at wslview (so xdg-open works) and
  // notify Windows Terminal of the current working directory via the
  // OSC 9;9 escape sequence on every prompt.
  if (wsl.isActive) {
    initParts.push(
      nix.script(`
        export BROWSER=wslview

        keep_current_path() {
          printf "\\e]9;9;%s\\e\\\\" "$(wslpath -w "$PWD")"
        }
        precmd_functions+=(keep_current_path)
      `)
    );
  }

  return home.program("zsh", {
    autosuggestion: { enable: true },
    enableCompletion: true,
    syntaxHighlighting: { enable: true },
    plugins: [
      {
        name: "zsh-vi-mode",
        src: nix.pkg("zsh-vi-mode"),
        file: "share/zsh-vi-mode/zsh-vi-mode.plugin.zsh",
      },
    ],
    shellAliases: {
      ls: "eza -lh --group-directories-first --icons=auto",
      lsa: "ls -a",
      lt: "eza --tree --level=2 --long --icons --git",
      lt3: "lt --level=3",
      lta: "lt -a",
      grep: "grep --color=auto",
      g: "lazygit",
      lg: "lazygit",
      cd: "zd",
      n: "nvim",
      ta: "tmux attach-session",
      "..": "cd ..",
      "...": "cd ../..",
      ...(platforms.darwin.isActive && {
        // Build + activate the macOS system flake produced by winix.
        i: "cd ~/dotfiles/winix && npx winix apply && sudo darwin-rebuild switch --flake path:$PWD/.winix/out#macbook-pro",
        u: "cd ~/dotfiles/winix/.winix/out && nix flake update && sudo darwin-rebuild switch --flake path:$PWD#macbook-pro",
        gc: "nix-collect-garbage -d",
      }),
      ...(platforms.nixos.isActive && {
        i: "cd ~/dotfiles/winix && npx winix apply && sudo nixos-rebuild switch --flake path:$PWD/.winix/out",
        u: "cd ~/dotfiles/winix/.winix/out && nix flake update && sudo nixos-rebuild switch --flake path:$PWD",
        gc: "sudo nix-collect-garbage -d",
      }),
    },
    initContent: initParts.length === 1 ? initParts[0] : nix.concat(...initParts),
  });
});
