import type { Fragment } from "../core/types.ts";
import type { PackageRef } from "../types/index.ts";

type ProgramOpts = Record<string, unknown>;

export interface DarwinHelper {
  program<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  service<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  raw(config: string | Record<string, unknown>): Fragment;
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
