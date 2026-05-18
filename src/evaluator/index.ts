// Evaluator: takes a workspace config, evaluates fragments per host, produces merged IR

import type { Fragment, FragmentEntry, HostDef, LazyFragment, WorkspaceDef, EvalContext } from "../core/types.ts";
import { setEvalContext, restoreEvalContext } from "../sdk/index.ts";

/**
 * Evaluated host: the merged result of all fragments for one host.
 */
export interface EvaluatedHost {
  name: string;
  nixos: Record<string, unknown>;
  home: Record<string, unknown>;
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

  // Platform ID is known directly from the platform descriptor
  const platformId = platformEntry.__id;
  const activeIds = new Set<string>();
  activeIds.add(platformId);

  // Collect remaining IDs from fragments
  function collectIds(entry: unknown): void {
    if (isLazy(entry)) {
      activeIds.add(entry.__id);
      try {
        const result = entry.__resolve();
        if (Array.isArray(result)) {
          for (const item of result) {
            collectIds(item);
          }
        } else if (result && typeof result === "object") {
          if ((result as any).__id) {
            activeIds.add((result as any).__id);
          }
        }
      } catch {
        // .isActive may throw without context
      }
    } else if (Array.isArray(entry)) {
      for (const item of entry) {
        collectIds(item);
      }
    } else if (typeof entry === "object" && entry !== null) {
      const f = entry as Fragment;
      if (f.__id) {
        activeIds.add(f.__id);
      }
    }
  }

  for (const entry of host.fragments) {
    collectIds(entry);
  }

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
    home: {},
    darwin: {},
  };

  for (const fragment of resolvedFragments) {
    if (fragment.nixos) {
      result.nixos = deepMerge(result.nixos, fragment.nixos);
    }
    if (fragment.home) {
      result.home = deepMerge(result.home, fragment.home);
    }
    if (fragment.darwin) {
      result.darwin = deepMerge(result.darwin, fragment.darwin);
    }
  }

  return result;
}

function isLazy(entry: unknown): entry is LazyFragment {
  return typeof entry === "object" && entry !== null && "__lazy" in entry && (entry as any).__lazy === true;
}

function isFragment(entry: FragmentEntry): entry is Fragment {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) && !("__lazy" in entry);
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
  return typeof val === "object" && val !== null && !Array.isArray(val);
}
