// Winix authoring context: the object injected into feature/profile/host
// callbacks. It bundles the declaration namespaces so configs can destructure
// them (`({ home, nix, windows }) => ...`) instead of importing the globals.
//
// The namespaces themselves are the same singletons exported from the package;
// they already read the ambient EvalContext for their context-aware behavior
// (e.g. `platforms.darwin.isActive`). Injecting them is ergonomic sugar today
// and the seam where resource handles / effect registration hook in later.

import { account } from "../helpers/account.ts";
import { darwin } from "../helpers/darwin.ts";
import { home } from "../helpers/home.ts";
import { nix } from "../helpers/nix.ts";
import { nixos } from "../helpers/nixos.ts";
import { overlay } from "../helpers/overlay.ts";
import { platforms } from "../helpers/platforms.ts";
import { windows } from "../helpers/windows.ts";

import type { AccountNamespace } from "../helpers/account.ts";
import type { DarwinHelper } from "../helpers/darwin.ts";
import type { HomeHelper } from "../helpers/home.ts";
import type { NixNamespace } from "../helpers/nix.ts";
import type { NixosHelper } from "../helpers/nixos.ts";
import type { OverlayHelper } from "../helpers/overlay.ts";
import type { PlatformsHelper } from "../helpers/platforms.ts";
import type { WindowsHelper } from "../helpers/windows.ts";

/**
 * The object injected into the callback form of `feature`, `profile`, and
 * `host`. A single shared shape across all three containers (they all just
 * "contain declarations"); see the context-injection proposal.
 */
export interface WinixContext {
  home: HomeHelper;
  nix: NixNamespace;
  nixos: NixosHelper;
  darwin: DarwinHelper;
  windows: WindowsHelper;
  account: AccountNamespace;
  overlay: OverlayHelper;
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
    nix,
    nixos,
    darwin,
    windows,
    account,
    overlay,
    platforms,
  };
}
