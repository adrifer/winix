import { darwin, feature } from "@adrifer/winix";

/**
 * @description Homebrew package manager for macOS via nix-homebrew
 * @category platform
 */
export const homebrew = feature("homebrew", () =>
  [
    darwin({
      "nix-homebrew": {
        user: "tony",
      },
    }),
    darwin.homebrew({ enable: true }),
  ]
);
