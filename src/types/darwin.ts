import type { PackageRef } from "./common.ts";
import type { ImportRef } from "../core/types.ts";
import type { NixOptions, NixpkgsOptions } from "./nixos.ts";

export interface DarwinSystem extends Record<string, unknown> {
  stateVersion?: number | string;
  primaryUser?: string;
  defaults?: DarwinDefaults;
  keyboard?: Record<string, unknown>;
}

export interface DarwinDefaults extends Record<string, unknown> {
  NSGlobalDomain?: Record<string, unknown>;
  CustomUserPreferences?: Record<string, unknown>;
  dock?: Record<string, unknown>;
  finder?: Record<string, unknown>;
  trackpad?: Record<string, unknown>;
  loginwindow?: Record<string, unknown>;
  screencapture?: Record<string, unknown>;
  screensaver?: Record<string, unknown>;
}

export interface HomebrewOptions extends Record<string, unknown> {
  enable?: boolean;
  casks?: string[];
  brews?: string[];
  taps?: string[];
  masApps?: Record<string, number>;
  onActivation?: {
    cleanup?: "none" | "uninstall" | "zap";
    autoUpdate?: boolean;
    upgrade?: boolean;
  } & Record<string, unknown>;
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

export interface LaunchdAgentOptions extends Record<string, unknown> {
  path?: string[];
  serviceConfig: {
    KeepAlive?: boolean;
    ProgramArguments: string[];
    RunAtLoad?: boolean;
    StandardErrorPath?: string;
    StandardOutPath?: string;
    WorkingDirectory?: string;
    EnvironmentVariables?: Record<string, string>;
  } & Record<string, unknown>;
}

export interface LaunchdOptions extends Record<string, unknown> {
  user?: {
    agents?: Record<string, LaunchdAgentOptions>;
  } & Record<string, unknown>;
  daemons?: Record<string, LaunchdAgentOptions>;
}

export interface DarwinOptions extends Record<string, unknown> {
  imports?: ImportRef[];
  system?: DarwinSystem;
  homebrew?: HomebrewOptions;
  "nix-homebrew"?: NixHomebrewOptions;
  security?: DarwinSecurity;
  networking?: DarwinNetworking;
  launchd?: LaunchdOptions;
  environment?: {
    systemPackages?: PackageRef[];
    shells?: PackageRef[];
    variables?: Record<string, string>;
  } & Record<string, unknown>;
  users?: {
    users?: Record<string, { home?: string; shell?: PackageRef } & Record<string, unknown>>;
  } & Record<string, unknown>;
  programs?: Record<string, unknown>;
  nix?: NixOptions;
  nixpkgs?: NixpkgsOptions;
  "home-manager"?: Record<string, unknown>;
}
