// SDK: helpers exposed to user configs (platform, feature, host, workspace, etc.)

import type {
  Fragment,
  FragmentFactory,
  LazyFragment,
  FragmentEntry,
  InputDef,
  InputWithOptions,
  WorkspaceDef,
  HostDef,
  EvalContext,
} from "../core/types.js";

// --- Evaluation context (implicit, set by evaluator) ---

let _ctx: EvalContext | null = null;

export function setEvalContext(ctx: EvalContext): EvalContext | null {
  const prev = _ctx;
  _ctx = ctx;
  return prev;
}

export function restoreEvalContext(ctx: EvalContext | null): void {
  _ctx = ctx;
}

export function clearEvalContext(): void {
  _ctx = null;
}

function getCtx(): EvalContext {
  if (!_ctx) {
    throw new Error(
      "Fragment evaluated outside of Winix context. " +
      "Use withContext() for testing or ensure the evaluator is running."
    );
  }
  return _ctx;
}

// --- platform() ---

export function platform<T extends unknown[]>(
  id: string,
  factory: (...args: T) => Fragment
): FragmentFactory<T> {
  const fn = ((...args: T): LazyFragment => {
    return {
      __lazy: true,
      __id: id,
      __platform: true,
      __resolve: () => {
        const result = factory(...args);
        return { ...result, __id: id, __platform: true };
      },
    };
  }) as FragmentFactory<T>;

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
  factory: (...args: T) => Fragment | Fragment[]
): FragmentFactory<T> {
  const fn = ((...args: T): LazyFragment => {
    return {
      __lazy: true,
      __id: id,
      __resolve: () => {
        const result = factory(...args);
        if (Array.isArray(result)) {
          return result.map((r) => ({ ...r, __id: r.__id ?? id }));
        }
        return { ...result, __id: id };
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

// --- host() ---

export function host(
  name: string,
  fragments: FragmentEntry[]
): HostDef {
  return { name, fragments };
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

// --- Testing helper ---

export function withContext<R>(
  ctx: { platform: string; hostname?: string; features?: string[] },
  fn: () => R
): R {
  const prev = _ctx;
  _ctx = {
    platform: ctx.platform,
    hostname: ctx.hostname ?? "test",
    activeIds: new Set(ctx.features ?? []),
  };
  try {
    return fn();
  } finally {
    _ctx = prev;
  }
}
