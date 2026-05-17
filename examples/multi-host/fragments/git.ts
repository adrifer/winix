import { type Fragment } from "winix";

/**
 * @description Git configuration with difftool, user info, and conditional work email
 * @example git()
 * @category tool
 */
export function git(): Fragment {
  return {
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
  };
}
