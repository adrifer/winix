import type { NixExpr } from "../core/types.ts";

/**
 * Build a double-quoted Nix string with interpolation.
 *
 * @example
 * nixStr`${pkg("neovim")}/bin/nvim -d "$LOCAL" "$REMOTE"`
 * // => "${pkgs.neovim}/bin/nvim -d \"$LOCAL\" \"$REMOTE\""
 */
export function nixStr(
  strings: TemplateStringsArray,
  ...values: (string | NixExpr)[]
): NixExpr {
  const parts: string[] = [];
  const rawStrings = strings.raw;

  for (let i = 0; i < rawStrings.length; i++) {
    parts.push(escapeNixDoubleQuoted(rawStrings[i]));
    if (i < values.length) {
      const val = values[i];
      if (isNixExpr(val)) {
        parts.push(`\${${val.expr}}`);
      } else {
        parts.push(escapeNixDoubleQuoted(String(val)));
      }
    }
  }

  return { __winixNixExpr: true, expr: `"${parts.join("")}"` };
}

function escapeNixDoubleQuoted(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, "\\${");
}

function isNixExpr(value: unknown): value is NixExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NixExpr).__winixNixExpr === true &&
    typeof (value as NixExpr).expr === "string"
  );
}
