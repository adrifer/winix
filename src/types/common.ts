import type { NixExpr } from "../core/types.ts";

export type NixPrimitive = string | number | boolean | null;
export type NixValue = NixPrimitive | NixValue[] | { [key: string]: NixValue };
export type PackageRef = string | NixExpr;
export type Attrs<T = unknown> = Record<string, T>;
export type Script = string | NixExpr;

export interface FreeformOptions extends Record<string, unknown> {}
