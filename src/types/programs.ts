import type { Attrs, PackageRef, Script } from "./common.ts";
import type { NixExpr } from "../core/types.ts";

export interface ZshPlugin extends Record<string, unknown> {
  name?: string;
  src?: PackageRef;
  file?: string;
}

export interface ZshOptions extends Record<string, unknown> {
  enable?: boolean;
  enableCompletion?: boolean;
  autosuggestion?: { enable?: boolean } & Record<string, unknown>;
  syntaxHighlighting?: { enable?: boolean } & Record<string, unknown>;
  plugins?: ZshPlugin[];
  shellAliases?: Record<string, string> | NixExpr;
  initContent?: Script;
  initExtra?: Script;
  envExtra?: Script;
  defaultKeymap?: string;
}

export interface GitInclude extends Record<string, unknown> {
  condition?: string;
  contents?: Record<string, unknown>;
}

export interface GitOptions extends Record<string, unknown> {
  enable?: boolean;
  userName?: string;
  userEmail?: string;
  settings?: Record<string, unknown>;
  extraConfig?: Record<string, unknown>;
  includes?: GitInclude[];
  aliases?: Record<string, string>;
  signing?: { key?: string; format?: "ssh" | "gpg" } & Record<string, unknown>;
}

export interface StarshipOptions extends Record<string, unknown> {
  enable?: boolean;
  enableZshIntegration?: boolean;
  settings?: Record<string, unknown>;
}

export interface FzfOptions extends Record<string, unknown> {
  enable?: boolean;
  enableZshIntegration?: boolean;
}

export interface ZoxideOptions extends Record<string, unknown> {
  enable?: boolean;
  enableZshIntegration?: boolean;
}

export interface TmuxOptions extends Record<string, unknown> {
  enable?: boolean;
  terminal?: string;
  keyMode?: string;
  plugins?: PackageRef[];
  extraConfig?: Script;
}

export interface NeovimOptions extends Record<string, unknown> {
  enable?: boolean;
  defaultEditor?: boolean;
  viAlias?: boolean;
  vimAlias?: boolean;
}

export type ProgramSettings = Attrs;
