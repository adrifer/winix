import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("static option types", () => {
  it("type-checks package and subpath type imports", () => {
    execFileSync("node", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/type-fixtures/tsconfig.json"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  }, 15_000);
});
