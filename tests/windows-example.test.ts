import { describe, expect, it } from "vitest";
import { join } from "node:path";
import windowsWorkspace from "../examples/windows/winix.config.ts";
import { evaluate, generateWindows } from "../src/index.ts";
import { readWindowsLock } from "../src/backends/windows/lockfile.ts";

describe("windows example integration", () => {
  it("generates stable Windows output for examples/windows", () => {
    const evaluated = evaluate(windowsWorkspace);
    const lock = readWindowsLock(join("examples", "windows"));
    if (!lock) {
      throw new Error("examples/windows/winix-windows.lock is required for this test");
    }
    const output = generateWindows(evaluated, lock);

    expect(evaluated.map((host) => host.name)).toEqual(["desktop"]);
    expect(output.warnings).toEqual([]);
    expect(output.hosts.desktop).toMatchSnapshot();
  });
});
