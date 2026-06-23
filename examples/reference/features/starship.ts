import { feature, home } from "@adrifer/winix";

/**
 * @description Starship prompt: minimal left side, full status on the right
 * @category shell
 */
export const starship = feature("starship", () =>
  home.program("starship", {
    enableZshIntegration: true,
    settings: {
      add_newline: false,
      format: "$directory$character",
      right_format: "$all",
      character: {
        vicmd_symbol: "[N](bold green)",
      },
      git_branch: {
        format: "[$symbol$branch(:$remote_branch)](fg:4) ",
      },
      docker_context: {
        disabled: true,
      },
      bun: {
        disabled: true,
      },
      nodejs: {
        detect_files: [
          "package.json",
          ".node-version",
          "!bunfig.toml",
          "!bun.lockb",
        ],
      },
    },
  })
);
