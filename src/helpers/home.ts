import type { Fragment } from "../core/types.ts";
import type { PackageRef, XdgFile } from "../types/index.ts";

export interface HomeHelper {
  env(vars: Record<string, string>): Fragment;
  path(paths: string[]): Fragment;
  path(...paths: string[]): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  configFile(name: string, opts: XdgFile): Fragment;
  configFiles(files: Record<string, XdgFile>): Fragment;
}

export const home: HomeHelper = {
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
