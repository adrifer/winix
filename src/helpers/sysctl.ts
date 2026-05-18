import type { Fragment } from "../core/types.ts";

export type SysctlSettings = Record<string, number | string>;

export function sysctl(settings: SysctlSettings): Fragment {
  return {
    nixos: {
      boot: {
        kernel: {
          sysctl: settings,
        },
      },
    },
  };
}
