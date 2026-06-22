import type { Fragment, NixExpr } from "../core/types.ts";

type NixValue = unknown;
type NixCondition = boolean | string | NixExpr;
type NixStringPart = string | NixExpr;

export interface NixNamespace {
  expr(expr: string): NixExpr;
  pkg: PkgHelper;
  bin(packageName: string, executable: string): NixExpr;
  str(strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
  script: ScriptHelper;
  concat(...parts: NixStringPart[]): NixExpr;
  withPkgs(packages: string[]): NixExpr;
  optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr;
  optionalString(condition: NixCondition, value: NixStringPart): NixExpr;
  isDarwin: NixExpr;
  isLinux: NixExpr;
  lib: {
    mkDefault(value: NixValue): NixExpr;
    mkForce(value: NixValue): NixExpr;
    mkBefore(value: NixValue): NixExpr;
    mkAfter(value: NixValue): NixExpr;
    optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr;
    optionalString(condition: NixCondition, value: NixStringPart): NixExpr;
  };
}

export interface PkgHelper {
  (name: string): NixExpr;
  stable(name: string): NixExpr;
}

export interface ScriptHelper {
  (body: string): NixExpr;
  (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
  raw(strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr;
}

const expr = (value: string): NixExpr => ({ __winixNixExpr: true, expr: value });

const pkg: PkgHelper = Object.assign(
  (name: string): NixExpr => expr(`pkgs.${name}`),
  {
    stable: (name: string): NixExpr => expr(`pkgs.stable.${name}`),
  }
);

const script: ScriptHelper = Object.assign(
  (first: string | TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
    const body =
      typeof first === "string"
        ? first
        : joinTemplate(first, values, (value) =>
            isNixExpr(value) ? `\${${value.expr}}` : String(value)
          );
    return expr(`''\n${trimScript(body)}\n''`);
  },
  {
    raw: (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
      const body = joinRawTemplate(strings, values, (value) =>
        isNixExpr(value) ? `\${${value.expr}}` : String(value)
      );
      return expr(`''\n${trimScript(body)}\n''`);
    },
  }
);

function optionalAttrs(condition: NixCondition, attrs: Record<string, unknown>): NixExpr {
  return expr(`(lib.optionalAttrs ${conditionToNix(condition)} { ${formatAttrs(attrs)} })`);
}

function optionalString(condition: NixCondition, value: NixStringPart): NixExpr {
  return expr(`(lib.optionalString ${conditionToNix(condition)} ${stringPartToNix(value)})`);
}

export const nix: NixNamespace = {
  expr,
  pkg,
  bin: (packageName: string, executable: string): NixExpr =>
    nix.str`${pkg(packageName)}/bin/${executable}`,
  str: (strings: TemplateStringsArray, ...values: NixStringPart[]): NixExpr => {
    const parts: string[] = [];
    const rawStrings = strings.raw;

    for (let index = 0; index < rawStrings.length; index += 1) {
      parts.push(escapeNixDoubleQuoted(rawStrings[index]));
      if (index < values.length) {
        const value = values[index];
        if (isNixExpr(value)) {
          parts.push(`\${${value.expr}}`);
        } else {
          parts.push(escapeNixDoubleQuoted(String(value)));
        }
      }
    }

    return expr(`"${parts.join("")}"`);
  },
  script,
  concat: (...parts: NixStringPart[]): NixExpr =>
    expr(parts.map((part) => stringPartToNix(part)).join(" + ")),
  withPkgs: (packages: string[]): NixExpr => expr(`with pkgs; [ ${packages.join(" ")} ]`),
  optionalAttrs,
  optionalString,
  isDarwin: expr("pkgs.stdenv.isDarwin"),
  isLinux: expr("pkgs.stdenv.isLinux"),
  lib: {
    mkDefault: (value: NixValue): NixExpr => nixLibCall("mkDefault", value),
    mkForce: (value: NixValue): NixExpr => nixLibCall("mkForce", value),
    mkBefore: (value: NixValue): NixExpr => nixLibCall("mkBefore", value),
    mkAfter: (value: NixValue): NixExpr => nixLibCall("mkAfter", value),
    optionalAttrs,
    optionalString,
  },
};

function nixLibCall(name: string, value: NixValue): NixExpr {
  return expr(`lib.${name} ${nixLiteral(value)}`);
}

function stringPartToNix(value: NixStringPart): string {
  return isNixExpr(value) ? value.expr : JSON.stringify(value);
}

function conditionToNix(condition: NixCondition): string {
  if (isNixExpr(condition)) return condition.expr;
  if (typeof condition === "boolean") return condition ? "true" : "false";
  return condition;
}

function nixLiteral(value: NixValue): string {
  if (isNixExpr(value)) return value.expr;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[ ${value.map((item) => nixLiteral(item)).join(" ")} ]`;
  }
  if (isPlainObject(value)) {
    return `{ ${formatAttrs(value)} }`;
  }

  throw new Error(`Cannot convert ${typeof value} to a Nix literal`);
}

function formatAttrs(attrs: Record<string, unknown>): string {
  return Object.entries(attrs)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${formatAttrKey(key)} = ${nixLiteral(value)};`)
    .join(" ");
}

function formatAttrKey(key: string): string {
  return needsQuoting(key) ? JSON.stringify(key) : key;
}

function needsQuoting(key: string): boolean {
  if (NIX_KEYWORDS.has(key)) return true;
  return !/^[a-zA-Z_][a-zA-Z0-9_'-]*$/.test(key);
}

function joinTemplate(
  strings: TemplateStringsArray,
  values: NixStringPart[],
  formatValue: (value: NixStringPart) => string
): string {
  const parts: string[] = [];
  for (let index = 0; index < strings.length; index += 1) {
    parts.push(strings[index]);
    if (index < values.length) {
      parts.push(formatValue(values[index]));
    }
  }
  return parts.join("");
}

function joinRawTemplate(
  strings: TemplateStringsArray,
  values: NixStringPart[],
  formatValue: (value: NixStringPart) => string
): string {
  const parts: string[] = [];
  for (let index = 0; index < strings.raw.length; index += 1) {
    parts.push(strings.raw[index]);
    if (index < values.length) {
      parts.push(formatValue(values[index]));
    }
  }
  return parts.join("");
}

function trimScript(body: string): string {
  return body.replace(/^\n/, "").replace(/\n\s*$/, "");
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const NIX_KEYWORDS = new Set([
  "assert",
  "else",
  "false",
  "if",
  "in",
  "inherit",
  "let",
  "null",
  "or",
  "rec",
  "then",
  "true",
  "with",
]);
