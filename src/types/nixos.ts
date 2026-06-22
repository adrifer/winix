import type { PackageRef, Script } from "./common.ts";
import type { ImportRef, NixExpr } from "../core/types.ts";

export interface NixSettings extends Record<string, unknown> {
  "experimental-features"?: string[] | string | NixExpr;
  experimentalFeatures?: string[] | string | NixExpr;
  substituters?: string[] | NixExpr;
  "trusted-public-keys"?: string[] | NixExpr;
  trustedPublicKeys?: string[] | NixExpr;
  "trusted-users"?: string[] | NixExpr;
  trustedUsers?: string[] | NixExpr;
  "auto-optimise-store"?: boolean | NixExpr;
  autoOptimiseStore?: boolean | NixExpr;
}

export interface NixGcOptions extends Record<string, unknown> {
  automatic?: boolean;
  dates?: string;
  interval?: Record<string, number>;
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
  hostId?: string;
  firewall?: FirewallOptions;
  useDHCP?: boolean;
  interfaces?: Record<string, { useDHCP?: boolean; ipv4?: unknown } & Record<string, unknown>>;
  nameservers?: string[];
  wireless?: { enable?: boolean } & Record<string, unknown>;
  networkmanager?: { enable?: boolean } & Record<string, unknown>;
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
  groups?: Record<string, Record<string, unknown>>;
  defaultUserShell?: PackageRef;
}

export interface NixosSystemOptions extends Record<string, unknown> {
  stateVersion?: string;
  activationScripts?: Record<string, unknown>;
}

export interface BootOptions extends Record<string, unknown> {
  isContainer?: boolean;
  kernel?: {
    sysctl?: Record<string, string | number | boolean>;
  } & Record<string, unknown>;
  loader?: Record<string, unknown>;
  kernelModules?: string[];
  kernelPackages?: PackageRef;
  extraModulePackages?: PackageRef[];
  supportedFilesystems?: string[];
  initrd?: {
    availableKernelModules?: string[];
    kernelModules?: string[];
    supportedFilesystems?: string[];
  } & Record<string, unknown>;
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

export interface NixosSecurityOptions extends Record<string, unknown> {
  sudo?: {
    wheelNeedsPassword?: boolean;
    extraRules?: Array<{
      groups?: string[];
      commands?: Array<{ command: string; options?: string[] } & Record<string, unknown>>;
    } & Record<string, unknown>>;
  } & Record<string, unknown>;
  pam?: {
    services?: Record<string, { text?: string; touchIdAuth?: boolean } & Record<string, unknown>>;
  } & Record<string, unknown>;
  rtkit?: { enable?: boolean } & Record<string, unknown>;
  polkit?: { enable?: boolean } & Record<string, unknown>;
}

export interface I18nOptions extends Record<string, unknown> {
  defaultLocale?: string;
  supportedLocales?: string[];
}

export interface TimeOptions extends Record<string, unknown> {
  timeZone?: string;
}

export interface EnvironmentOptions extends Record<string, unknown> {
  systemPackages?: PackageRef[];
  shells?: PackageRef[];
  variables?: Record<string, string>;
  pathsToLink?: string[];
  etc?: Record<string, { text?: string; source?: string; mode?: string } & Record<string, unknown>>;
  interactiveShellInit?: Script;
}

export interface FontsOptions extends Record<string, unknown> {
  packages?: PackageRef[];
  enableDefaultPackages?: boolean;
  fontconfig?: {
    defaultFonts?: {
      serif?: string[];
      sansSerif?: string[];
      monospace?: string[];
      emoji?: string[];
    } & Record<string, unknown>;
  } & Record<string, unknown>;
}

export interface OciContainerOptions extends Record<string, unknown> {
  image: string;
  autoStart?: boolean;
  ports?: string[];
  volumes?: string[];
  environment?: Record<string, string>;
  extraOptions?: string[];
}

export interface VirtualisationOptions extends Record<string, unknown> {
  podman?: { enable?: boolean } & Record<string, unknown>;
  docker?: { enable?: boolean } & Record<string, unknown>;
  ociContainers?: {
    backend?: "podman" | "docker";
    containers?: Record<string, OciContainerOptions>;
  } & Record<string, unknown>;
  libvirtd?: { enable?: boolean } & Record<string, unknown>;
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
  imports?: ImportRef[];
  nix?: NixOptions;
  nixpkgs?: NixpkgsOptions;
  networking?: NetworkingOptions;
  users?: UsersOptions;
  boot?: BootOptions;
  services?: ServicesOptions;
  security?: NixosSecurityOptions;
  i18n?: I18nOptions;
  time?: TimeOptions;
  systemd?: SystemdOptions;
  environment?: EnvironmentOptions;
  fonts?: FontsOptions;
  virtualisation?: VirtualisationOptions;
  programs?: Record<string, unknown>;
  wsl?: WslOptions;
  system?: NixosSystemOptions;
  homeManager?: Record<string, unknown>;
  "home-manager"?: Record<string, unknown>;
}
