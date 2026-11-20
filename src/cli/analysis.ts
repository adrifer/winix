import type {
  Fragment,
  FragmentEntry,
  HostDef,
  LazyFragment,
  NixExpr,
  RawModuleRef,
  WorkspaceDef,
  EvaluateOptions,
} from "../core/types.ts";
import { collectActiveIds, hostEvalContext, type EvaluatedHost } from "../evaluator/index.ts";
import { restoreEvalContext, setEvalContext } from "../sdk/index.ts";
import { hasHomeManagerImport } from "../backends/nix/index.ts";

export interface FragmentRecord {
  label: string;
  fragment: Fragment;
  /**
   * Reached through a grouping (a profile, or a feature composing other
   * features) rather than listed on the host itself. Shared groupings are
   * meant to span platforms, so their inapplicable parts are expected.
   */
  composed?: boolean;
  /** For composed records: the host-level entry (usually a profile) they came through. */
  via?: string;
}

export interface HostAnalysis {
  name: string;
  platform: string;
  /** Platform variant, e.g. "wsl" for platforms.wsl(). */
  variant?: string;
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
  /** How to make the definitions combine instead of replacing each other. */
  hint?: string;
}

const NIX_LIST_EXPRESSION = /^\s*(with\s+pkgs\s*;\s*)?\[/;

function isNixListExpression(value: unknown): boolean {
  return typeof value === "object" && value !== null &&
    (value as NixExpr).__winixNixExpr === true &&
    NIX_LIST_EXPRESSION.test((value as NixExpr).expr);
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

export function analyzeWorkspace(workspace: WorkspaceDef, options: EvaluateOptions = {}): HostAnalysis[] {
  return workspace.hosts.map((host) => analyzeHost(host, options));
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

const scopes = ["nixos", "darwin", "homeManager", "windows"] as const;
type Scope = typeof scopes[number];

/** The scopes a host's platform applies; undefined when it has no platform fragment. */
export function applicableScopes(analysis: HostAnalysis, evaluated: EvaluatedHost): Set<Scope> | undefined {
  const platform = analysis.fragments.find(({ fragment }) => fragment.__platform)?.fragment;
  if (!platform) return undefined;
  const applicable = new Set(scopes.filter((scope) => platform[scope]));
  if (!applicable.has("windows") &&
      (hasHomeManagerImport(evaluated) || !["nixos", "darwin"].includes(analysis.platform))) {
    applicable.add("homeManager");
  }
  return applicable;
}

/**
 * Features that contribute nothing on a host's platform. `composed` is true
 * when every part of it came through a shared grouping (see FragmentRecord).
 */
export function collectIgnoredFragments(
  analyses: HostAnalysis[], evaluated: EvaluatedHost[],
): { host: string; fragment: string; scopes: Scope[]; composed: boolean }[] {
  return analyses.flatMap((analysis, index) => {
    const applicable = applicableScopes(analysis, evaluated[index]);
    if (!applicable) return [];

    const byLabel = new Map<string, Set<Scope>>();
    const direct = new Set<string>();
    for (const { label, fragment, composed } of analysis.fragments) {
      if (fragment.__platform) continue;
      if (!composed) direct.add(label);
      const contributed = byLabel.get(label) ?? new Set<Scope>();
      for (const scope of scopes) {
        const data = fragment[scope];
        if (data && walkLeaves(data).some(({ value }) => value !== undefined)) contributed.add(scope);
      }
      byLabel.set(label, contributed);
    }
    return [...byLabel].flatMap(([fragment, contributed]) =>
      contributed.size > 0 && ![...contributed].some((scope) => applicable.has(scope))
        ? [{ host: analysis.name, fragment, scopes: [...contributed], composed: !direct.has(fragment) }]
        : []);
  });
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
              ...(isNixListExpression(previous.value) || isNixListExpression(leaf.value)
                ? {
                  hint: "A list written as one Nix expression (nix.withPkgs, nix.expr) replaces the other; " +
                    "write an array such as [nix.pkg(\"icu\")] so definitions append.",
                }
                : {}),
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

function analyzeHost(host: HostDef, options: EvaluateOptions): HostAnalysis {
  const platform = host.platform.__id;
  const activeIds = collectActiveIds(host, options);
  const prev = setEvalContext(hostEvalContext(host, activeIds, options));
  const fragments: FragmentRecord[] = [];

  try {
    resolveEntry(host.platform, host.platform.__id, fragments);
    host.fragments.forEach((entry, index) => {
      if (isLazy(entry) && entry.__id === `${host.name}:inline`) {
        // host()'s callback form: what it returns is listed on the host itself.
        const resolved = entry.__resolve();
        if (Array.isArray(resolved)) {
          resolved.forEach((item, itemIndex) => resolveEntry(item, `${entry.__id}[${itemIndex}]`, fragments));
        } else {
          resolveEntry(resolved, entry.__id, fragments);
        }
      } else {
        resolveEntry(entry, labelForEntry(entry, index), fragments);
      }
    });
  } finally {
    restoreEvalContext(prev);
  }

  return { name: host.name, platform, ...(host.platform.__variant ? { variant: host.platform.__variant } : {}), fragments };
}

function resolveEntry(entry: unknown, label: string, out: FragmentRecord[], composed = false, via?: string): void {
  if (isLazy(entry)) {
    // Everything under a profile is composed and grouped under the outermost
    // one; features a feature returns are composed but keep their group.
    const group = entry.__group === true;
    const childVia = via ?? (group ? entry.__id : undefined);
    const resolved = entry.__resolve();
    if (Array.isArray(resolved)) {
      resolved.forEach((item, index) =>
        resolveEntry(item, `${entry.__id}[${index}]`, out, composed || group || isLazy(item), childVia));
    } else {
      resolveEntry(resolved, entry.__id, out, composed || group, childVia);
    }
  } else if (Array.isArray(entry)) {
    entry.forEach((item, index) => resolveEntry(item, `${label}[${index}]`, out, composed, via));
  } else if (typeof entry === "object" && entry !== null) {
    const fragment = entry as Fragment;
    out.push({ label: fragment.__id ?? label, fragment, ...(composed ? { composed, ...(via ? { via } : {}) } : {}) });
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
