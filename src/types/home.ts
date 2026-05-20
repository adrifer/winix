import type { Attrs, PackageRef, Script } from "./common.ts";
import type { NixExpr } from "../core/types.ts";

export interface HomeActivation extends Record<string, unknown> {}

export interface HomeConfig extends Record<string, unknown> {
  username?: string;
  homeDirectory?: string;
  stateVersion?: string;
  packages?: PackageRef[];
  sessionVariables?: Record<string, string>;
  sessionPath?: string[];
  activation?: Record<string, HomeActivation | Script>;
}

export interface XdgFile extends Record<string, unknown> {
  source?: string | NixExpr;
  text?: Script;
  recursive?: boolean;
  enable?: boolean;
}

export interface XdgOptions extends Record<string, unknown> {
  configFile?: Record<string, XdgFile> | NixExpr;
  dataFile?: Record<string, XdgFile> | NixExpr;
}

export interface HomeOptions extends Record<string, unknown> {
  username?: string;
  home?: HomeConfig;
  programs?: Record<string, unknown>;
  services?: Attrs;
  xdg?: XdgOptions;
  packages?: PackageRef[];
  sessionVariables?: Record<string, string>;
  sessionPath?: string[];
  activation?: Record<string, HomeActivation | Script>;
  manual?: {
    manpages?: { enable?: boolean } & Record<string, unknown>;
  } & Record<string, unknown>;
}
