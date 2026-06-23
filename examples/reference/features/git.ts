import { feature, home } from "@adrifer/winix";
import { wsl } from "../features/wsl";

/**
 * @description Git with difftool, user info, conditional work email, and WSL credential helper
 * @category tool
 */
export const git = feature("git", () =>
  home.program("git", {
    userName: "Adrian Fernandez Garcia",
    userEmail: "tracker086@outlook.com",
    extraConfig: {
      diff: { tool: "nvimdiff" },
      difftool: { prompt: false },
      credential: {
        "https://dev.azure.com": { useHttpPath: true },
        helper: wsl.isActive
          ? "git-credential-manager-windows"
          : undefined,
      },
    },
    includes: [
      {
        condition: "gitdir:~/work/",
        contents: {
          user: {
            name: "Adrian Fernandez Garcia",
            email: "adrifer@microsoft.com",
          },
        },
      },
    ],
  })
);
