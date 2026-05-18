import type { PackageRef } from "./common.ts";
import type { CommonPrograms } from "./programs.ts";
import type { NixOptions, NixpkgsOptions } from "./nixos.ts";

export interface DarwinSystem extends Record<string, unknown> {
  stateVersion?: number | string;
  primaryUser?: string;
}

export interface HomebrewOptions extends Record<string, unknown> {
  enable?: boolean;
  casks?: string[];
  brews?: string[];
  taps?: string[];
}

export interface NixHomebrewOptions extends Record<string, unknown> {
  enable?: boolean;
  user?: string;
  autoMigrate?: boolean;
}

export interface DarwinSecurity extends Record<string, unknown> {
  pam?: {
    services?: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
}

export interface DarwinNetworking extends Record<string, unknown> {
  hostName?: string;
}

export interface DarwinOptions extends Record<string, unknown> {
  imports?: unknown[];
  system?: DarwinSystem;
  homebrew?: HomebrewOptions;
  "nix-homebrew"?: NixHomebrewOptions;
  security?: DarwinSecurity;
  networking?: DarwinNetworking;
  environment?: {
    systemPackages?: PackageRef[];
    shells?: PackageRef[];
    variables?: Record<string, string>;
  } & Record<string, unknown>;
  users?: {
    users?: Record<string, { home?: string; shell?: PackageRef } & Record<string, unknown>>;
  } & Record<string, unknown>;
  programs?: CommonPrograms & Record<string, unknown>;
  nix?: NixOptions;
  nixpkgs?: NixpkgsOptions;
  "home-manager"?: Record<string, unknown>;
}
