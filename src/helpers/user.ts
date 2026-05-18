import type { Fragment } from "../core/types.ts";

export interface UserOpts {
  shell?: string;
  homeDirectory?: string;
  stateVersion?: string;
  sessionVariables?: Record<string, string>;
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
              shell: `pkgs.${opts.shell}`,
            },
          },
        },
      },
    }),
  };
}
