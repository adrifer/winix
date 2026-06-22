import { normalizeArgs } from "./utils.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment } from "../core/types.ts";
import type { DarwinDefaults, DarwinOptions, DarwinSecurity, HomebrewOptions, LaunchdAgentOptions, LaunchdOptions, NixOptions, PackageRef } from "../types/index.ts";

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

export interface LaunchdHelper {
  (config: LaunchdOptions): Fragment;
  agent(name: string, config: LaunchdAgentOptions): Fragment;
  daemon(name: string, config: LaunchdAgentOptions): Fragment;
}

export interface DarwinHelper {
  (config: DarwinOptions): Fragment;
  imports(imports: string[]): Fragment;
  imports(...imports: string[]): Fragment;
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
  nix(config: NixOptions): Fragment;
  security(config: DarwinSecurity): Fragment;
  homebrew(config: HomebrewOptions): Fragment;
  launchd: LaunchdHelper;
  defaults(config: DarwinDefaults): Fragment;
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
    imports: (...args: string[] | [string[]]): Fragment => ({
      darwin: { imports: normalizeArgs(args) },
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
    nix: (config: NixOptions): Fragment => ({
      darwin: { nix: config },
    }),
    security: (config: DarwinSecurity): Fragment => ({
      darwin: { security: config },
    }),
    homebrew: (config: HomebrewOptions): Fragment => ({
      darwin: { homebrew: config },
    }),
    launchd: Object.assign(
      (config: LaunchdOptions): Fragment => ({
        darwin: { launchd: config },
      }),
      {
        agent: (name: string, config: LaunchdAgentOptions): Fragment => ({
          darwin: { launchd: { user: { agents: { [name]: config } } } },
        }),
        daemon: (name: string, config: LaunchdAgentOptions): Fragment => ({
          darwin: { launchd: { daemons: { [name]: config } } },
        }),
      }
    ),
    defaults: (config: DarwinDefaults): Fragment => ({
      darwin: { system: { defaults: config } },
    }),
    raw: (config: string): Fragment => ({ darwin: { __raw: [config] } }),
  }
);
