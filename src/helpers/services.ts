import type { Fragment } from "../core/types.ts";

type ServiceOpts = Record<string, unknown>;

export interface ServicesHelper {
  enable<T extends ServiceOpts = ServiceOpts>(name: string, opts?: T): Fragment;
}

export const services: ServicesHelper = {
  enable: <T extends ServiceOpts = ServiceOpts>(
    name: string,
    opts: T = {} as T
  ): Fragment => ({
    nixos: {
      services: {
        [name]: {
          enable: true,
          ...opts,
        },
      },
    },
  }),
};

export const service = services.enable;
