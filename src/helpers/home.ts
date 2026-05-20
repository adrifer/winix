import type { Fragment, NixExpr } from "../core/types.ts";
import type { HomeOptions, PackageRef, XdgFile } from "../types/index.ts";

/**
 * Map of Home Manager program names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface HomeProgramOptions {}

/**
 * Map of Home Manager service names to their option types.
 * Starts empty; augmented by generated types.
 */
export interface HomeServiceOptions {}

export interface HomeHelper {
  program<K extends string>(
    name: K,
    opts?: K extends keyof HomeProgramOptions
      ? Omit<HomeProgramOptions[K], "enable">
      : Record<string, unknown>
  ): Fragment;
  service<K extends string>(
    name: K,
    opts?: K extends keyof HomeServiceOptions
      ? Omit<HomeServiceOptions[K], "enable">
      : Record<string, unknown>
  ): Fragment;
  env(vars: Record<string, string>): Fragment;
  path(paths: string[]): Fragment;
  path(...paths: string[]): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  configFile(name: string, opts: XdgFile): Fragment;
  configFiles(files: Record<string, XdgFile>): Fragment;
  raw(config: string | HomeOptions): Fragment;
  activation(name: string, opts: ActivationOpts): Fragment;
}

type ProgramOpts = Record<string, unknown>;

export interface ActivationOpts {
  /** DAG dependencies. Defaults to ["writeBoundary"]. */
  after?: string[];
  /** Shell script body. Nix interpolations such as ${config.home.homeDirectory} are passed through. */
  script: string;
}

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
  raw: (config: string | Record<string, unknown>): Fragment =>
    typeof config === "string"
      ? { homeManager: { __raw: [config] } }
      : { homeManager: config },
  activation: (name: string, opts: ActivationOpts): Fragment => {
    const after = opts.after ?? ["writeBoundary"];
    const afterList = after.map((s) => JSON.stringify(s)).join(" ");
    return {
      homeManager: {
        home: {
          activation: {
            [name]: {
              __winixNixExpr: true,
              expr: `lib.hm.dag.entryAfter [ ${afterList} ] ''\n${opts.script}\n''`,
            } as NixExpr,
          },
        },
      },
    };
  },
};

function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}
