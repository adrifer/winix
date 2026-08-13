import { feature, home, nix } from "@adrifer/winix";

/**
 * @description Chromium pre-installed for Playwright (no on-demand download)
 * @category testing
 */
export const playwright = feature("playwright", () => [
  home.packages("chromium"),
  home.env({
    PLAYWRIGHT_CHROMIUM_EXECUTABLE: nix.str`${nix.pkg("chromium")}/bin/chromium`,
    PLAYWRIGHT_SKIP_VALIDATE_HOST_REQUIREMENTS: "true",
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1",
  }),
]);
