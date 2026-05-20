import type { Fragment } from "../core/types.ts";
import type { FirewallOptions, PackageRef, SystemdOptions } from "../types/index.ts";

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
  program<K extends keyof NixosProgramOptions>(
    name: K,
    opts?: Omit<NixosProgramOptions[K], "enable">
  ): Fragment;
  program(name: string, opts?: Record<string, unknown>): Fragment;
  service<K extends keyof NixosServiceOptions>(
    name: K,
    opts?: Omit<NixosServiceOptions[K], "enable">
  ): Fragment;
  service(name: string, opts?: Record<string, unknown>): Fragment;
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  sysctl(settings: SysctlSettings): Fragment;
  firewall(opts: FirewallOptions): Fragment;
  systemd(opts: SystemdOptions): Fragment;
  raw(config: string | Record<string, unknown>): Fragment;
}

export const nixos: NixosHelper = {
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
  raw: (config: string | Record<string, unknown>): Fragment =>
    typeof config === "string" ? { nixos: { __raw: [config] } } : { nixos: config },
};

function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}
