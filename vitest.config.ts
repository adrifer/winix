import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@adrifer/winix": fileURLToPath(new URL("./src/index.ts", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Many tests spawn PowerShell, Git or the CLI; under a full parallel run
    // on Windows they can take several seconds, past the 5s default.
    testTimeout: 30000,
  },
});
