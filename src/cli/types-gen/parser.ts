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

  const nullInner = matchWrapper(normalized, "null or ");
  if (nullInner) return `${nixTypeToTs(nullInner)} | null`;

  const listInner = matchWrapper(normalized, "list of ");
  if (listInner) return `${parenthesizeUnion(nixTypeToTs(listInner))}[]`;

  const attrsInner = matchAttrSet(normalized);
  if (attrsInner) {
    if (attrsInner.includes("submodule")) return "Record<string, unknown>";
    return `Record<string, ${nixTypeToTs(attrsInner)}>`;
  }

  const enumType = parseEnum(normalized);
  if (enumType) return enumType;

  if (normalized === "boolean") return "boolean";
  if (
    normalized === "signed integer" ||
    normalized === "unsigned integer" ||
    normalized.includes("integer between") ||
    normalized === "floating point number"
  ) {
    return "number";
  }
  if (
    normalized === "string" ||
    normalized === "strings concatenated with \"\\n\"" ||
    normalized === "strings concatenated with newline" ||
    normalized === "absolute path" ||
    normalized === "path"
  ) {
    return "string";
  }
  if (normalized === "package") return "PackageRef";
  if (normalized.includes("submodule")) return "Record<string, unknown>";
  if (normalized === "anything") return "unknown";
  if (normalized === "unspecified value") return "unknown";

  return "unknown";
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
  const prefixes = ["attribute set of ", "attribute sets of "];
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

  const values = [...match[1].matchAll(/"((?:\\.|[^"\\])*)"/g)].map((value) =>
    JSON.stringify(value[1].replace(/\\"/g, "\""))
  );
  if (values.length === 0) return null;

  return [...new Set(values)].sort().join(" | ");
}
