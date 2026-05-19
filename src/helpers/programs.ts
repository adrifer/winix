import type { Fragment } from "../core/types.ts";

type ProgramOpts = Record<string, unknown>;

export interface ProgramsHelper {
  enable<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
}

export const programs: ProgramsHelper = {
  enable: <T extends ProgramOpts = ProgramOpts>(
    name: string,
    opts: T = {} as T
  ): Fragment => ({
    homeManager: {
      programs: {
        [name]: {
          enable: true,
          ...opts,
        },
      },
    },
  }),
};
