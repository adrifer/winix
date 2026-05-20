/**
 * Normalize variadic args: accepts either spread args or a single array.
 * normalizeArgs(["a", "b"]) → ["a", "b"]
 * normalizeArgs([["a", "b"]]) → ["a", "b"]
 */
export function normalizeArgs<T>(args: T[] | [T[]]): T[] {
  return Array.isArray(args[0]) ? (args[0] as T[]) : (args as T[]);
}
