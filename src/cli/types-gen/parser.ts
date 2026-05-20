export interface RawOptionEntry {
  type?: string;
  loc?: unknown;
  visible?: boolean | string;
  internal?: boolean;
}

export interface ParsedOption {
  path: string[];
  tsType: string;
  nixType: string;
}

export type OptionsJson = Record<string, RawOptionEntry>;

export function parseOptions(options: OptionsJson): ParsedOption[] {
  return Object.entries(options)
    .flatMap(([name, option]) => {
      if (option.internal === true || option.visible === false || option.visible === "false") {
        return [];
      }
      const path = getOptionPath(name, option);
      if (path.length === 0) return [];
      const nixType = option.type ?? "unknown";
      return [{ path, tsType: nixTypeToTs(nixType), nixType }];
    })
    .sort((a, b) => a.path.join(".").localeCompare(b.path.join(".")));
}

export function nixTypeToTs(type: string): string {
  const normalized = normalizeType(type);

  // Null wrapper: "null or X"
  const nullInner = matchWrapper(normalized, "null or ");
  if (nullInner) return `${nixTypeToTs(nullInner)} | null`;

  // List wrapper: "list of X"
  const listInner = matchWrapper(normalized, "list of ");
  if (listInner) {
    const innerType = nixTypeToTs(listInner);
    const listType = `${parenthesizeUnion(innerType)}[]`;
    return innerType === "PackageRef" ? `${listType} | NixExpr` : listType;
  }

  // Non-empty list: "non-empty (list of X)"
  const nonEmptyList = /^non-empty \(list of (.+)\)$/.exec(normalized);
  if (nonEmptyList) {
    const innerType = nixTypeToTs(nonEmptyList[1]);
    return `${parenthesizeUnion(innerType)}[]`;
  }

  // Attribute set: "attribute set of X" / "lazy attribute set of X"
  const attrsInner = matchAttrSet(normalized);
  if (attrsInner) {
    if (attrsInner.includes("submodule")) return "Record<string, unknown>";
    return `Record<string, ${nixTypeToTs(attrsInner)}>`;
  }

  // Enum: "one of ..."
  const enumType = parseEnum(normalized);
  if (enumType) return enumType;

  // Singular enum: 'value "X" (singular enum)'
  const singularEnum = /^value "([^"]+)" \(singular enum\)$/.exec(normalized);
  if (singularEnum) return JSON.stringify(singularEnum[1]);

  // "X or Y" unions (must come after null/list/attrs which also use "or")
  const orUnion = parseOrUnion(normalized);
  if (orUnion) return orUnion;

  // "X convertible to it" — strip the suffix and parse the base type
  const convertible = /^(.+?)\s+convertible to it$/.exec(normalized);
  if (convertible) return nixTypeToTs(convertible[1]);

  // Boolean
  if (normalized === "boolean") return "boolean";

  // Integer variants
  if (
    normalized === "signed integer" ||
    normalized === "unsigned integer" ||
    /^(positive|nonnegative|nonzero)\s+(signed |unsigned )?integer/.test(normalized) ||
    /^\d+ bit unsigned integer/.test(normalized) ||
    /^integer of at least/.test(normalized) ||
    normalized.includes("integer between") ||
    /^unsigned integer, meaning/.test(normalized) ||
    /^positive integer, meaning/.test(normalized) ||
    /^nonzero signed integer/.test(normalized)
  ) {
    return "number";
  }

  // Float variants
  if (
    normalized === "floating point number" ||
    /^(positive |nonnegative )?floating point number/.test(normalized) ||
    /^(positive |nonnegative )?integer or floating point number/.test(normalized) ||
    normalized === "signed integer or floating point number" ||
    /^integer or floating point number between/.test(normalized) ||
    /^floating point number or/.test(normalized)
  ) {
    return "number";
  }

  // String variants
  if (
    normalized === "string" ||
    /^strings concatenated with/.test(normalized) ||
    normalized === "absolute path" ||
    normalized === "path" ||
    /^string matching the pattern/.test(normalized) ||
    /^string \(with check:/.test(normalized) ||
    /^string containing/.test(normalized) ||
    /^string of the form/.test(normalized) ||
    /^string starting with/.test(normalized) ||
    /^single-line string/.test(normalized) ||
    /^\(optionally newline-terminated\) single-line string$/.test(normalized) ||
    normalized === "non-empty string" ||
    /^non-empty string/.test(normalized) ||
    /^string, not containing/.test(normalized) ||
    /^printable string/.test(normalized) ||
    /^absolute path,/.test(normalized) ||
    /^absolute path not in/.test(normalized) ||
    normalized === "file mode string" ||
    normalized === "session name" ||
    /^Go duration/.test(normalized) ||
    normalized === "IPv4 or IPv6 address" ||
    normalized === "Network prefix in CIDR notation" ||
    /^key ID prefixed with/.test(normalized) ||
    /^tmpfiles\.d/.test(normalized)
  ) {
    return "string";
  }

  // Package variants
  if (normalized === "package") return "PackageRef";
  if (/^package or absolute path$/.test(normalized)) return "PackageRef";

  // Serialized value types (JSON, YAML, TOML, etc.) → Record is more useful than unknown
  if (
    normalized === "JSON value" ||
    normalized === "YAML 1.1 value" ||
    normalized === "TOML value" ||
    normalized === "HOCON value" ||
    normalized === "raw value" ||
    normalized === "Elixir value" ||
    normalized === "nixpkgs config" ||
    /config type/.test(normalized) ||
    /^section of an INI/.test(normalized) ||
    normalized === "systemd option" ||
    /^value coercible to/.test(normalized) ||
    /config stanza/.test(normalized) ||
    /records value/.test(normalized) ||
    /^libconfig configuration/.test(normalized) ||
    /^`.*` configuration type/.test(normalized)
  ) {
    return "Record<string, unknown>";
  }

  // Submodule
  if (normalized.includes("submodule")) return "Record<string, unknown>";

  // Attribute set (bare)
  if (normalized === "attribute set") return "Record<string, unknown>";

  // "anything" / "unspecified value"
  if (normalized === "anything") return "unknown";
  if (normalized === "unspecified value") return "unknown";

  // Catch-all patterns that are "complex" but essentially record-like
  if (/^Toplevel NixOS config$/.test(normalized)) return "Record<string, unknown>";
  if (/^An evaluation of Nixpkgs/.test(normalized)) return "unknown";
  if (/^attribute-tagged union/.test(normalized)) return "Record<string, unknown>";
  if (/^(function that evaluates to|Json value or lambda)/.test(normalized)) return "unknown";

  // Pair types → tuples (approximate as arrays)
  if (/^pair of/.test(normalized)) return "number[]";

  // Secret value → string (it's always a path or string reference)
  if (normalized === "secret value") return "string";

  // "one of the available ..." → string (dynamic enum)
  if (/^one of the available/.test(normalized)) return "string";

  // "boolean or null or X" patterns
  if (/^boolean or null/.test(normalized)) return "boolean | null | string";

  // Fallback
  return "unknown";
}

