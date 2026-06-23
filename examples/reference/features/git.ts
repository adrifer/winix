import { feature, home } from "@adrifer/winix";
import { wsl } from "../features/wsl";

/**
 * @description Git with difftool, user info, conditional project email, and WSL credential helper
 * @category tool
 */
export const git = feature("git", () =>
  home.program("git", {
    userName: "Tony Stack",
    userEmail: "tony@stack.example",
    extraConfig: {
      diff: { tool: "nvimdiff" },
      difftool: { prompt: false },
      credential: {
        "https://github.com": { useHttpPath: true },
        helper: wsl.isActive
          ? "git-credential-manager-windows"
          : undefined,
      },
    },
    includes: [
      {
        condition: "gitdir:~/projects/lab/",
        contents: {
          user: {
            name: "Tony Stack",
            email: "tony@lab.example",
          },
        },
      },
    ],
  })
);
