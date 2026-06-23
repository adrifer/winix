import { feature, home } from "@adrifer/winix";

/**
 * @description Node.js + pnpm + bun toolchain with per-user npm prefix
 * @category language
 */
export const javascript = feature("javascript", () => [
  home.packages("bun", "nodejs_22", "pnpm"),

  // Keep `npm i -g ...` out of /nix/store by pointing it at a
  // user-writable prefix. Same trick for pnpm's global bin.
  home.env({
    NPM_CONFIG_PREFIX: "${config.home.homeDirectory}/.npm-global",
    NPM_CONFIG_USERCONFIG: "${config.home.homeDirectory}/.config/npm/npmrc",
    PNPM_HOME: "${config.home.homeDirectory}/.local/share/pnpm",
  }),

  home.path(
    "${config.home.homeDirectory}/.npm-global/bin",
    "${config.home.homeDirectory}/.local/share/pnpm"
  ),

  // Make sure the npmrc is writable before any other activation step
  // tries to use it.
  home.activation("ensureWritableNpmrc", {
    script: `
      mkdir -p "\${config.home.homeDirectory}/.config/npm"
      touch "\${config.home.homeDirectory}/.config/npm/npmrc"
      chmod 600 "\${config.home.homeDirectory}/.config/npm/npmrc"
    `,
  }),
]);
