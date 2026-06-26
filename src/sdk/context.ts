// Winix authoring context: the object injected into feature/profile/host
// callbacks. It bundles the *body declaration* namespaces so configs can
// destructure them (`({ home, windows }) => ...`) instead of importing globals.
//
// Scope rule: the context holds only what you destructure *inside a callback
// body to declare the body of your unit*. That is the per-platform declaration
// namespaces plus `platforms` (for its query side, `platforms.darwin.isActive`).
//
// Deliberately NOT in the context (still imported as file-level globals):
//   - `nix`     : a pure NixExpr-building utility (the `lib` of Winix); never
//                 returns a Fragment, so it declares nothing on its own.
//   - `account` : used top-level as a factory constructor
//                 (`const adri = account.user(...)`), never inside a body.
//   - `overlay` : used as a direct value in profile arrays
//                 (`profile("linux", [overlay.stable(...)])`), not destructured.
//
// The namespaces themselves are the same singletons exported from the package;
// they already read the ambient EvalContext for their context-aware behavior
// (e.g. `platforms.darwin.isActive`). Injecting them is ergonomic sugar today
// and the seam where resource handles / effect registration hook in later.

import { darwin } from "../helpers/darwin.ts";
import { home } from "../helpers/home.ts";
import { nixos } from "../helpers/nixos.ts";
import { platforms } from "../helpers/platforms.ts";
import { windows } from "../helpers/windows.ts";
import { collect, hasActiveCollector } from "./collector.ts";

import type { Fragment } from "../core/types.ts";
import type { DarwinHelper } from "../helpers/darwin.ts";
import type { HomeHelper } from "../helpers/home.ts";
import type { NixosHelper } from "../helpers/nixos.ts";
import type { PlatformsHelper } from "../helpers/platforms.ts";
import type { WindowsHelper } from "../helpers/windows.ts";

/**
 * The object injected into the callback form of `feature`, `profile`, and
 * `host`. A single shared shape across all three containers (they all just
 * "contain declarations"); see the context-injection proposal.
 *
 * Holds only the namespaces used to declare a unit's body. Pure utilities
 * (`nix`), top-level constructors (`account`), and array-value helpers
 * (`overlay`) stay as file-level imports by design.
 */
export interface WinixContext {
  home: HomeHelper;
  nixos: NixosHelper;
  darwin: DarwinHelper;
  windows: WindowsHelper;
  /** Query side: `platforms.darwin.isActive`, etc. (also a platform constructor). */
  platforms: PlatformsHelper;
}

/**
 * Heuristic: does a returned value look like a Fragment (a declaration to
 * register), as opposed to a NixExpr, a boolean (`isActive`), a nested factory,
 * etc.? Fragments are plain objects keyed by scope (`home`/`nixos`/`darwin`/
 * `windows`/`overlay`) and never carry the NixExpr/lazy/platform markers.
 */
function looksLikeFragment(value: unknown): value is Fragment {
  if (value === null || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.__winixNixExpr || v.__lazy || v.__winixRawModule || v.__platform) return false;
  return true;
}

/**
 * Wrap a namespace so that, while an effect collector is active, any Fragment a
 * method returns is also registered as an effect. Non-fragment returns (booleans
 * from `isActive`, NixExpr builders, nested factories) pass through untouched.
 *
 * Implemented with a single Proxy that handles both shapes uniformly:
 * - `apply` trap: when the wrapped value is itself called (callable namespaces
 *   like `home(...)`, or factories), collect a Fragment result.
 * - `get` trap: property access returns nested namespaces/functions wrapped too,
 *   so `platforms.darwin.isActive` (a getter on a PlatformFactory) and
 *   `platforms.darwin(...)` both keep working. Function properties are wrapped
 *   without losing their own properties (isActive/id), because we proxy the
 *   function instead of replacing it with a fresh arrow.
 *
 * Wrapping is transparent when no collector is active (returns values as-is).
 */
function wrapForEffects<T extends object>(ns: T): T {
  return new Proxy(ns, {
    apply(target, thisArg, args) {
      const result = Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
      if (hasActiveCollector() && looksLikeFragment(result)) {
        return collect(result as Fragment);
      }
      return result;
    },
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (!hasActiveCollector()) return value;
      if (typeof value === "function") {
        // Wrap the function (preserving its own props like isActive/id) so that
        // calling it collects, and reading e.g. `.isActive` still works.
        return wrapForEffects(value as unknown as object);
      }
      if (value && typeof value === "object") {
        // Nested namespace object (e.g. a sub-namespace); wrap lazily.
        return wrapForEffects(value as object);
      }
      return value;
    },
  }) as T;
}

/**
 * Build the context object passed to authoring callbacks.
 *
 * Returns references to the same namespace singletons the package exports, so
 * `({ home }) => home.program(...)` and the global `home.program(...)` are
 * interchangeable. Methods called through the context register their Fragment
 * result as an effect when a collector is active (layer 2), while still
 * returning it so the return forms keep working.
 */
export function createWinixContext(): WinixContext {
  return {
    home: wrapForEffects(home),
    nixos: wrapForEffects(nixos),
    darwin: wrapForEffects(darwin),
    windows: wrapForEffects(windows),
    platforms: wrapForEffects(platforms),
  };
}
