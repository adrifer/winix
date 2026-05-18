import type { NixExpr } from "../core/types.ts";

/**
 * Creates an unquoted Nix package reference.
 *
 * pkg("zsh") -> pkgs.zsh
 * pkg("python3Packages.requests") -> pkgs.python3Packages.requests
 */
export function pkg(name: string): NixExpr {
  return { __winixNixExpr: true, expr: `pkgs.${name}` };
}
