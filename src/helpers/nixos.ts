import { normalizeArgs } from "./utils.ts";
import type { ProgramOptions, ServiceOptions } from "./options.ts";
import type { Fragment } from "../core/types.ts";
import type { BootOptions, EnvironmentOptions, FontsOptions, I18nOptions, NetworkingOptions, NixOptions, NixosOptions, NixosSecurityOptions, NixosSystemOptions, OciContainerOptions, PackageRef, SystemdOptions, SystemdService, SystemdTimer, TimeOptions, UsersOptions, VirtualisationOptions } from "../types/index.ts";

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

export interface VirtualisationHelper {
  (config: VirtualisationOptions): Fragment;
  ociContainer(name: string, config: OciContainerOptions): Fragment;
}

export interface SystemdHelper {
  (config: SystemdOptions): Fragment;
  service(name: string, config: SystemdService): Fragment;
  userService(name: string, config: SystemdService): Fragment;
  timer(name: string, config: SystemdTimer): Fragment;
  tmpfiles(rules: string[]): Fragment;
}

export interface NixosHelper {
  (config: NixosOptions): Fragment;
  imports(imports: string[]): Fragment;
  imports(...imports: string[]): Fragment;
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
  nix(config: NixOptions): Fragment;
  boot(config: BootOptions): Fragment;
  networking(config: NetworkingOptions): Fragment;
  environment(config: EnvironmentOptions): Fragment;
  users(config: UsersOptions): Fragment;
  system(config: NixosSystemOptions): Fragment;
  fonts(config: FontsOptions): Fragment;
  security(config: NixosSecurityOptions): Fragment;
  i18n(config: I18nOptions): Fragment;
  time(config: TimeOptions): Fragment;
  virtualisation: VirtualisationHelper;
  sysctl(settings: SysctlSettings): Fragment;
  systemd: SystemdHelper;
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
    imports: (...args: string[] | [string[]]): Fragment => ({
      nixos: { imports: normalizeArgs(args) },
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
    nix: (config: NixOptions): Fragment => ({
      nixos: { nix: config },
    }),
    boot: (config: BootOptions): Fragment => ({
      nixos: { boot: config },
    }),
    networking: (config: NetworkingOptions): Fragment => ({
      nixos: { networking: config },
    }),
    environment: (config: EnvironmentOptions): Fragment => ({
      nixos: { environment: config },
    }),
    users: (config: UsersOptions): Fragment => ({
      nixos: { users: config },
    }),
    system: (config: NixosSystemOptions): Fragment => ({
      nixos: { system: config },
    }),
    fonts: (config: FontsOptions): Fragment => ({
      nixos: { fonts: config },
    }),
    security: (config: NixosSecurityOptions): Fragment => ({
      nixos: { security: config },
    }),
    i18n: (config: I18nOptions): Fragment => ({
      nixos: { i18n: config },
    }),
    time: (config: TimeOptions): Fragment => ({
      nixos: { time: config },
    }),
    virtualisation: Object.assign(
      (config: VirtualisationOptions): Fragment => ({
        nixos: { virtualisation: config },
      }),
      {
        ociContainer: (name: string, config: OciContainerOptions): Fragment => ({
          nixos: {
            virtualisation: {
              ociContainers: {
                containers: {
                  [name]: config,
                },
              },
            },
          },
        }),
      }
    ),
    sysctl: (settings: SysctlSettings): Fragment => ({
      nixos: {
        boot: {
          kernel: {
            sysctl: settings,
          },
        },
      },
    }),
    systemd: Object.assign(
      (opts: SystemdOptions): Fragment => ({
        nixos: { systemd: opts },
      }),
      {
        service: (name: string, config: SystemdService): Fragment => ({
          nixos: { systemd: { services: { [name]: config } } },
        }),
        userService: (name: string, config: SystemdService): Fragment => ({
          nixos: { systemd: { user: { services: { [name]: config } } } },
        }),
        timer: (name: string, config: SystemdTimer): Fragment => ({
          nixos: { systemd: { timers: { [name]: config } } },
        }),
        tmpfiles: (rules: string[]): Fragment => ({
          nixos: { systemd: { tmpfiles: { rules } } },
        }),
      }
    ),
    raw: (config: string): Fragment => ({ nixos: { __raw: [config] } }),
  }
);
