import type { Fragment, NixExpr } from "../core/types.ts";

/**
 * Add a nixpkgs overlay.
 */
export interface OverlayHelper {
  stable(inputName: string): Fragment;
  custom(expr: string): Fragment;
  darwin: {
    stable(inputName: string): Fragment;
    custom(expr: string): Fragment;
  };
}

export const overlay: OverlayHelper = {
  stable: (inputName: string): Fragment => overlayForScopes(stableOverlayExpr(inputName)),
  custom: (expr: string): Fragment => overlayForScopes(expr),
  darwin: {
    stable: (inputName: string): Fragment => overlayForScope("darwin", stableOverlayExpr(inputName)),
    custom: (expr: string): Fragment => overlayForScope("darwin", expr),
  },
};

function overlayForScopes(expr: string): Fragment {
  return {
    ...overlayForScope("nixos", expr),
    ...overlayForScope("darwin", expr),
  };
}

function overlayForScope(scope: "nixos" | "darwin", expr: string): Fragment {
  return {
    [scope]: {
      nixpkgs: {
        overlays: [overlayExpr(expr)],
      },
    },
  };
}

function stableOverlayExpr(inputName: string): string {
  return `(final: prev: { stable = import inputs.${inputName} { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; })`;
}

function overlayExpr(expr: string): NixExpr {
  return { __winixNixExpr: true, expr };
}
