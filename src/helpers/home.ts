import type { Fragment } from "../core/types.ts";
import type { PackageRef, XdgFile } from "../types/index.ts";

export interface HomeHelper {
  program<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  service<T extends ProgramOpts = ProgramOpts>(name: string, opts?: T): Fragment;
  env(vars: Record<string, string>): Fragment;
  path(paths: string[]): Fragment;
  path(...paths: string[]): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  configFile(name: string, opts: XdgFile): Fragment;
  configFiles(files: Record<string, XdgFile>): Fragment;
}

type ProgramOpts = Record<string, unknown>;

export const home: HomeHelper = {
  program: <T extends ProgramOpts = ProgramOpts>(
    name: string,
    opts: T = {} as T
  ): Fragment => ({
    homeManager: { programs: { [name]: { enable: true, ...opts } } },
  }),
  service: <T extends ProgramOpts = ProgramOpts>(
    name: string,
    opts: T = {} as T
  ): Fragment => ({
    homeManager: { services: { [name]: { enable: true, ...opts } } },
  }),
  env: (vars: Record<string, string>): Fragment => ({
    homeManager: { home: { sessionVariables: vars } },
  }),
  path: (...args: string[] | [string[]]): Fragment => ({
    homeManager: { home: { sessionPath: normalizeArgs(args) } },
  }),
  packages: (...args: PackageRef[] | [PackageRef[]]): Fragment => ({
    homeManager: { home: { packages: normalizeArgs(args) } },
  }),
  configFile: (name: string, opts: XdgFile): Fragment => ({
    homeManager: { xdg: { configFile: { [name]: opts } } },
  }),
  configFiles: (files: Record<string, XdgFile>): Fragment => ({
    homeManager: { xdg: { configFile: files } },
  }),
};

function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}
