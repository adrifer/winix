// Minimal YAML value serializer for the Windows DSC emitter.
//
// Winix emits Nix by hand and has zero runtime dependencies; the Windows
// backend keeps that property by serializing the small, well-typed subset of
// YAML that DSC v3 configuration documents need, rather than pulling in a YAML
// library.
//
// SCOPE: this serializes arbitrary *JSON-like* values (string, number, boolean,
// null, arrays, plain objects) into block-style YAML. It is used for the
// `properties` of a generic DSC resource, including the nested `resources:`
// array of the `Microsoft.DSC/PowerShell` adapter. It is deliberately NOT a
// general YAML emitter: it does not handle anchors, tags, or non-JSON values.
//
// DETERMINISM: object keys are emitted in insertion order. Callers that need a
// stable document order across runs must build their objects deterministically
// (the helpers do: they construct property objects in a fixed field order).

/** A JSON-like value the serializer accepts. */
export type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

const INDENT = "  ";

/**
 * Serialize a value as block-style YAML lines at the given indent depth.
 * Returns an array of lines WITHOUT a trailing newline; the caller joins them.
 *
 * The `keyContext` form (rendering a value that sits to the right of a `key:`)
 * is handled by the caller via {@link yamlEntry}; this function renders a value
 * standing on its own (e.g. an array item or the document root).
 */
export function yamlLines(value: YamlValue, depth = 0): string[] {
  const pad = INDENT.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}[]`];
    const out: string[] = [];
    for (const item of value) {
      out.push(...yamlArrayItem(item, depth));
    }
    return out;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${pad}{}`];
    const out: string[] = [];
    for (const key of keys) {
      out.push(...yamlEntry(key, value[key], depth));
    }
    return out;
  }

  return [`${pad}${yamlScalar(value)}`];
}

/**
 * Render a single `key: value` entry, choosing inline vs. block layout based on
 * the value's shape:
 * - scalars render inline: `key: value`
 * - empty collections render inline: `key: []` / `key: {}`
 * - non-empty arrays/objects render on following indented lines
 */
export function yamlEntry(key: string, value: YamlValue, depth: number): string[] {
  const pad = INDENT.repeat(depth);
  const k = yamlKey(key);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${k}: []`];
    // Array items sit at the SAME indent as the key (block sequence style),
    // matching how the existing emitter and Microsoft's own DSC docs lay out
    // `resources:` and `dependsOn:`.
    const out = [`${pad}${k}:`];
    for (const item of value) {
      out.push(...yamlArrayItem(item, depth));
    }
    return out;
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${pad}${k}: {}`];
    const out = [`${pad}${k}:`];
    for (const childKey of keys) {
      out.push(...yamlEntry(childKey, value[childKey], depth + 1));
    }
    return out;
  }

  return [`${pad}${k}: ${yamlScalar(value)}`];
}

/**
 * Render one array item as a `- ...` block sequence entry. Scalars render
 * inline after the dash; objects render with their first key on the dash line
 * and the rest indented under it (canonical block-sequence-of-mappings style).
 */
function yamlArrayItem(value: YamlValue, depth: number): string[] {
  const pad = INDENT.repeat(depth);

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${pad}- {}`];
    const out: string[] = [];
    keys.forEach((key, index) => {
      const entryLines = yamlEntry(key, value[key], depth + 1);
      if (index === 0) {
        // Hoist the first entry onto the dash line: "- key: value" or "- key:".
        out.push(`${pad}- ${entryLines[0].slice((depth + 1) * INDENT.length)}`);
        out.push(...entryLines.slice(1));
      } else {
        out.push(...entryLines);
      }
    });
    return out;
  }

  if (Array.isArray(value)) {
    // Nested bare arrays are not expected in DSC documents; render defensively
    // as an indented block under the dash.
    if (value.length === 0) return [`${pad}- []`];
    const out = [`${pad}-`];
    for (const item of value) {
      out.push(...yamlArrayItem(item, depth + 1));
    }
    return out;
  }

  return [`${pad}- ${yamlScalar(value)}`];
}

/** Render an object key, quoting it only when it is not a safe plain token. */
function yamlKey(key: string): string {
  return isPlainToken(key) ? key : yamlQuoted(key);
}

/**
 * Render a scalar (string | number | boolean | null). Strings are quoted unless
 * they are safe plain tokens, so values like `Present`, `winget`, or `Git.Git`
 * stay unquoted while paths, spaces, and YAML-significant characters are quoted.
 */
export function yamlScalar(value: string | number | boolean | null): string {
  if (value === null) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error(`Cannot serialize non-finite number to YAML: ${value}`);
    }
    return String(value);
  }
  return isPlainToken(value) ? value : yamlQuoted(value);
}

/**
 * A "plain token" is a string safe to emit unquoted in YAML in both key and
 * value position. Conservative on purpose: letters, digits, and the few
 * punctuation marks common in package ids / DSC type names (`.`, `_`, `+`,
 * `-`, `/`). Anything else (spaces, `:`, backslashes, quotes, leading
 * indicators) gets quoted.
 *
 * Strings that look like other YAML types (numbers, booleans, null) are NOT
 * plain tokens, so `"true"`, `"123"`, and `"null"` round-trip as strings.
 */
function isPlainToken(value: string): boolean {
  if (value.length === 0) return false;
  if (!/^[A-Za-z0-9._+/-]+$/.test(value)) return false;
  // Disambiguate from non-string YAML scalars.
  if (/^[+-]?(\d+\.?\d*|\.\d+)$/.test(value)) return false; // numeric-looking
  if (/^(true|false|null|yes|no|on|off|~)$/i.test(value)) return false; // keyword-looking
  return true;
}

function yamlQuoted(value: string): string {
  // Double-quoted YAML scalar with the escapes that matter for our inputs.
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\t/g, "\\t")
    .replace(/\r/g, "\\r");
  return `"${escaped}"`;
}

function isPlainObject(value: YamlValue): value is { [key: string]: YamlValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}
