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
  /** nix-darwin `launchd` options. */
  (config: LaunchdOptions): Fragment;
  /**
   * A per-user agent (`launchd.user.agents.<name>`).
   *
   * ```ts
   * darwin.launchd.agent("emacs", { serviceConfig: { ProgramArguments: ["emacs", "--fg-daemon"] } });
   * ```
   */
  agent(name: string, config: LaunchdAgentOptions): Fragment;
  /** A system daemon (`launchd.daemons.<name>`). */
  daemon(name: string, config: LaunchdAgentOptions): Fragment;
}

export interface DarwinHelper {
  /** Any nix-darwin options, as an object. */
  (config: DarwinOptions): Fragment;
  /** Import nix-darwin modules (`inputs.x.darwinModules.y`, or module paths). */
  imports(imports: string[]): Fragment;
  imports(...imports: string[]): Fragment;
  /** Enable a nix-darwin program, with its options: `programs.<name>` with `enable = true`. */
  program<const K extends string>(
    name: K,
    opts?: ProgramOptions<DarwinProgramOptions, K>
  ): Fragment;
  /** Enable a nix-darwin service, with its options: `services.<name>` with `enable = true`. */
  service<const K extends string>(
    name: K,
    opts?: ServiceOptions<DarwinServiceOptions, K>
  ): Fragment;
  /** Install packages system-wide (`environment.systemPackages`). */
  packages(packages: PackageRef[]): Fragment;
  packages(...packages: PackageRef[]): Fragment;
  /** Nix itself (`nix`). */
  nix(config: NixOptions): Fragment;
  /** `security` options (sudo, PAM, Touch ID for sudo). */
  security(config: DarwinSecurity): Fragment;
  /**
   * Homebrew (`homebrew`): casks, brews and Mac App Store apps.
   *
   * ```ts
   * darwin.homebrew({ enable: true, casks: ["visual-studio-code"] });
   * ```
   */
  homebrew(config: HomebrewOptions): Fragment;
  /** launchd agents and daemons. */
  launchd: LaunchdHelper;
  /**
   * macOS defaults (`system.defaults`).
   *
   * ```ts
   * darwin.defaults({ dock: { autohide: true } });
   * ```
   */
  defaults(config: DarwinDefaults): Fragment;
  /** A raw Nix snippet added to the host module, as written. */
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
