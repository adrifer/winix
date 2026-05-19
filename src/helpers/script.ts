import type { NixExpr } from "../core/types.ts";

/**
 * Render a multiline Nix indented string. Nix interpolations are passed through verbatim.
 */
export function script(body: string): NixExpr {
  const trimmed = body.replace(/^\n/, "").replace(/\n\s*$/, "");
  return { __winixNixExpr: true, expr: `''\n${trimmed}\n''` };
}

/**
 * Concatenate Nix script/string expressions with Nix's `+` operator.
 */
export function scriptConcat(...parts: NixExpr[]): NixExpr {
  return { __winixNixExpr: true, expr: parts.map((p) => p.expr).join(" + ") };
}
