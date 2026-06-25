import { describe, expect, it } from "vitest";
import { resolveWingetVersion } from "../src/backends/windows/resolver.ts";

describe("winget resolver", () => {
  it("parses the Version field from winget show output", () => {
    const version = resolveWingetVersion(
      "Fastfetch-cli.Fastfetch",
      "winget",
      () => `
        Found fastfetch [Fastfetch-cli.Fastfetch]
          Version: 2.65.1
        Publisher: fastfetch-cli
        Installer:
          Installer Type: portable (zip)
      `,
      "win32"
    );

    expect(version).toBe("2.65.1");
  });

  it("throws clearly when winget reports the package is not found", () => {
    const err = new Error("winget failed") as Error & { stderr: string };
    err.stderr = "No package found matching input criteria.";

    expect(() =>
      resolveWingetVersion("Missing.Package", "winget", () => {
        throw err;
      }, "win32")
    ).toThrow('Windows package "Missing.Package" was not found in source "winget"');
  });

  it("throws clearly when winget is missing from PATH", () => {
    const err = new Error("spawn winget ENOENT") as NodeJS.ErrnoException;
    err.code = "ENOENT";

    expect(() =>
      resolveWingetVersion("Fastfetch-cli.Fastfetch", "winget", () => {
        throw err;
      }, "win32")
    ).toThrow("winget version resolution is only available on Windows");
  });
});
