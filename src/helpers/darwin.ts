import { normalizeArgs } from "./utils.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment } from "../core/types.ts";
import type { DarwinOptions, PackageRef } from "../types/index.ts";

/**
 * Map of nix-darwin program names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface DarwinProgramOptions {}

/**
 * Map of nix-darwin service names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface DarwinServiceOptions {}

type ProgramOpts = Record<string, unknown>;

export interface DarwinHelper {
  (config: DarwinOptions): Fragment;
  program<const K extends string>(
    name: K,
    opts?: ProgramOptions<DarwinProgramOptions, K>
  ): Fragment;
  service<const K extends string>(
    name: K,
    opts?: ServiceOptions<DarwinServiceOptions, K>
  ): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  raw(config: string): Fragment;
}

export const darwin: DarwinHelper = Object.assign(
  (config: DarwinOptions): Fragment => ({ darwin: config }),
  {
    program: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      darwin: { programs: { [name]: { enable: true, ...opts } } },
    }),
    service: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      darwin: { services: { [name]: { enable: true, ...opts } } },
    }),
    packages: (...args: PackageRef[] | [PackageRef[]]): Fragment => ({
      darwin: { packages: normalizeArgs(args) },
    }),
    raw: (config: string): Fragment => ({ darwin: { __raw: [config] } }),
  }
);
