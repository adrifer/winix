import { feature } from "@adrifer/winix";

/**
 * @description Declarative Homebrew via nix-homebrew with a small cask list
 * @category platform
 */
export const homebrew = feature("homebrew", () => ({
  darwin: {
    "nix-homebrew": {
      enable: true,
      user: "tony",
      autoMigrate: true,
    },
    homebrew: {
      enable: true,
      // Casks (GUI apps and macOS-only tools that aren't packaged for
      // nix-darwin). Keep this list short for the example; in a real
      // setup this grows organically.
      casks: [
        "scroll-reverser",
        "visual-studio-code",
      ],
    },
  },
}));
