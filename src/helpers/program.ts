import type { Fragment } from "../core/types.ts";

type ProgramOpts = Record<string, unknown>;

export interface ProgramHelper {
  <T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  service<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  nixos<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  darwin<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  homeService<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
}

export const program: ProgramHelper = Object.assign(
  <T extends ProgramOpts = ProgramOpts>(name: string, opts: T = {} as T): Fragment => ({
    home: { programs: { [name]: opts } },
  }),
  {
    service: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      nixos: { services: { [name]: opts } },
    }),
    nixos: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      nixos: { [name]: opts },
    }),
    darwin: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      darwin: { [name]: opts },
    }),
    homeService: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      home: { services: { [name]: opts } },
    }),
  }
);
