import { normalizeArgs } from "./utils.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment } from "../core/types.ts";
import type { FirewallOptions, NixosOptions, PackageRef, SystemdOptions } from "../types/index.ts";

export type SysctlSettings = Record<string, number | string | boolean>;

/**
 * Map of NixOS program names to their option types.
 * Starts empty; augmented by generated types (`winix types generate`).
 * Allows typed autocomplete for `nixos.program("name", { ... })`.
 */
export interface NixosProgramOptions {}

/**
 * Map of NixOS service names to their option types.
 * Starts empty; augmented by generated types (`winix types generate`).
 * Allows typed autocomplete for `nixos.service("name", { ... })`.
 */
export interface NixosServiceOptions {}

type ProgramOpts = Record<string, unknown>;

export interface NixosHelper {
  (config: NixosOptions): Fragment;
  program<const K extends string>(
    name: K,
    opts?: ProgramOptions<NixosProgramOptions, K>
  ): Fragment;
  service<const K extends string>(
    name: K,
    opts?: ServiceOptions<NixosServiceOptions, K>
  ): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  sysctl(settings: SysctlSettings): Fragment;
  firewall(opts: FirewallOptions): Fragment;
  systemd(opts: SystemdOptions): Fragment;
  raw(config: string): Fragment;
}

export const nixos: NixosHelper = Object.assign(
  (config: NixosOptions): Fragment => ({ nixos: config }),
  {
    program: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      nixos: { programs: { [name]: { enable: true, ...opts } } },
    }),
    service: <T extends ProgramOpts = ProgramOpts>(
      name: string,
      opts: T = {} as T
    ): Fragment => ({
      nixos: { services: { [name]: { enable: true, ...opts } } },
    }),
    packages: (...args: PackageRef[] | [PackageRef[]]): Fragment => ({
      nixos: { packages: normalizeArgs(args) },
    }),
    sysctl: (settings: SysctlSettings): Fragment => ({
      nixos: {
        boot: {
          kernel: {
            sysctl: settings,
          },
        },
      },
    }),
    firewall: (opts: FirewallOptions): Fragment => ({
      nixos: { networking: { firewall: opts } },
    }),
    systemd: (opts: SystemdOptions): Fragment => ({
      nixos: { systemd: opts },
    }),
    raw: (config: string): Fragment => ({ nixos: { __raw: [config] } }),
  }
);
