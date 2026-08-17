import type {
  Fragment,
  FragmentEntry,
  HostDef,
  LazyFragment,
  NixExpr,
  RawModuleRef,
  WorkspaceDef,
  EvalContext,
} from "../core/types.ts";
import { collectActiveIds } from "../evaluator/index.ts";
import { restoreEvalContext, setEvalContext } from "../sdk/index.ts";

export interface FragmentRecord {
  label: string;
  fragment: Fragment;
}

export interface HostAnalysis {
  name: string;
  platform: string;
  fragments: FragmentRecord[];
}

export interface Conflict {
  host: string;
  scope: string;
  path: string;
  firstFragment: string;
  secondFragment: string;
  firstValue: string;
  secondValue: string;
}

export interface EscapeReportItem {
  host: string;
  fragment: string;
  scope: string;
  path: string;
  kind: "escape" | "raw" | "rawModule";
}

export interface SuspiciousNixReference {
  host: string;
  fragment: string;
  scope: string;
  path: string;
  reference: string;
  recommendation: string;
}

export function analyzeWorkspace(workspace: WorkspaceDef): HostAnalysis[] {
  return workspace.hosts.map((host) => analyzeHost(host));
}

export function findDuplicateHosts(workspace: WorkspaceDef): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const host of workspace.hosts) {
    if (seen.has(host.name)) duplicates.add(host.name);
    seen.add(host.name);
  }
  return [...duplicates];
}

export function detectConflicts(analyses: HostAnalysis[]): Conflict[] {
  const conflicts: Conflict[] = [];

  for (const analysis of analyses) {
    const seen = new Map<string, { fragment: string; value: unknown; formatted: string }>();

    for (const record of analysis.fragments) {
      for (const scope of ["nixos", "homeManager", "darwin"] as const) {
        const data = record.fragment[scope];
        if (!data) continue;
        for (const leaf of walkLeaves(data)) {
          if (Array.isArray(leaf.value)) continue;
          if (leaf.path[0] === "__raw" || leaf.path[0] === "imports") continue;
          const key = `${scope}:${leaf.path.join(".")}`;
          const formatted = formatValue(leaf.value);
          const previous = seen.get(key);
          if (previous && previous.formatted !== formatted) {
            conflicts.push({
              host: analysis.name,
              scope,
              path: leaf.path.join("."),
              firstFragment: previous.fragment,
              secondFragment: record.label,
              firstValue: previous.formatted,
              secondValue: formatted,
            });
          } else if (!previous) {
            seen.set(key, { fragment: record.label, value: leaf.value, formatted });
          }
        }
      }
    }
  }

  return conflicts;
}

export function collectEscapeReport(analyses: HostAnalysis[]): EscapeReportItem[] {
  const items: EscapeReportItem[] = [];

  for (const analysis of analyses) {
    for (const record of analysis.fragments) {
      for (const scope of ["nixos", "homeManager", "darwin"] as const) {
        const data = record.fragment[scope];
        if (!data) continue;
        collectEscapeItems(analysis.name, record.label, scope, [], data, items);
      }
    }
  }

  return items;
}

export function collectSuspiciousNixReferences(
  analyses: HostAnalysis[]
): SuspiciousNixReference[] {
  const items: SuspiciousNixReference[] = [];

  for (const analysis of analyses) {
    for (const record of analysis.fragments) {
      for (const scope of ["nixos", "homeManager", "darwin"] as const) {
        const data = record.fragment[scope];
        if (!data) continue;
        collectSuspiciousReferenceItems(
          analysis.name,
          record.label,
          scope,
          [],
          data,
          items
        );
      }
    }
  }

  return items;
}

function analyzeHost(host: HostDef): HostAnalysis {
  const platform = host.platform.__id;
  const activeIds = collectActiveIds(host);
  const ctx: EvalContext = { platform, hostname: host.name, activeIds };
  const prev = setEvalContext(ctx);
  const fragments: FragmentRecord[] = [];

  try {
    resolveEntry(host.platform, host.platform.__id, fragments);
    host.fragments.forEach((entry, index) => {
      resolveEntry(entry, labelForEntry(entry, index), fragments);
    });
  } finally {
    restoreEvalContext(prev);
  }

  return { name: host.name, platform, fragments };
}

