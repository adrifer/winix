import type { Fragment } from "../core/types.ts";
import type { SystemdService, SystemdTimer } from "../types/index.ts";

export interface SystemdHelper {
  service(name: string, opts: SystemdService): Fragment;
  timer(name: string, opts: SystemdTimer): Fragment;
}

export const systemd: SystemdHelper = {
  service: (name: string, opts: SystemdService): Fragment => ({
    nixos: {
      systemd: {
        services: {
          [name]: opts,
        },
      },
    },
  }),
  timer: (name: string, opts: SystemdTimer): Fragment => ({
    nixos: {
      systemd: {
        timers: {
          [name]: opts,
        },
      },
    },
  }),
};
