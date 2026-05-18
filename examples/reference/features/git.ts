import { feature, git as gitConfig } from "winix";
import { wsl } from "../features/wsl";

/**
 * @description Git with difftool, user info, conditional work email, and WSL credential helper
 * @category tool
 */
export const git = feature("git", () =>
  gitConfig({
    userName: "Adrian Fernandez Garcia",
    userEmail: "tracker086@outlook.com",
    difftool: "nvimdiff",
    extraConfig: {
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
        user: {
          name: "Adrian Fernandez Garcia",
          email: "adrifer@microsoft.com",
        },
      },
    ],
  })
);
