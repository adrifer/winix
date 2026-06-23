#!/usr/bin/env -S npx tsx
/**
 * Generate bundled type definitions for NixOS, Home Manager, and nix-darwin.
 *
 * Usage:
 *   npm run generate:types          # all three
 *   npm run generate:types:nixos    # just NixOS (HTTP download, no nix needed)
 *   npm run generate:types:hm       # just Home Manager (requires nix)
 *   npm run generate:types:darwin   # just nix-darwin (requires nix)
 *
 * NixOS types are downloaded from channels.nixos.org (no nix required).
 * Home Manager and nix-darwin types require `nix` to build their docs-json output.
 */

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseOptions, type OptionsJson } from "../src/cli/types-gen/parser.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUTPUT_DIR = join(ROOT, "types", "bundled");

// --- Constants ---

const MAX_DEPTH = 4;

// --- Config ---

interface SourceConfig {
  name: string;
  /** How to obtain the options.json */
  source:
    | { kind: "http"; url: string }
    | { kind: "nix-build"; flakeRef: string; output: string };
  /** Interface names to emit */
  programsInterface: string;
  servicesInterface: string;
  /** Module to augment */
  augmentModule: string;
}

const SOURCES: SourceConfig[] = [
  {
    name: "nixos",
    source: { kind: "http", url: "https://channels.nixos.org/nixos-unstable/options.json.br" },
    programsInterface: "NixosProgramOptions",
    servicesInterface: "NixosServiceOptions",
    augmentModule: "@adrifer/winix",
  },
  {
    name: "home-manager",
    source: {
      kind: "nix-build",
      flakeRef: "github:nix-community/home-manager",
      output: "docs-json",
    },
    programsInterface: "HomeProgramOptions",
    servicesInterface: "HomeServiceOptions",
    augmentModule: "@adrifer/winix",
  },
  {
    name: "darwin",
    source: {
      kind: "nix-build",
      flakeRef: "github:LnL7/nix-darwin",
      output: "optionsJSON",
    },
    programsInterface: "DarwinProgramOptions",
    servicesInterface: "DarwinServiceOptions",
    augmentModule: "@adrifer/winix",
  },
];

// --- Main ---

const args = process.argv.slice(2);
const targets = args.length > 0 ? args : ["nixos", "home-manager", "darwin"];

await mkdir(OUTPUT_DIR, { recursive: true });

for (const target of targets) {
  const config = SOURCES.find((s) => s.name === target);
  if (!config) {
    console.error(`Unknown target: ${target}. Available: ${SOURCES.map((s) => s.name).join(", ")}`);
    process.exit(1);
  }

  console.log(`\n⏳ Generating ${config.name} types...`);

  try {
    const optionsJson = await fetchOptionsJson(config);
    const parsed = parseOptions(optionsJson);
    const dts = emitBundledTypes(config, parsed);
    const outPath = join(OUTPUT_DIR, `${config.name}.d.ts`);
    await writeFile(outPath, dts);
    console.log(`✓ ${config.name}: ${parsed.length} options → ${outPath}`);
  } catch (err) {
    console.error(`✗ ${config.name}: ${(err as Error).message}`);
    if (config.source.kind === "nix-build") {
      console.error(`  (requires 'nix' to be installed and available in PATH)`);
    }
    process.exit(1);
  }
}

console.log("\n✅ Done!");

// --- Fetch ---

async function fetchOptionsJson(config: SourceConfig): Promise<OptionsJson> {
  if (config.source.kind === "http") {
    return fetchHttpOptions(config.source.url);
  }
  return fetchNixBuildOptions(config.source.flakeRef, config.source.output);
}

async function fetchHttpOptions(url: string): Promise<OptionsJson> {
  const { brotliDecompress } = await import("node:zlib");
  const { promisify } = await import("node:util");
  const decompress = promisify(brotliDecompress);

  console.log(`  Downloading ${url}...`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${url}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  // Check if already decompressed (starts with '{' or '[')
  if (bytes[0] === 0x7b || bytes[0] === 0x5b) {
    return JSON.parse(bytes.toString("utf-8"));
  }

  const decompressed = await decompress(bytes);
  return JSON.parse(decompressed.toString("utf-8"));
}

async function fetchNixBuildOptions(flakeRef: string, output: string): Promise<OptionsJson> {
  console.log(`  Building ${flakeRef}#${output}...`);

  const storePath = execSync(
    `nix build "${flakeRef}#${output}" --no-link --print-out-paths 2>/dev/null`,
    { encoding: "utf-8", timeout: 300_000 }
  ).trim();

  if (!storePath || !existsSync(storePath)) {
    throw new Error(`nix build produced no output for ${flakeRef}#${output}`);
  }

  // The output is typically a directory containing share/doc/home-manager/options.json
  // or just an options.json file directly
  const candidates = [
    join(storePath, "share", "doc", "home-manager", "options.json"),
    join(storePath, "share", "doc", "darwin", "options.json"),
    join(storePath, "share", "doc", "nix-darwin", "options.json"),
    join(storePath, "options.json"),
    storePath, // might be the file itself
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const stat = await import("node:fs").then((fs) => fs.statSync(candidate));
      if (stat.isFile()) {
        console.log(`  Reading ${candidate}...`);
        const content = await readFile(candidate, "utf-8");
        return JSON.parse(content);
      }
    }
  }

  // List what's in the store path for debugging
  const ls = execSync(`find ${storePath} -name "*.json" | head -10`, { encoding: "utf-8" });
  throw new Error(
    `Could not find options.json in nix build output: ${storePath}\nJSON files found:\n${ls}`
  );
}

