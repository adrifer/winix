import { platform, getOptionalEvalContext } from "../sdk/index.ts";
import type { PlatformFactory } from "../core/types.ts";

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

export interface PlatformsHelper {
  nixos: PlatformFactory<[opts?: NixosPlatformOpts]>;
  darwin: PlatformFactory<[opts?: DarwinPlatformOpts]>;
}

export const platforms: PlatformsHelper = {
  nixos: platform("nixos", (opts: NixosPlatformOpts = {}) => {
    const ctx = getOptionalEvalContext();
    const hostname = opts.hostname === false ? undefined : opts.hostname ?? ctx?.hostname;
    const useHomeManager = opts.homeManager ?? true;

    return {
      nixos: {
        ...(useHomeManager && { imports: ["home-manager"] }),
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
  }),

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
};
