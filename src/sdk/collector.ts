// Effect-registration collector (layer 2 of the context-injection proposal).
//
// The legacy model is return-based: a unit body returns a FragmentResult and
// the evaluator walks it. Effect registration lets a body *declare by calling*:
//
//     feature("dev", ({ home, windows }) => {
//       home.program("git");     // registered as an effect, no return needed
//       windows.package("Git.Git");
//     });
//
// Mechanism: a scoped stack of "sinks". `withCollector` pushes a fresh sink,
// runs the body, and pops it, returning everything collected. Each declaration
// namespace, when called through the injected context, calls `collect(fragment)`
// to push its result onto the active sink (and remembers the reference).
//
// Back-compat with the return forms: a body may still `return` fragments. To
// avoid double-counting a fragment that is BOTH registered as an effect and
// returned (e.g. `return home.program(...)`), the evaluator consults
// `wasCollected(fragment)` and skips return values already captured by effect.

import type { Fragment } from "../core/types.ts";

interface Sink {
  fragments: Fragment[];
  /** References already pushed onto this sink, to dedupe against the return value. */
  seen: WeakSet<object>;
}

const G = globalThis as { __winixCollectorStack?: Sink[] };

function stack(): Sink[] {
  return (G.__winixCollectorStack ??= []);
}

function activeSink(): Sink | undefined {
  const s = stack();
  return s.length > 0 ? s[s.length - 1] : undefined;
}

/**
 * Run `fn` with a fresh effect sink active, returning the fragments declared by
 * effect during the call (in declaration order). Nesting is supported: an inner
 * `withCollector` does not leak into the outer sink.
 */
export function withCollector(fn: () => void): Fragment[] {
  const sink: Sink = { fragments: [], seen: new WeakSet() };
  stack().push(sink);
  try {
    fn();
  } finally {
    stack().pop();
  }
  return sink.fragments;
}

/**
 * Register a fragment as an effect on the active sink, if any. Returns the same
 * fragment so callers can both register and return it. No-op (returns the value
 * unchanged) when there is no active sink, so global usage outside a body keeps
 * working untouched.
 */
export function collect<T extends Fragment>(fragment: T): T {
  const sink = activeSink();
  if (sink && fragment && typeof fragment === "object") {
    sink.fragments.push(fragment);
    sink.seen.add(fragment);
  }
  return fragment;
}

/**
 * Whether `value` was already registered by effect on the active sink. Used by
 * the evaluator to skip a returned fragment that was also collected, preventing
 * duplicates when a body both calls a helper and returns its result.
 */
export function wasCollected(value: unknown): boolean {
  const sink = activeSink();
  return !!sink && typeof value === "object" && value !== null && sink.seen.has(value as object);
}

/** Whether an effect sink is currently active (a body is being resolved). */
export function hasActiveCollector(): boolean {
  return activeSink() !== undefined;
}
