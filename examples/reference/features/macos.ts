import { darwin, feature, home } from "@adrifer/winix";

/**
 * @description macOS system tweaks: TouchID sudo + suppress Home Manager manpages
 * @category platform
 */
export const macos = feature("macos", () => [
  // Enable TouchID for sudo via the system pam.d hook. The whole
  // security/pam tree gets passed straight through; using darwin({...})
  // keeps it typed where possible.
  darwin({
    security: {
      pam: {
        services: {
          sudo_local: { touchIdAuth: true },
        },
      },
    },
  }),

  // Home Manager installs a manpage cache by default. On macOS that
  // collides with the system one; turn it off.
  home({ manual: { manpages: { enable: false } } }),
]);
