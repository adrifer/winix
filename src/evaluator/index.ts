// Evaluator: takes a workspace config, evaluates fragments per host, produces merged IR

import type { Fragment, FragmentEntry, HostDef, LazyFragment, NixExpr, RawModuleRef, WorkspaceDef, EvalContext } from "../core/types.ts";
import { setEvalContext, restoreEvalContext } from "../sdk/index.ts";

/**
 * Evaluated host: the merged result of all fragments for one host.
 */
export interface EvaluatedHost {
  name: string;
  nixos: Record<string, unknown>;
  homeManager: Record<string, unknown>;
  darwin: Record<string, unknown>;
}

/**
 * Evaluate a workspace: process each host's fragments and merge them.
 */
export function evaluate(workspace: WorkspaceDef): EvaluatedHost[] {
  return workspace.hosts.map((host) => evaluateHost(host));
}

function evaluateHost(host: HostDef): EvaluatedHost {
  // The platform is always host.platform (exactly one, guaranteed by type system)
  const platformEntry = host.platform;
  const allEntries: FragmentEntry[] = [platformEntry, ...host.fragments];

  const platformId = platformEntry.__id;
  const activeIds = collectActiveIds(host);

  // Pass 2: set context → resolve lazy fragments (now .isActive works)
  const ctx: EvalContext = {
    platform: platformId,
    hostname: host.name,
    activeIds,
  };

  const prevCtx = setEvalContext(ctx);

  const resolvedFragments: Fragment[] = [];

  try {
    for (const entry of allEntries) {
      resolveEntry(entry, resolvedFragments);
    }
  } finally {
    restoreEvalContext(prevCtx);
  }

  // Pass 3: merge all fragments
  const result: EvaluatedHost = {
    name: host.name,
    nixos: {},
    homeManager: {},
    darwin: {},
  };

  for (const fragment of resolvedFragments) {
    if (fragment.nixos && shouldMergeScope(resolvedFragments, "nixos")) {
      result.nixos = deepMerge(result.nixos, fragment.nixos);
    }
    if (fragment.homeManager) {
      result.homeManager = deepMerge(result.homeManager, fragment.homeManager);
    }
    if (fragment.darwin && shouldMergeScope(resolvedFragments, "darwin")) {
      result.darwin = deepMerge(result.darwin, fragment.darwin);
    }
  }

  return result;
}

function shouldMergeScope(
  fragments: Fragment[],
  scope: "nixos" | "darwin"
): boolean {
  const platformFragments = fragments.filter((fragment) => fragment.__platform);
  if (platformFragments.length === 0) return true;
  return platformFragments.some((fragment) => Boolean(fragment[scope]));
}

function isLazy(entry: unknown): entry is LazyFragment {
  return typeof entry === "object" && entry !== null && "__lazy" in entry && (entry as any).__lazy === true;
}

export function collectActiveIds(host: HostDef): Set<string> {
  const activeIds = new Set<string>([host.platform.__id]);
  let previousSize = -1;
  let iterations = 0;

  while (activeIds.size !== previousSize) {
    previousSize = activeIds.size;
    iterations += 1;
    if (iterations > 100) {
      throw new Error(
        `Could not stabilize active fragment IDs for host "${host.name}". ` +
          "Check for fragments that generate new fragment IDs dynamically."
      );
    }

    const ctx: EvalContext = {
      platform: host.platform.__id,
      hostname: host.name,
      activeIds,
    };
    const prevCtx = setEvalContext(ctx);
    try {
      collectIds(host.platform, activeIds);
      for (const entry of host.fragments) {
        collectIds(entry, activeIds);
      }
    } finally {
      restoreEvalContext(prevCtx);
    }
  }

  return activeIds;
}

function collectIds(entry: unknown, activeIds: Set<string>): void {
  if (isLazy(entry)) {
    activeIds.add(entry.__id);
    collectIds(entry.__resolve(), activeIds);
  } else if (Array.isArray(entry)) {
    for (const item of entry) {
      collectIds(item, activeIds);
    }
  } else if (typeof entry === "object" && entry !== null) {
    const fragment = entry as Fragment;
    if (fragment.__id) {
      activeIds.add(fragment.__id);
    }
  }
}

/**
 * Recursively resolve a fragment entry. Handles:
 * - LazyFragment → resolve, then recurse (may return Fragment[] with more lazies)
 * - Fragment[] → recurse each
 * - Fragment → push directly
 */
function resolveEntry(entry: unknown, out: Fragment[]): void {
  if (isLazy(entry)) {
    const result = entry.__resolve();
    if (Array.isArray(result)) {
      for (const item of result) {
        resolveEntry(item, out);
      }
    } else {
      resolveEntry(result, out);
    }
  } else if (Array.isArray(entry)) {
    for (const item of entry) {
      resolveEntry(item, out);
    }
  } else if (typeof entry === "object" && entry !== null) {
    out.push(entry as Fragment);
  }
}

/**
 * Deep merge two objects. Arrays are appended + deduped.
 * Scalars: last wins.
 */
export function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...target };

  for (const key of Object.keys(source)) {
    const targetVal = target[key];
    const sourceVal = source[key];

    if (sourceVal === undefined) {
      continue;
    }

    if (Array.isArray(sourceVal)) {
      if (Array.isArray(targetVal)) {
        // Append + dedupe
        const merged = [...targetVal, ...sourceVal];
        result[key] = [...new Set(merged)];
      } else {
        result[key] = sourceVal;
      }
    } else if (isPlainObject(sourceVal) && isPlainObject(targetVal)) {
      // Deep merge objects
      result[key] = deepMerge(
        targetVal as Record<string, unknown>,
        sourceVal as Record<string, unknown>
      );
    } else {
      // Scalar: last wins
      result[key] = sourceVal;
    }
  }

  return result;
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return (
    typeof val === "object" &&
    val !== null &&
    !Array.isArray(val) &&
    !isNixExpr(val) &&
    !isRawModuleRef(val)
  );
}

function isNixExpr(val: unknown): val is NixExpr {
  return (
    typeof val === "object" &&
    val !== null &&
    (val as NixExpr).__winixNixExpr === true &&
    typeof (val as NixExpr).expr === "string"
  );
}

function isRawModuleRef(val: unknown): val is RawModuleRef {
  return (
    typeof val === "object" &&
    val !== null &&
    (val as RawModuleRef).__winixRawModule === true &&
    typeof (val as RawModuleRef).path === "string"
  );
}
