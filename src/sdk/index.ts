// SDK: helpers exposed to user configs (platform, feature, host, workspace, etc.)

import { posix as pathPosix } from "node:path";
import { createWinixContext, type WinixContext } from "./context.ts";
import { withCollector, wasCollected } from "./collector.ts";
import type {
  Fragment,
  FragmentFactory,
  PlatformFactory,
  ProfileFactory,
  LazyFragment,
  PlatformLazyFragment,
  FragmentEntry,
  FragmentResult,
  AuthoringResult,
  InputDef,
  InputWithOptions,
  WorkspaceDef,
  HostDef,
  EvalContext,
  NixExpr,
  RawModuleRef,
} from "../core/types.ts";

// --- Evaluation context (implicit, set by evaluator) ---

const G = globalThis as { __winixEvalContext?: EvalContext | null };

export function setEvalContext(ctx: EvalContext): EvalContext | null {
  const prev = G.__winixEvalContext ?? null;
  G.__winixEvalContext = ctx;
  return prev;
}

export function restoreEvalContext(ctx: EvalContext | null): void {
  G.__winixEvalContext = ctx;
}

export function clearEvalContext(): void {
  G.__winixEvalContext = null;
}

function getCtx(): EvalContext {
  const ctx = G.__winixEvalContext ?? null;
  if (!ctx) {
    throw new Error(
      "Fragment evaluated outside of Winix context. " +
      "Use withContext() for testing or ensure the evaluator is running."
    );
  }
  return ctx;
}

export function getEvalContext(): EvalContext {
  return getCtx();
}

export function getOptionalEvalContext(): EvalContext | null {
  return G.__winixEvalContext ?? null;
}

// --- platform() ---

export function platform<T extends unknown[]>(
  id: string,
  factory: (...args: T) => Fragment
): PlatformFactory<T> {
  const fn = ((...args: T): PlatformLazyFragment => {
    return {
      __lazy: true,
      __id: id,
      __platform: true,
      __resolve: () => {
        const result = factory(...args);
        return { ...result, __id: id, __platform: true };
      },
    };
  }) as PlatformFactory<T>;

  Object.defineProperty(fn, "isActive", {
    get: () => getCtx().platform === id,
    configurable: true,
    enumerable: false,
  });

  Object.defineProperty(fn, "id", { value: id, configurable: true, enumerable: false });

  return fn;
}

// --- feature() ---

export function feature<T extends unknown[]>(
  id: string,
  factory: (ctx: WinixContext, ...args: T) => AuthoringResult
): FragmentFactory<T> {
  const fn = ((...args: T): LazyFragment => {
    return {
      __lazy: true,
      __id: id,
      __resolve: () => {
        const ctx = createWinixContext();
        let returned: AuthoringResult = undefined;
        const effects = withCollector(() => {
          returned = factory(ctx, ...args);
        });
        const result = mergeEffectsAndReturn(effects, returned);
        return annotateResult(result, id);
      },
    };
  }) as FragmentFactory<T>;

  Object.defineProperty(fn, "isActive", {
    get: () => getCtx().activeIds.has(id),
    configurable: true,
    enumerable: false,
  });

  Object.defineProperty(fn, "id", { value: id, configurable: true, enumerable: false });

  return fn;
}

// --- profile() ---
//
// Unlike feature(), a profile is intentionally restricted: it only accepts an
// array of entries (instantiated features/profiles and bare fragments such as
// overlay.stable(...) or nixos.boot(...)). It does NOT accept an authoring
// callback, so a profile cannot declare by effect or take injected context.
// The model is: features declare (effects/return), profiles group features.
// If a grouping needs logic or injected namespaces, put that logic in a
// feature() and add that feature to the profile's array.
export function profile(
  id: string,
  entries: readonly FragmentEntry[]
): ProfileFactory<[]> {
  if (typeof entries === "function") {
    throw new TypeError(
      `profile("${id}", ...) only accepts an array of entries, not a callback. ` +
        `Profiles group features; they cannot declare by effect or take injected ` +
        `context. Move that logic into a feature() and add it to the array: ` +
        `profile("${id}", [myFeature(), ...]).`
    );
  }
  if (!Array.isArray(entries)) {
    throw new TypeError(
      `profile("${id}", ...) expects an array of entries, e.g. ` +
        `profile("${id}", [featureA(), featureB()]).`
    );
  }

  return feature(id, () => entries) as ProfileFactory<[]>;
}

// --- host() ---

export function host(
  name: string,
  platform: PlatformLazyFragment,
  fragments: readonly FragmentEntry[]
): HostDef;
export function host(
  name: string,
  platform: PlatformLazyFragment,
  body: (ctx: WinixContext) => AuthoringResult
): HostDef;
export function host(
  name: string,
  platform: PlatformLazyFragment,
  fragmentsOrBody: readonly FragmentEntry[] | ((ctx: WinixContext) => AuthoringResult)
): HostDef {
  if (typeof fragmentsOrBody === "function") {
    // Callback form: wrap the body in an anonymous feature-like lazy fragment so
    // it resolves under the host's eval context (and, in later layers, its
    // handle collector). The body declares via the injected context and/or
    // returns fragments.
    const body = fragmentsOrBody;
    const lazy: LazyFragment = {
      __lazy: true,
      __id: `${name}:inline`,
      __resolve: () => {
        const ctx = createWinixContext();
        let returned: AuthoringResult = undefined;
        const effects = withCollector(() => {
          returned = body(ctx);
        });
        return mergeEffectsAndReturn(effects, returned);
      },
    };
    return { name, platform, fragments: [lazy] };
  }
  return { name, platform, fragments: fragmentsOrBody };
}