// --- Emitter ---

interface TypeNode {
  children: Map<string, TypeNode>;
  type?: string;
  overflow?: boolean;
}

function emitBundledTypes(config: SourceConfig, options: ReturnType<typeof parseOptions>): string {
  // Build tree for programs.* and services.*
  const programsRoot: TypeNode = { children: new Map() };
  const servicesRoot: TypeNode = { children: new Map() };

  for (const option of options) {
    if (option.path[0] === "programs" && option.path.length > 1) {
      insertOption(programsRoot, option.path.slice(1), option.tsType);
    } else if (option.path[0] === "services" && option.path.length > 1) {
      insertOption(servicesRoot, option.path.slice(1), option.tsType);
    }
  }

  const lines: string[] = [
    `// Generated by scripts/generate-types.ts from ${config.name} options.`,
    `// Do not edit manually. Re-run: npm run generate:types:${config.name}`,
    ``,
    `import type { NixExpr } from "@adrifer/winix";`,
    ``,
    `declare module "${config.augmentModule}" {`,
  ];

  // Emit programs interface
  if (programsRoot.children.size > 0) {
    lines.push(`  interface ${config.programsInterface} {`);
    for (const [name, node] of [...programsRoot.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const typeBody = emitInlineObject(node, 2);
      lines.push(`    ${quoteProperty(name)}: ${typeBody};`);
    }
    lines.push(`  }`);
  }

  lines.push(``);

  // Emit services interface
  if (servicesRoot.children.size > 0) {
    lines.push(`  interface ${config.servicesInterface} {`);
    for (const [name, node] of [...servicesRoot.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const typeBody = emitInlineObject(node, 2);
      lines.push(`    ${quoteProperty(name)}: ${typeBody};`);
    }
    lines.push(`  }`);
  }

  lines.push(`}`);
  lines.push(``);

  return lines.join("\n");
}

function insertOption(root: TypeNode, path: string[], type: string): void {
  let node = root;
  // Only go MAX_DEPTH - 1 levels deep (since we already stripped the programs/services prefix)
  const emittedPath = path.slice(0, MAX_DEPTH - 1);

  for (const segment of emittedPath) {
    let child = node.children.get(segment);
    if (!child) {
      child = { children: new Map() };
      node.children.set(segment, child);
    }
    node = child;
  }

  if (path.length > MAX_DEPTH - 1) {
    node.overflow = true;
    return;
  }

  node.type = type;
}

function emitInlineObject(node: TypeNode, indent: number): string {
  if (node.children.size === 0 && node.type) return inlineType(node.type);
  if (node.children.size === 0) return "Record<string, unknown>";
  if (node.children.size === 1 && node.children.has("*")) {
    return "Record<string, unknown> | Record<string, unknown>[] | NixExpr";
  }

  const pad = "  ".repeat(indent);
  const innerPad = "  ".repeat(indent + 1);
  const entries: string[] = [];

  for (const [key, child] of [...node.children.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (child.overflow) {
      entries.push(
        `${innerPad}${quoteProperty(key)}?: ${child.children.size > 0 ? emitInlineObject(child, indent + 1) : "Record<string, unknown>"};`
      );
    } else if (child.children.size > 0) {
      entries.push(`${innerPad}${quoteProperty(key)}?: ${emitInlineObject(child, indent + 1)};`);
    } else {
      entries.push(`${innerPad}${quoteProperty(key)}?: ${inlineType(child.type ?? "unknown")};`);
    }
  }

  const recordSuffix = node.overflow ? " & Record<string, unknown>" : "";
  return `{\n${entries.join("\n")}\n${pad}}${recordSuffix}`;
}

function inlineType(type: string): string {
  let result = type
    .replace(/PackageRef\[\] \| NixExpr/g, "(string | NixExpr)[] | NixExpr")
    .replace(/PackageRef\[\]/g, "(string | NixExpr)[] | NixExpr")
    .replace(/PackageRef/g, "string | NixExpr");
  if (/\[\]$/.test(result) && !result.includes("NixExpr")) {
    result = `${result} | NixExpr`;
  }
  if (isStringLike(result) && !result.includes("NixExpr")) {
    result = `${result} | NixExpr`;
  }
  return result;
}

function isStringLike(type: string): boolean {
  return type === "string" || /(^|\| )string($| \|)/.test(type) || /^"[^"]+"( \| "[^"]+")*$/.test(type);
}

function quoteProperty(key: string): string {
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) return key;
  return JSON.stringify(key);
}
