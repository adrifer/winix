import { feature, home } from "@adrifer/winix";

/**
 * @description Git with user info, nvimdiff difftool, and per-tree includes
 * @category vcs
 */
export const git = feature("git", () =>
  home.program("git", {
    settings: {
      user: {
        name: "Tony Stark",
        email: "tony@stark.industries",
      },
      diff: {
        tool: "nvimdiff",
      },
      difftool: {
        prompt: false,
      },
    },
    includes: [
      // Show how per-worktree identity overrides work without leaking a
      // real second identity into the example.
      {
        condition: "gitdir:~/projects/oss/",
        contents: {
          user: {
            name: "Tony Stark",
            email: "tony@oss.example",
          },
        },
      },
    ],
  })
);
