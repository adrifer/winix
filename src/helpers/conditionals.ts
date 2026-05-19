import type { NixExpr } from "../core/types.ts";

/**
 * Runtime Nix conditional value for Darwin systems.
 */
export function ifDarwin(value: string): NixExpr {
  return { __winixNixExpr: true, expr: `(if pkgs.stdenv.isDarwin then ${nixLiteral(value)} else null)` };
}

/**
 * Runtime Nix conditional value for Linux systems.
 */
export function ifLinux(value: string): NixExpr {
  return { __winixNixExpr: true, expr: `(if pkgs.stdenv.isLinux then ${nixLiteral(value)} else null)` };
}

/**
 * Runtime Nix conditional attrset for Darwin systems.
 */
export function ifDarwinAttrs(attrs: Record<string, string>): NixExpr {
  return {
    __winixNixExpr: true,
    expr: `(lib.optionalAttrs pkgs.stdenv.isDarwin { ${formatAttrs(attrs)} })`,
  };
}

/**
 * Runtime Nix conditional attrset for Linux systems.
 */
export function ifLinuxAttrs(attrs: Record<string, string>): NixExpr {
  return {
    __winixNixExpr: true,
    expr: `(lib.optionalAttrs pkgs.stdenv.isLinux { ${formatAttrs(attrs)} })`,
  };
}

function formatAttrs(attrs: Record<string, string>): string {
  return Object.entries(attrs)
    .map(([k, v]) => `${formatAttrKey(k)} = ${JSON.stringify(v)};`)
    .join(" ");
}

function formatAttrKey(key: string): string {
  return /^[a-zA-Z_][a-zA-Z0-9_'-]*$/.test(key) ? key : JSON.stringify(key);
}

function nixLiteral(value: string): string {
  return JSON.stringify(value);
}
