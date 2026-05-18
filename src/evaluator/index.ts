// Evaluator: takes a workspace config, evaluates fragments per host, produces merged IR

import type { Fragment, FragmentEntry, HostDef, LazyFragment, WorkspaceDef, EvalContext } from "../core/types.js";
import { setEvalContext, clearEvalContext } from "../sdk/index.js";

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
  // Pass 1: scan lazy descriptors to collect IDs and determine platform
  const activeIds = new Set<string>();
  let platformId = "";

  for (const entry of host.fragments) {
    if (isLazy(entry)) {
      activeIds.add(entry.__id);
      if (entry.__platform) {
        platformId = entry.__id;
      }
    } else if (isFragment(entry) && entry.__id) {
      activeIds.add(entry.__id);
      if (entry.__platform) {
        platformId = entry.__id;
      }
    }
  }

  // Pass 2: set context → resolve lazy fragments (now .isActive works)
  const ctx: EvalContext = {
    platform: platformId,
    hostname: host.name,
    activeIds,
  };

  setEvalContext(ctx);

  const resolvedFragments: Fragment[] = [];

  for (const entry of host.fragments) {
    if (isLazy(entry)) {
      const result = entry.__resolve();
      if (Array.isArray(result)) {
        resolvedFragments.push(...result);
      } else {
        resolvedFragments.push(result);
      }
    } else if (Array.isArray(entry)) {
      resolvedFragments.push(...entry);
    } else {
      resolvedFragments.push(entry);
    }
  }

  clearEvalContext();

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

function isLazy(entry: FragmentEntry): entry is LazyFragment {
  return typeof entry === "object" && entry !== null && "__lazy" in entry && entry.__lazy === true;
}

function isFragment(entry: FragmentEntry): entry is Fragment {
  return typeof entry === "object" && entry !== null && !Array.isArray(entry) && !("__lazy" in entry);
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
