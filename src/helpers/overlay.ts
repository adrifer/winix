import type { Fragment, NixExpr } from "../core/types.ts";

/**
 * Add a nixpkgs overlay.
 */
export interface OverlayHelper {
  stable(inputName: string): Fragment;
  custom(expr: string): Fragment;
}

export const overlay: OverlayHelper = {
  stable: (inputName: string): Fragment => ({
    nixos: {
      nixpkgs: {
        overlays: [overlayExpr(stableOverlayExpr(inputName))],
      },
    },
  }),
  custom: (expr: string): Fragment => ({
    nixos: {
      nixpkgs: {
        overlays: [overlayExpr(expr)],
      },
    },
  }),
};

function stableOverlayExpr(inputName: string): string {
  return `(final: prev: { stable = import inputs.${inputName} { inherit (final.stdenv.hostPlatform) system; config = final.config.nixpkgs.config or {}; }; })`;
}

function overlayExpr(expr: string): NixExpr {
  return { __winixNixExpr: true, expr };
}
