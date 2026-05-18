// SDK: helpers exposed to user configs (platform, feature, host, workspace, etc.)

import { posix as pathPosix } from "node:path";
import type {
  Fragment,
  FragmentFactory,
  PlatformFactory,
  LazyFragment,
  PlatformLazyFragment,
  FragmentEntry,
  InputDef,
  InputWithOptions,
  WorkspaceDef,
  HostDef,
  EvalContext,
  RawModuleRef,
} from "../core/types.ts";

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
  platform: PlatformLazyFragment,
  fragments: FragmentEntry[]
): HostDef {
  return { name, platform, fragments };
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
  home(path: string): Fragment;
  darwin(path: string): Fragment;
}

export const rawModule: RawModuleHelper = Object.assign(
  (path: string): Fragment => ({
    nixos: { imports: [createRawModuleRef(path)] },
  }),
  {
    home: (path: string): Fragment => ({
      home: { imports: [createRawModuleRef(path)] },
    }),
    darwin: (path: string): Fragment => ({
      darwin: { imports: [createRawModuleRef(path)] },
    }),
  }
);

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
