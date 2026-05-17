// Evaluator: takes a workspace config, evaluates fragments per host, produces merged IR

import type { Fragment, HostDef, WorkspaceDef, EvalContext } from "../core/types.js";
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
  // Pass 1: flatten and collect IDs (calling fragment factories)
  // We need context set even for this pass so .isActive works during factory calls
  // First do a quick scan to find the platform
  const quickFlat = flatten(host.fragments);
  const activeIds = new Set<string>();
  let platformId = "";

  for (const f of quickFlat) {
    if (f.__id) {
      activeIds.add(f.__id);
    }
    if (f.__platform && f.__id) {
      platformId = f.__id;
    }
  }

  // Pass 2: set context so .isActive resolves, then collect final fragments
  const ctx: EvalContext = {
    platform: platformId,
    hostname: host.name,
    activeIds,
  };

  setEvalContext(ctx);

  // Re-evaluate fragment factories with context active
  // For now, we just use the already-flattened results since factories
  // were already called. The .isActive getters work at read time.
  // We need to re-call any factories that use .isActive...
  // Actually, fragments in the list are already evaluated (host() receives results).
  // The trick: .isActive is checked when the object LITERAL is evaluated by JS.
  // So we need the context set BEFORE the workspace() call.
  // For the PoC, we accept this limitation and re-flatten.
  const resolvedFragments = flatten(host.fragments);

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

/**
 * Flatten nested fragment arrays into a single list.
 */
function flatten(fragments: (Fragment | Fragment[])[]): Fragment[] {
  const result: Fragment[] = [];
  for (const f of fragments) {
    if (Array.isArray(f)) {
      result.push(...f);
    } else {
      result.push(f);
    }
  }
  return result;
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
