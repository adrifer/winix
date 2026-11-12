/**
 * Normalize variadic args: accepts either spread args or a single array.
 * normalizeArgs(["a", "b"]) → ["a", "b"]
 * normalizeArgs([["a", "b"]]) → ["a", "b"]
 */
export function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}

export function powerShellLiteral(value: string): string {
  if (!/[^\x00-\x7f]/.test(value)) return `'${value.replaceAll("'", "''")}'`;
  // DSC's pwsh stdin transport can use an OEM code page. Keep script data ASCII.
  const escaped = value.replaceAll("`", "``").replaceAll('"', '`"').replaceAll("$", "`$")
    .replace(/[^\x00-\x7f]/gu, (character) => "`u{" + character.codePointAt(0)!.toString(16) + "}");
  return `"${escaped}"`;
}
