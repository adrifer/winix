import type { Fragment } from "../core/types.ts";

export interface ShellOpts {
  env?: Record<string, string>;
  path?: string[];
}

export function shell(opts: ShellOpts): Fragment {
  return {
    home: {
      ...(opts.env && { sessionVariables: opts.env }),
      ...(opts.path && { sessionPath: opts.path }),
    },
  };
}
