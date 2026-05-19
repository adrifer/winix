import type { Fragment } from "../core/types.ts";
import type { ZshOptions } from "../types/index.ts";

export interface ZshOpts
  extends Omit<
    ZshOptions,
    "autosuggestion" | "enableCompletion" | "plugins" | "shellAliases" | "syntaxHighlighting"
  > {
  aliases?: ZshOptions["shellAliases"];
  plugins?: string[];
  viMode?: boolean;
  autosuggestions?: boolean;
  completion?: boolean;
  syntaxHighlighting?: boolean;
  initExtra?: string;
  envExtra?: string;
}

export function zsh(opts: ZshOpts = {}): Fragment {
  return {
    homeManager: {
      programs: {
        zsh: {
          enable: true,
          enableCompletion: opts.completion ?? true,
          autosuggestion: { enable: opts.autosuggestions ?? true },
          syntaxHighlighting: { enable: opts.syntaxHighlighting ?? true },
          ...(opts.aliases && { shellAliases: opts.aliases }),
          ...(opts.plugins && {
            plugins: opts.plugins.map((name) => ({ name })),
          }),
          ...(opts.viMode && { defaultKeymap: "viins" }),
          ...(opts.initExtra && { initExtra: opts.initExtra }),
          ...(opts.envExtra && { envExtra: opts.envExtra }),
        },
      },
    },
  };
}
