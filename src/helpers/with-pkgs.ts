import type { NixExpr } from "../core/types.ts";

/**
 * Render an arbitrary package-list option as a `with pkgs; [ ... ]` expression.
 */
export function withPkgs(packages: string[]): NixExpr {
  return { __winixNixExpr: true, expr: `with pkgs; [ ${packages.join(" ")} ]` };
}
