import type { PackageRef, Script } from "./common.ts";
import type { CommonPrograms } from "./programs.ts";
import type { NixExpr } from "../core/types.ts";

export interface NixSettings extends Record<string, unknown> {
  "experimental-features"?: string[] | string;
  experimentalFeatures?: string[] | string;
  substituters?: string[];
  "trusted-users"?: string[];
  trustedUsers?: string[];
  "auto-optimise-store"?: boolean;
}

export interface NixGcOptions extends Record<string, unknown> {
  automatic?: boolean;
  dates?: string;
  options?: string;
}

export interface NixOptions extends Record<string, unknown> {
  gc?: NixGcOptions;
  settings?: NixSettings;
  package?: PackageRef;
}

export interface NixpkgsOptions extends Record<string, unknown> {
  config?: NixConfig;
  overlays?: unknown[];
  hostPlatform?: string;
  pkgs?: unknown;
}

export interface NixConfig extends Record<string, unknown> {
  allowUnfree?: boolean;
}

export interface FirewallOptions extends Record<string, unknown> {
  enable?: boolean;
  allowedTCPPorts?: number[];
  allowedUDPPorts?: number[];
}

export interface NetworkingOptions extends Record<string, unknown> {
  hostName?: string;
  firewall?: FirewallOptions;
  useDHCP?: boolean;
}

export interface UserOptions extends Record<string, unknown> {
  isNormalUser?: boolean;
  extraGroups?: string[];
  uid?: number;
  shell?: PackageRef;
  home?: string;
}

export interface UsersOptions extends Record<string, unknown> {
  users?: Record<string, UserOptions>;
  defaultUserShell?: PackageRef;
}

export interface BootOptions extends Record<string, unknown> {
  isContainer?: boolean;
  kernel?: {
    sysctl?: Record<string, string | number | boolean>;
  } & Record<string, unknown>;
  loader?: Record<string, unknown>;
}

export interface SystemdService extends Record<string, unknown> {
  description?: string;
  serviceConfig?: Record<string, unknown>;
  script?: Script;
  path?: PackageRef[];
  wantedBy?: string[];
  after?: string[];
}

export interface SystemdTimer extends Record<string, unknown> {
  description?: string;
  timerConfig?: Record<string, unknown>;
  wantedBy?: string[];
}

export interface SystemdOptions extends Record<string, unknown> {
  services?: Record<string, SystemdService>;
  timers?: Record<string, SystemdTimer>;
  tmpfiles?: { rules?: string[] } & Record<string, unknown>;
  mounts?: Record<string, unknown>[];
}

export interface ServicesOptions extends Record<string, unknown> {}

export interface EnvironmentOptions extends Record<string, unknown> {
  systemPackages?: PackageRef[];
  shells?: PackageRef[];
  variables?: Record<string, string>;
  interactiveShellInit?: Script;
}

export interface WslOptions extends Record<string, unknown> {
  enable?: boolean;
  defaultUser?: string | NixExpr;
  extraBin?: Array<{ src?: string | NixExpr } & Record<string, unknown>>;
  wslConf?: {
    interop?: {
      enabled?: boolean;
      appendWindowsPath?: boolean;
    } & Record<string, unknown>;
  } & Record<string, unknown>;
  interop?: {
    register?: boolean;
  } & Record<string, unknown>;
}

export interface NixosOptions extends Record<string, unknown> {
  imports?: unknown[];
  nix?: NixOptions;
  nixpkgs?: NixpkgsOptions;
  networking?: NetworkingOptions;
  users?: UsersOptions;
  boot?: BootOptions;
  services?: ServicesOptions;
  systemd?: SystemdOptions;
  environment?: EnvironmentOptions;
  programs?: CommonPrograms & Record<string, unknown>;
  wsl?: WslOptions;
  system?: {
    stateVersion?: string;
    activationScripts?: Record<string, unknown>;
  } & Record<string, unknown>;
  homeManager?: Record<string, unknown>;
  "home-manager"?: Record<string, unknown>;
}