// --- workspace() ---

export function workspace(def: WorkspaceDef): WorkspaceDef {
  return def;
}

// --- input() ---

export function input(url: string, opts?: Omit<InputWithOptions, "url">): InputWithOptions {
  return { url, ...opts };
}

// --- defineInputs() ---

export function defineInputs<T extends Record<string, InputDef>>(inputs: T): T {
  return inputs;
}

export interface RawModuleHelper {
  (path: string): Fragment;
  homeManager(path: string): Fragment;
  darwin(path: string): Fragment;
}

export const rawModule: RawModuleHelper = Object.assign(
  (path: string): Fragment => ({
    nixos: { imports: [createRawModuleRef(path)] },
  }),
  {
    homeManager: (path: string): Fragment => ({
      homeManager: { imports: [createRawModuleRef(path)] },
    }),
    darwin: (path: string): Fragment => ({
      darwin: { imports: [createRawModuleRef(path)] },
    }),
  }
);

export function escape(expr: string): NixExpr {
  return {
    __winixNixExpr: true,
    expr,
  };
}

/**
 * Combine fragments declared by effect with whatever the body returned.
 *
 * - Effect-only body (no return / returns undefined): just the effects.
 * - Return-only body (legacy, no effects collected): just the return value,
 *   so existing `() => home.program(...)` features behave exactly as before.
 * - Mixed: effects first (declaration order), then any returned entries that
 *   were NOT already captured as effects (dedupe via wasCollected), so
 *   `return home.program(...)` does not double-count.
 */
function mergeEffectsAndReturn(
  effects: Fragment[],
  returned: AuthoringResult
): FragmentResult {
  const hasReturn = returned !== undefined && returned !== null;
  if (effects.length === 0) {
    // Legacy path: nothing registered by effect, pass the return through as-is.
    return hasReturn ? returned! : [];
  }
  if (!hasReturn) {
    return effects;
  }
  const extraFromReturn = filterUncollected(returned!);
  return [...effects, ...extraFromReturn];
}

/**
 * Flatten a FragmentResult into entries that were not already collected by
 * effect. Preserves lazy entries (they resolve later) and arrays.
 */
function filterUncollected(result: FragmentResult): FragmentEntry[] {
  const entries = Array.isArray(result) ? result : [result];
  const out: FragmentEntry[] = [];
  for (const entry of entries) {
    if (Array.isArray(entry)) {
      out.push(...filterUncollected(entry));
      continue;
    }
    if (isLazy(entry)) {
      // Lazy entries resolve on their own later; never collected here.
      out.push(entry);
      continue;
    }
    if (!wasCollected(entry)) {
      out.push(entry as FragmentEntry);
    }
  }
  return out;
}

function annotateResult(result: FragmentResult, id: string): FragmentResult {
  if (Array.isArray(result)) {
    return result.map((entry) => annotateEntry(entry, id));
  }
  if (isLazy(result)) {
    return result;
  }
  return annotateFragment(result as Fragment, id);
}

function annotateEntry(entry: FragmentEntry, id: string): FragmentEntry {
  if (Array.isArray(entry)) {
    return entry.map((item) => annotateEntry(item, id));
  }
  if (isLazy(entry)) {
    return entry;
  }
  return annotateFragment(entry as Fragment, id);
}

function annotateFragment(fragment: Fragment, id: string): Fragment {
  return { ...fragment, __id: fragment.__id ?? id };
}

function isLazy(entry: unknown): entry is LazyFragment {
  return (
    typeof entry === "object" &&
    entry !== null &&
    (entry as LazyFragment).__lazy === true
  );
}

function createRawModuleRef(path: string): RawModuleRef {
  return {
    __winixRawModule: true,
    path: normalizeRawModulePath(path),
  };
}

function normalizeRawModulePath(path: string): string {
  if (path.length === 0) {
    throw new Error("rawModule() path must not be empty");
  }
  if (path.includes("\0")) {
    throw new Error("rawModule() path must not contain null bytes");
  }
  if (path.includes("\\") || path.includes(":")) {
    throw new Error("rawModule() path must be a workspace-relative POSIX path");
  }
  if (pathPosix.isAbsolute(path)) {
    throw new Error("rawModule() path must be workspace-relative, not absolute");
  }
  // Allow a leading "./" convenience prefix, but reject "." or ".." elsewhere.
  if (
    path
      .split("/")
      .some(
        (segment, index) =>
          segment === "" || segment === ".." || (segment === "." && index !== 0)
      )
  ) {
    throw new Error("rawModule() path must not escape the workspace");
  }

  const normalized = pathPosix.normalize(path);
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error("rawModule() path must not escape the workspace");
  }
  if (!normalized.endsWith(".nix")) {
    throw new Error("rawModule() path must point to a .nix file");
  }

  return normalized;
}

// --- Testing helper ---

export function withContext<R>(
  ctx: { platform: string; hostname?: string; features?: string[] },
  fn: () => R
): R {
  const prev = G.__winixEvalContext ?? null;
  G.__winixEvalContext = {
    platform: ctx.platform,
    hostname: ctx.hostname ?? "test",
    activeIds: new Set(ctx.features ?? []),
  };
  try {
    return fn();
  } finally {
    G.__winixEvalContext = prev;
  }
}
