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
  program<K extends string>(
    name: K,
    opts?: K extends keyof DarwinProgramOptions
      ? Omit<DarwinProgramOptions[K], "enable">
      : Record<string, unknown>
  ): Fragment;
  service<K extends string>(
    name: K,
    opts?: K extends keyof DarwinServiceOptions
      ? Omit<DarwinServiceOptions[K], "enable">
      : Record<string, unknown>
  ): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  raw(config: string | DarwinOptions): Fragment;
}

export const darwin: DarwinHelper = {
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
  raw: (config: string | Record<string, unknown>): Fragment =>
    typeof config === "string" ? { darwin: { __raw: [config] } } : { darwin: config },
};

function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}
