import type { Attrs, PackageRef, Script } from "./common.ts";
import type { ImportRef, NixExpr } from "../core/types.ts";

export interface HomeActivation extends Record<string, unknown> {}

export interface HomeConfig extends Record<string, unknown> {
  username?: string;
  homeDirectory?: string;
  stateVersion?: string;
  packages?: PackageRef[];
  file?: Record<string, HomeFile> | NixExpr;
  sessionVariables?: Record<string, string>;
  sessionPath?: string[];
  activation?: Record<string, HomeActivation | Script>;
}

export interface HomeFile extends Record<string, unknown> {
  source?: string | NixExpr;
  text?: Script;
  recursive?: boolean;
  executable?: boolean;
  force?: boolean;
  enable?: boolean;
}

export interface XdgFile extends HomeFile {}

export interface XdgOptions extends Record<string, unknown> {
  configFile?: Record<string, HomeFile> | NixExpr;
  dataFile?: Record<string, HomeFile> | NixExpr;
}

export interface HomeOptions extends Record<string, unknown> {
  imports?: ImportRef[];
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
