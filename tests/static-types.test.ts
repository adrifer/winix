import { execFileSync } from "node:child_process";
import { describe, it } from "vitest";

describe("static option types", () => {
  it("type-checks package and subpath type imports", () => {
    execFileSync("npx", ["tsc", "--noEmit", "-p", "tests/type-fixtures/tsconfig.json"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  });
});
