import type { Fragment, NixExpr } from "../core/types.ts";

export interface ActivationOpts {
  /** DAG dependencies. Defaults to ["writeBoundary"]. */
  after?: string[];
  /** Shell script body. Nix interpolations such as ${config.home.homeDirectory} are passed through. */
  script: string;
}

/**
 * Create a Home Manager activation DAG entry.
 *
 * @example
 * activation("ensureNpmrc", { script: "mkdir -p \"$HOME/.config/npm\"" })
 */
export function activation(name: string, opts: ActivationOpts): Fragment {
  const after = opts.after ?? ["writeBoundary"];
  const afterList = after.map((s) => JSON.stringify(s)).join(" ");
  return {
    home: {
      activation: {
        [name]: {
          __winixNixExpr: true,
          expr: `lib.hm.dag.entryAfter [ ${afterList} ] ''\n${opts.script}\n''`,
        } as NixExpr,
      },
    },
  };
}
