// Core types for Winix fragments and composition

/**
 * The output shape of any fragment. Keys correspond to target scopes.
 * Values are deep-merged by the evaluator according to merge rules.
 */
export interface Fragment {
  nixos?: Record<string, unknown>;
  home?: Record<string, unknown>;
  darwin?: Record<string, unknown>;
  /** Internal: platform/feature ID for .isActive resolution */
  __id?: string;
  /** Internal: marks this as a platform fragment */
  __platform?: boolean;
}

/**
 * A lazy fragment descriptor: holds the factory + args for deferred evaluation.
 * The evaluator calls __resolve() with context set to get the actual Fragment(s).
 */
export interface LazyFragment {
  __lazy: true;
  __id: string;
  __platform?: boolean;
  __resolve: () => Fragment | Fragment[];
}

/**
 * What goes into a host's fragment list: either a lazy descriptor or a plain Fragment.
 */
export type FragmentEntry = LazyFragment | Fragment | Fragment[];

/**
 * A fragment factory: callable to produce a LazyFragment, with .isActive getter.
 */
export interface FragmentFactory<T extends unknown[] = []> {
  (...args: T): LazyFragment;
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
  platform: LazyFragment;
  fragments: FragmentEntry[];
}

/**
 * Evaluation context: set by the evaluator before running fragments.
 */
export interface EvalContext {
  platform: string;
  hostname: string;
  activeIds: Set<string>;
}
