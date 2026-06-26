// Core types for Winix fragments and composition

import type { DarwinOptions, HomeOptions, NixosOptions, WindowsOptions } from "../types/index.ts";

/**
 * The output shape of any fragment. Keys correspond to target scopes.
 * Values are deep-merged by the evaluator according to merge rules.
 */
export interface Fragment {
  nixos?: NixosOptions;
  homeManager?: HomeOptions;
  darwin?: DarwinOptions;
  windows?: WindowsOptions;
  /** Internal: platform/feature ID for .isActive resolution */
  __id?: string;
  /** Internal: marks this as a platform fragment */
  __platform?: boolean;
}

/**
 * Internal reference to a workspace-relative raw Nix module file.
 */
export interface RawModuleRef {
  __winixRawModule: true;
  path: string;
}

/**
 * Internal reference to a verbatim Nix expression.
 */
export interface NixExpr {
  __winixNixExpr: true;
  expr: string;
}

/**
 * Identity of a single emittable resource, used to wire `dependsOn` across
 * declarations within one host. Currently only the Windows backend produces
 * resources with handles.
 *
 * - `package`: identified by its natural, stable package id.
 * - `command`: has no natural id, so it carries a unique token; the emitter
 *   assigns it a generated name (`command-N`) per host.
 */
export type ResourceRef =
  | { kind: "package"; id: string }
  | { kind: "command"; token: symbol };

/**
 * A resource handle: the value returned by resource-producing helpers like
 * `windows.package(...)` / `windows.raw(...)`.
 *
 * It is a normal Fragment (so it still merges and registers as an effect),
 * decorated with `__winixHandle` so it can be passed to another resource's
 * `dependsOn` to express ordering. The handle is opaque to user code; only the
 * emitter reads `__winixHandle` to resolve dependency references to names.
 */
export interface ResourceHandle extends Fragment {
  __winixHandle: ResourceRef;
}

export type ImportRef = string | RawModuleRef;

/**
 * What goes into a host/profile fragment list. Arrays are recursive so profiles
 * can be nested without spread boilerplate.
 */
export type FragmentEntry = LazyFragment | Fragment | readonly FragmentEntry[];

/**
 * What a lazy fragment can resolve into.
 */
export type FragmentResult = FragmentEntry;

/**
 * The return type allowed for *authoring callbacks* (`feature`/`profile`/`host`
 * bodies). It is a `FragmentResult` OR nothing (`void`/`undefined`), because a
 * callback may declare purely by effect through the injected namespaces and
 * return nothing at all:
 *
 * ```ts
 * feature("dev", ({ home }) => { home.program("git"); }); // returns void
 * ```
 *
 * The runtime already treats a `undefined`/`null` return as "no returned
 * content" and falls back to the collected effects (see
 * `mergeEffectsAndReturn`); this type makes the public signatures match that
 * behavior. `FragmentResult` itself stays strict for internal use where a
 * concrete result is always present.
 */
export type AuthoringResult = FragmentResult | void;

/**
 * A lazy fragment descriptor: holds the factory + args for deferred evaluation.
 */
export interface LazyFragment {
  __lazy: true;
  __id: string;
  __platform?: boolean;
  __resolve: () => FragmentResult;
}

/**
 * A platform lazy fragment: branded type to enforce exactly-one-platform in host().
 */
export interface PlatformLazyFragment extends LazyFragment {
  __platform: true;
}

/**
 * A fragment factory: callable to produce a LazyFragment, with .isActive getter.
 */
export interface FragmentFactory<T extends unknown[] = []> {
  (...args: T): LazyFragment;
  readonly isActive: boolean;
  readonly id: string;
}

/**
 * A profile factory: a semantic alias for composite fragments.
 */
export interface ProfileFactory<T extends unknown[] = []> extends FragmentFactory<T> {}

/**
 * A platform factory: callable to produce a PlatformLazyFragment, with .isActive getter.
 */
export interface PlatformFactory<T extends unknown[] = []> {
  (...args: T): PlatformLazyFragment;
  readonly isActive: boolean;
  readonly id: string;
}

/**
 * Input definition: either a URL string or an input() with options.
 */
export type InputDef = string | InputWithOptions;

export interface InputWithOptions {
  url: string;
  follows?: Record<string, string>;
  nixName?: string;
}

/**
 * Workspace definition: the top-level configuration.
 */
export interface WorkspaceDef {
  inputs: Record<string, InputDef>;
  hosts: HostDef[];
}

/**
 * Host definition: a named target with a platform and its fragment list.
 */
export interface HostDef {
  name: string;
  platform: PlatformLazyFragment;
  fragments: readonly FragmentEntry[];
}

/**
 * Evaluation context: set by the evaluator before running fragments.
 */
export interface EvalContext {
  platform: string;
  hostname: string;
  activeIds: Set<string>;
}
