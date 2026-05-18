import type { Fragment } from "../core/types.ts";
import type { HomeConfig, PackageRef } from "../types/index.ts";

export interface UserOpts {
  shell?: PackageRef;
  homeDirectory?: HomeConfig["homeDirectory"];
  stateVersion?: HomeConfig["stateVersion"];
  sessionVariables?: HomeConfig["sessionVariables"];
}

export function user(username: string, opts: UserOpts = {}): Fragment {
  return {
    home: {
      username,
      ...(opts.stateVersion && { stateVersion: opts.stateVersion }),
      ...(opts.homeDirectory && { home: { homeDirectory: opts.homeDirectory } }),
      ...(opts.sessionVariables && { sessionVariables: opts.sessionVariables }),
    },
    ...(opts.shell && {
      nixos: {
        users: {
          users: {
            [username]: {
              shell: typeof opts.shell === "string" ? `pkgs.${opts.shell}` : opts.shell,
            },
          },
        },
      },
    }),
  };
}