function resolveEntry(entry: unknown, label: string, out: FragmentRecord[]): void {
  if (isLazy(entry)) {
    const resolved = entry.__resolve();
    if (Array.isArray(resolved)) {
      resolved.forEach((item, index) => resolveEntry(item, `${entry.__id}[${index}]`, out));
    } else {
      resolveEntry(resolved, entry.__id, out);
    }
  } else if (Array.isArray(entry)) {
    entry.forEach((item, index) => resolveEntry(item, `${label}[${index}]`, out));
  } else if (typeof entry === "object" && entry !== null) {
    const fragment = entry as Fragment;
    out.push({ label: fragment.__id ?? label, fragment });
  }
}

function labelForEntry(entry: FragmentEntry, index: number): string {
  if (isLazy(entry)) return entry.__id;
  if (Array.isArray(entry)) return `inline[${index}]`;
  return (entry as Fragment).__id ?? `inline[${index}]`;
}

function walkLeaves(
  value: unknown,
  path: string[] = []
): { path: string[]; value: unknown }[] {
  if (Array.isArray(value) || isNixExpr(value) || isRawModuleRef(value) || !isPlainObject(value)) {
    return [{ path, value }];
  }

  return Object.entries(value).flatMap(([key, child]) => walkLeaves(child, [...path, key]));
}

function collectEscapeItems(
  host: string,
  fragment: string,
  scope: string,
  path: string[],
  value: unknown,
  out: EscapeReportItem[]
): void {
  if (isNixExpr(value)) {
    out.push({ host, fragment, scope, path: path.join(".") || "<root>", kind: "escape" });
    return;
  }

  if (isRawModuleRef(value)) {
    out.push({ host, fragment, scope, path: path.join(".") || "<root>", kind: "rawModule" });
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectEscapeItems(host, fragment, scope, [...path, String(index)], item, out)
    );
    return;
  }

  if (!isPlainObject(value)) return;

  const rawBlocks = value.__raw;
  if (Array.isArray(rawBlocks)) {
    rawBlocks.forEach((_, index) => {
      out.push({
        host,
        fragment,
        scope,
        path: [...path, "__raw", String(index)].join("."),
        kind: "raw",
      });
    });
  }

  for (const [key, child] of Object.entries(value)) {
    if (key === "__raw") continue;
    collectEscapeItems(host, fragment, scope, [...path, key], child, out);
  }
}

function collectSuspiciousReferenceItems(
  host: string,
  fragment: string,
  scope: string,
  path: string[],
  value: unknown,
  out: SuspiciousNixReference[]
): void {
  if (isNixExpr(value) || isRawModuleRef(value)) return;

  if (typeof value === "string") {
    const references = [...value.matchAll(/\$\{((?:config|pkgs|lib)\.[A-Za-z_][A-Za-z0-9_'.-]*)\}/g)];
    for (const match of references) {
      const reference = match[1];
      out.push({
        host,
        fragment,
        scope,
        path: path.join(".") || "<root>",
        reference,
        recommendation: recommendNixHelper(value, match[0], reference),
      });
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      collectSuspiciousReferenceItems(
        host,
        fragment,
        scope,
        [...path, String(index)],
        item,
        out
      )
    );
    return;
  }

  if (!isPlainObject(value)) return;

  for (const [key, child] of Object.entries(value)) {
    if (key === "__raw") continue;
    collectSuspiciousReferenceItems(
      host,
      fragment,
      scope,
      [...path, key],
      child,
      out
    );
  }
}

function recommendNixHelper(value: string, interpolation: string, reference: string): string {
  const homePath = /^\$\{config\.home\.homeDirectory\}\/(.*)$/.exec(value);
  if (homePath) {
    return `Use nix.homePath(${JSON.stringify(homePath[1])}).`;
  }

  const packagePath = /^\$\{pkgs\.([A-Za-z_][A-Za-z0-9_'.-]*)\}\/(.*)$/.exec(value);
  if (packagePath) {
    return `Use nix.pkgPath(${JSON.stringify(packagePath[1])}, ${JSON.stringify(packagePath[2])}).`;
  }

  if (value === interpolation) {
    return `Use nix.expr(${JSON.stringify(reference)}).`;
  }

  return "Use nix.str with nix.expr() interpolation, or nix.expr() for a complete Nix expression.";
}

function formatValue(value: unknown): string {
  if (isNixExpr(value)) return value.expr;
  if (isRawModuleRef(value)) return `rawModule:${value.path}`;
  return JSON.stringify(value);
}

function isLazy(entry: unknown): entry is LazyFragment {
  return typeof entry === "object" && entry !== null && (entry as LazyFragment).__lazy === true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNixExpr(value: unknown): value is NixExpr {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as NixExpr).__winixNixExpr === true
  );
}

function isRawModuleRef(value: unknown): value is RawModuleRef {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as RawModuleRef).__winixRawModule === true
  );
}
