import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, it, beforeAll } from "vitest";

describe("static option types", () => {
  it("type-checks package and subpath type imports", () => {
    execFileSync("node", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/type-fixtures/tsconfig.json"], {
      cwd: process.cwd(),
      stdio: "pipe",
    });
  }, 15_000);

  describe("examples", () => {
    beforeAll(() => {
      // The examples tsconfig resolves `@adrifer/winix` to ./dist; build it
      // if it's not there yet so this test stands on its own.
      if (!existsSync("dist/index.d.ts")) {
        execFileSync(npmCommand(), npmArgs(["run", "build"]), {
          cwd: process.cwd(),
          stdio: "pipe",
        });
      }
    }, 60_000);

    it("type-checks all examples against the built package", () => {
      execFileSync(
        "node",
        ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "tests/type-fixtures/examples-tsconfig.json"],
        {
          cwd: process.cwd(),
          stdio: "pipe",
        }
      );
    }, 30_000);
  });
});

function npmCommand(): string {
  return process.platform === "win32" ? process.env.ComSpec ?? "cmd.exe" : "npm";
}

function npmArgs(args: string[]): string[] {
  return process.platform === "win32"
    ? ["/d", "/s", "/c", ["npm", ...args].join(" ")]
    : args;
}
