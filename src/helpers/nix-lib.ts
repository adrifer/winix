import type { NixExpr } from "../core/types.ts";

export function mkDefault(value: unknown): NixExpr {
  return nixLibCall("mkDefault", value);
}

export function mkForce(value: unknown): NixExpr {
  return nixLibCall("mkForce", value);
}

export function mkBefore(value: unknown): NixExpr {
  return nixLibCall("mkBefore", value);
}

export function mkAfter(value: unknown): NixExpr {
  return nixLibCall("mkAfter", value);
}

function nixLibCall(name: string, value: unknown): NixExpr {
  return { __winixNixExpr: true, expr: `lib.${name} ${nixLiteral(value)}` };
}

function nixLiteral(value: unknown): string {
  if (isNixExpr(value)) return value.expr;
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[ ${value.map((item) => nixLiteral(item)).join(" ")} ]`;
  }
  if (isPlainObject(value)) {
    const attrs = Object.entries(value)
      .filter(([, attrValue]) => attrValue !== undefined)
      .map(([key, attrValue]) => `${formatAttrKey(key)} = ${nixLiteral(attrValue)};`);
    return `{ ${attrs.join(" ")} }`;
  }

  throw new Error(`Cannot convert ${typeof value} to a Nix literal`);
}

function isNixExpr(value: unknown): value is NixExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NixExpr).__winixNixExpr === true
  );
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAttrKey(key: string): string {
  return needsQuoting(key) ? JSON.stringify(key) : key;
}

function needsQuoting(key: string): boolean {
  if (NIX_KEYWORDS.has(key)) return true;
  return !/^[a-zA-Z_][a-zA-Z0-9_'-]*$/.test(key);
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