/**
 * Parse "X or Y" style unions that aren't handled by the specific prefix matchers.
 * Returns null if this doesn't look like a parseable union.
 */
function parseOrUnion(normalized: string): string | null {
  // Common patterns: "string or boolean", "absolute path or string", "boolean or string"
  // "string or list of string", "string or signed integer", "package or absolute path"
  // "string or (attribute set)", "(list of string) or string"
  // Must exclude things like "one of ..." and "attribute set of ..."

  // Skip if it starts with known prefixes that use "or" differently
  if (/^(null or |list of |non-empty |attribute set|lazy attribute|one of )/.test(normalized)) {
    return null;
  }

  // Handle paren-wrapped types that start with "(" — these are unions like
  // "(list of string) or string", "(attribute set of X) or Y"
  if (normalized.startsWith("(")) {
    const parts = splitOr(normalized);
    if (parts.length >= 2) {
      const tsTypes = parts.map((p) => nixTypeToTs(p.trim()));
      if (!tsTypes.some((t) => t === "unknown")) {
        return [...new Set(tsTypes)].join(" | ");
      }
    }
    return null;
  }

  // Try to split on " or " but be careful of nested parens
  const parts = splitOr(normalized);
  if (parts.length < 2) return null;

  // Parse each part
  const tsTypes = parts.map((p) => nixTypeToTs(p.trim()));
  // If any part resolved to "unknown", don't emit a broken union
  if (tsTypes.some((t) => t === "unknown")) return null;

  const deduped = [...new Set(tsTypes)];
  return deduped.join(" | ");
}

/**
 * Split on top-level " or " (not inside parentheses).
 */
function splitOr(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";

  const words = type.split(" ");
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "or" && depth === 0 && current.trim()) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    for (const ch of word) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
    }
    current += (current ? " " : "") + word;
  }
  if (current.trim()) parts.push(current.trim());

  return parts.length >= 2 ? parts : [];
}

function getOptionPath(name: string, option: RawOptionEntry): string[] {
  if (Array.isArray(option.loc) && option.loc.every((segment) => typeof segment === "string")) {
    return option.loc as string[];
  }
  return name.split(".").filter(Boolean);
}

function normalizeType(type: string): string {
  return type.replace(/\s+/g, " ").trim();
}

function matchWrapper(type: string, prefix: string): string | null {
  if (!type.startsWith(prefix)) return null;
  return stripOuterParens(type.slice(prefix.length).trim());
}

function matchAttrSet(type: string): string | null {
  const prefixes = ["attribute set of ", "attribute sets of ", "lazy attribute set of "];
  for (const prefix of prefixes) {
    if (type.startsWith(prefix)) {
      return stripOuterParens(type.slice(prefix.length).trim());
    }
  }
  return null;
}

function stripOuterParens(value: string): string {
  if (value.startsWith("(") && value.endsWith(")")) {
    return value.slice(1, -1).trim();
  }
  return value;
}

function parenthesizeUnion(type: string): string {
  return type.includes(" | ") ? `(${type})` : type;
}

function parseEnum(type: string): string | null {
  const match = /^one of (.+)$/.exec(type);
  if (!match) return null;

  // Try quoted strings first
  const quotedValues = [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((value) =>
    JSON.stringify(value[1].replace(/\\"/g, "\""))
  );
  if (quotedValues.length > 0) return [...new Set(quotedValues)].sort().join(" | ");

  // Try numeric values: "one of 0, 1, 2"
  const numericValues = [...match[1].matchAll(/\b(\d+)\b/g)].map((m) => m[1]);
  if (numericValues.length > 0) return "number";

  return null;
}
