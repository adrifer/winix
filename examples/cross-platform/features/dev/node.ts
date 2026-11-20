import { feature } from "@adrifer/winix";

/** Node.js on every platform: a nixpkgs package on Linux/macOS, the LTS installer on Windows. */
export const node = feature("node", ({ home, windows }) => {
  home.packages("nodejs_24");
  windows.package("OpenJS.NodeJS.LTS");
});
