import { normalizeArgs } from "./utils.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment, NixExpr } from "../core/types.ts";
import type { HomeFile, HomeOptions, PackageRef } from "../types/index.ts";

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
  (config: HomeOptions): Fragment;
  imports(imports: string[]): Fragment;
  imports(...imports: string[]): Fragment;
  program<const K extends string>(
    name: K,
    opts?: ProgramOptions<HomeProgramOptions, K>
  ): Fragment;
  service<const K extends string>(
    name: K,
    opts?: ServiceOptions<HomeServiceOptions, K>
  ): Fragment;
  env(vars: Record<string, string>): Fragment;
  path(paths: string[]): Fragment;
  path(...paths: string[]): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  files(files: Record<string, HomeFile>): Fragment;
  configFile(name: string, opts: HomeFile): Fragment;
  configFiles(files: Record<string, HomeFile>): Fragment;
  symlink(path: string, opts?: Omit<HomeFile, "source" | "text">): HomeFile;
  raw(config: string): Fragment;
  activation(name: string, opts: ActivationOpts): Fragment;
}

type ProgramOpts = Record<string, unknown>;

export interface ActivationOpts {
  /** DAG dependencies. Defaults to ["writeBoundary"]. */
  after?: string[];
  /** Shell script body. Nix interpolations such as ${config.home.homeDirectory} are passed through. */
  script: string;
}

export const home: HomeHelper = Object.assign(
  (config: HomeOptions): Fragment => ({ homeManager: config }),
  {
    program: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      homeManager: { programs: { [name]: { enable: true, ...opts } } },
    }),
    imports: (...args: string[] | [string[]]): Fragment => ({
      homeManager: { imports: normalizeArgs(args) },
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
    files: (files: Record<string, HomeFile>): Fragment => ({
      homeManager: { home: { file: files } },
    }),
    configFile: (name: string, opts: HomeFile): Fragment => ({
      homeManager: { xdg: { configFile: { [name]: opts } } },
    }),
    configFiles: (files: Record<string, HomeFile>): Fragment => ({
      homeManager: { xdg: { configFile: files } },
    }),
    symlink: (path: string, opts: Omit<HomeFile, "source" | "text"> = {}): HomeFile => ({
      ...opts,
      source: {
        __winixNixExpr: true,
        expr: `config.lib.file.mkOutOfStoreSymlink ${homePathToNixString(path)}`,
      },
    }),
    raw: (config: string): Fragment => ({ homeManager: { __raw: [config] } }),
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
  }
);

function homePathToNixString(path: string): string {
  if (path.startsWith("~/")) {
    return `"${escapeNixString(`\${config.home.homeDirectory}/${path.slice(2)}`)}"`;
  }
  return JSON.stringify(path);
}

function escapeNixString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
