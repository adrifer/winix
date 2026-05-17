import { feature } from "winix";
import { nixos, darwin } from "./platforms";
import { wsl } from "./wsl";

/**
 * @description Git configuration with difftool, user info, and conditional work email
 * @example git()
 * @category tool
 */
export const git = feature("git", () => ({
  home: {
    programs: {
      git: {
        enable: true,
        settings: {
          diff: { tool: "nvimdiff" },
          difftool: { prompt: false },
          user: {
            name: "Adrian Fernandez Garcia",
            email: "tracker086@outlook.com",
          },
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
      },
    },
  },
}));
