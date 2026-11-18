import { PassThrough } from "node:stream";
import { createInterface } from "node:readline/promises";
import { describe, expect, it, vi } from "vitest";
import {
  compareWindowsPackageVersions, effectiveWindowsPackageVersion, confirmWindowsPackageLockUpdate,
} from "../src/cli/windows-package-versions.ts";

vi.mock("node:readline/promises", () => ({ createInterface: vi.fn() }));

describe("Windows package version policy", () => {
  it("keeps newer installed versions and upgrades older ones without lexicographic or numeric overflow errors", () => {
    expect(effectiveWindowsPackageVersion("Example.App", { version: "7", exact: false })).toBe("7");
    expect(effectiveWindowsPackageVersion("Example.App", { version: "7", exact: false }, "8")).toBe("8");
    expect(effectiveWindowsPackageVersion("Example.App", { version: "7", exact: false }, "6")).toBe("7");
    expect(compareWindowsPackageVersions("Example.App", "10.0", "9.99")).toBe(1);
    expect(compareWindowsPackageVersions("Example.App", "1.0.0", "1")).toBe(0);
    expect(compareWindowsPackageVersions("Example.App", "999999999999999999999", "999999999999999999998")).toBe(1);
  });

  it("requires exact declarations without downgrading and rejects ambiguous version ordering", () => {
    expect(effectiveWindowsPackageVersion("Example.App", { version: "7", exact: true }, "7")).toBe("7");
    for (const installed of ["6", "8"]) {
      expect(() => effectiveWindowsPackageVersion("Example.App", { version: "7", exact: true }, installed)).toThrow("Exact version mismatch");
    }
    expect(compareWindowsPackageVersions("Example.App", "release-seven", "release-seven")).toBe(0);
    expect(() => compareWindowsPackageVersions("Example.App", "7", "8-beta")).toThrow(/Cannot reliably compare.*Example\.App/);
  });

  it.each(["Unknown", "8-beta"])("uses the lock for a floating package reported as %j but rejects an exact mismatch", (installed) => {
    expect(effectiveWindowsPackageVersion("Example.App", { version: "7", exact: false }, installed)).toBe("7");
    expect(() => effectiveWindowsPackageVersion("Example.App", { version: "7", exact: true }, installed))
      .toThrow(/Exact version mismatch for Example\.App: installed version reported as non-comparable/);
  });

  it.each(["y", "N", ""])("updates locks only on an affirmative interactive answer (%s)", async (answer) => {
    const readline = await vi.importActual<typeof import("node:readline/promises")>("node:readline/promises");
    const prompt = readline.createInterface({ input: new PassThrough(), output: new PassThrough() });
    vi.mocked(createInterface).mockReturnValue(prompt);
    const question = vi.spyOn(prompt, "question").mockResolvedValue(answer);
    vi.stubGlobal("process", { ...process, stdin: { isTTY: true }, stdout: { isTTY: true } });
    try {
      expect(await confirmWindowsPackageLockUpdate("Example.App", "8", "7")).toBe(answer === "y");
      expect(question).toHaveBeenCalledWith(
        "Example.App: installed 8, locked 7. Update winix-windows.lock to 8? [y/N] ",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
    } finally { prompt.close(); vi.unstubAllGlobals(); vi.mocked(createInterface).mockReset(); }
  });

  it("never prompts or updates a lock non-interactively", async () => {
    vi.stubGlobal("process", { ...process, stdin: { isTTY: false }, stdout: { isTTY: false } });
    try {
      expect(await confirmWindowsPackageLockUpdate("Example.App", "8", "7")).toBe(false);
      expect(createInterface).not.toHaveBeenCalled();
    } finally { vi.unstubAllGlobals(); }
  });
});
