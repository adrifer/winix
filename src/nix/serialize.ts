/**
 * Escape content for a Nix double-quoted string without changing its value.
 */
export function escapeNixDoubleQuoted(value: string): string {
  if (value.includes("\0")) {
    throw new Error("Nix strings cannot contain null bytes");
  }

  return value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$\{/g, "\\${")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Serialize a JavaScript string as a behavior-preserving Nix literal.
 */
export function nixStringLiteral(value: string): string {
  return `"${escapeNixDoubleQuoted(value)}"`;
}
