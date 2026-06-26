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
 * Build the context object passed to authoring callbacks.
 *
 * Returns references to the same namespace singletons the package exports, so
 * `({ home }) => home.program(...)` and the global `home.program(...)` are
 * interchangeable. Kept as a function (not a frozen const) so future layers can
 * bind per-evaluation state (handle collectors) without changing call sites.
 */
export function createWinixContext(): WinixContext {
  return {
    home,
    nixos,
    darwin,
    windows,
    platforms,
  };
}
