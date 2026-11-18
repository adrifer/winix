import { platform, getOptionalEvalContext } from "../sdk/index.ts";
import type { Fragment, PlatformFactory } from "../core/types.ts";

export interface NixosPlatformOpts {
  system?: string;
  stateVersion?: string;
  allowUnfree?: boolean;
  homeManager?: boolean;
  hostname?: string | false;
}

export interface DarwinPlatformOpts {
  system?: string;
  stateVersion?: number | string;
  allowUnfree?: boolean;
  homeManager?: boolean;
  homebrew?: boolean;
  hostname?: string | false;
}

export interface WslPlatformOpts extends NixosPlatformOpts {
  /**
   * Nix input name providing NixOS-WSL, as it appears in `inputs.<name>`.
   * Defaults to "nixos-wsl" (the kebab-case name of a `nixosWsl` input).
   */
  input?: string;
}

export interface WindowsPlatformOpts {
  /** Hostname override; falls back to the host name from eval context. */
  hostname?: string | false;
}

export interface PlatformsHelper {
  nixos: PlatformFactory<[opts?: NixosPlatformOpts]>;
  /**
   * NixOS running under WSL: imports the NixOS-WSL module and enables it.
   * The host is still a NixOS host, so `platforms.nixos.isActive` is also
   * true; `platforms.wsl.isActive` is true only for WSL hosts.
   */
  wsl: PlatformFactory<[opts?: WslPlatformOpts]>;
  darwin: PlatformFactory<[opts?: DarwinPlatformOpts]>;
  windows: PlatformFactory<[opts?: WindowsPlatformOpts]>;
}

function nixosPlatform(opts: NixosPlatformOpts): Fragment {
  const ctx = getOptionalEvalContext();
  const hostname = opts.hostname === false ? undefined : opts.hostname ?? ctx?.hostname;
  const useHomeManager = opts.homeManager ?? true;

  return {
    nixos: {
      ...(useHomeManager && { imports: ["inputs.home-manager.nixosModules.home-manager"] }),
      nixpkgs: {
        hostPlatform: opts.system ?? "x86_64-linux",
        config: { allowUnfree: opts.allowUnfree ?? true },
      },
      nix: { settings: { experimentalFeatures: ["nix-command", "flakes"] } },
      ...(hostname && { networking: { hostName: hostname } }),
      ...(opts.stateVersion && { system: { stateVersion: opts.stateVersion } }),
      ...(useHomeManager && {
        homeManager: {
          useGlobalPkgs: true,
          useUserPackages: true,
        },
      }),
    },
  };
}

export const platforms: PlatformsHelper = {
  nixos: platform("nixos", (opts: NixosPlatformOpts = {}) => nixosPlatform(opts)),

  wsl: platform("nixos", (opts: WslPlatformOpts = {}) => {
    const { input = "nixos-wsl", ...nixosOpts } = opts;
    if (typeof input !== "string" || !/^[A-Za-z_][A-Za-z0-9_'-]*$/.test(input)) {
      throw new Error("platforms.wsl input must be a Nix input name, e.g. \"nixos-wsl\"");
    }
    const base = nixosPlatform(nixosOpts);
    const imports = (base.nixos?.imports as string[] | undefined) ?? [];
    return {
      nixos: {
        ...base.nixos,
        imports: [...imports, `inputs.${input}.nixosModules.wsl`],
        wsl: { enable: true },
      },
    };
  }, { variant: "wsl" }),

  darwin: platform("darwin", (opts: DarwinPlatformOpts = {}) => {
    const ctx = getOptionalEvalContext();
    const hostname = opts.hostname === false ? undefined : opts.hostname ?? ctx?.hostname;
    const useHomeManager = opts.homeManager ?? true;
    const useHomebrew = opts.homebrew ?? false;

    return {
      darwin: {
        imports: [
          ...(useHomeManager ? ["inputs.home-manager.darwinModules.home-manager"] : []),
          ...(useHomebrew ? ["inputs.nix-homebrew.darwinModules.nix-homebrew"] : []),
        ],
        nixpkgs: {
          hostPlatform: opts.system ?? "aarch64-darwin",
          config: { allowUnfree: opts.allowUnfree ?? true },
        },
        nix: {
          enable: false,
          settings: { experimentalFeatures: ["nix-command", "flakes"] },
        },
        ...(hostname && { networking: { hostName: hostname } }),
        ...(opts.stateVersion !== undefined && { system: { stateVersion: opts.stateVersion } }),
        ...(useHomeManager && {
          "home-manager": {
            useGlobalPkgs: true,
            useUserPackages: true,
          },
        }),
        ...(useHomebrew && {
          "nix-homebrew": {
            enable: true,
            autoMigrate: true,
          },
        }),
      },
    };
  }),

  windows: platform("windows", (opts: WindowsPlatformOpts = {}) => {
    const ctx = getOptionalEvalContext();
    const hostname = opts.hostname === false ? undefined : opts.hostname ?? ctx?.hostname;

    return {
      windows: {
        // Empty packages map establishes the `windows` scope so the host is
        // recognized as a Windows target by the evaluator and emitter, even
        // before any windows.package(...) fragment contributes.
        packages: {},
        ...(hostname && { hostname }),
      },
    };
  }),
};
