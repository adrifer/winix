import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  detectConflicts,
  analyzeWorkspace,
  collectEscapeReport,
  findDuplicateHosts,
} from "../src/cli/analysis.js";
import { init } from "../src/cli/commands/init.js";
import { selectHost } from "../src/cli/commands/switch.js";
import { host, nix, platform, raw, workspace } from "../src/index.js";

const nixos = platform("linux", () => ({
  nixos: {
    system: { stateVersion: "25.05" },
  },
}));

describe("CLI analysis", () => {
  it("detects duplicate hosts and scalar conflicts", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { networking: { hostName: "first" } }, __id: "base" },
          { nixos: { networking: { hostName: "second" } }, __id: "override" },
        ]),
        host("wsl", nixos(), []),
      ],
    });

    expect(findDuplicateHosts(ws)).toEqual(["wsl"]);
    const conflicts = detectConflicts(analyzeWorkspace(ws));
    expect(conflicts).toEqual([
      expect.objectContaining({
        host: "wsl",
        scope: "nixos",
        path: "networking.hostName",
        firstFragment: "base",
        secondFragment: "override",
      }),
    ]);
  });

  it("reports raw blocks, raw modules, and escape expressions before merge", () => {
    const ws = workspace({
      inputs: { nixpkgs: "nixos-unstable" },
      hosts: [
        host("wsl", nixos(), [
          { nixos: { users: { users: { root: { shell: nix.expr("pkgs.bash") } } } } },
          raw.nixos("services.openssh.enable = true;"),
        ]),
      ],
    });

    const report = collectEscapeReport(analyzeWorkspace(ws));
    expect(report).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "escape", path: "users.users.root.shell" }),
        expect.objectContaining({ kind: "raw", path: "__raw.0" }),
      ])
    );
  });
});

describe("winix init", () => {
  it("scaffolds project files and refuses to overwrite without --force", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-init-"));
    try {
      await init(dir, { force: false });
      expect(existsSync(join(dir, "winix.config.ts"))).toBe(true);
      expect(await readFile(join(dir, "package.json"), "utf-8")).toContain('"winix"');

      await expect(init(dir, { force: false })).rejects.toThrow("already exists");
      await writeFile(join(dir, "winix.config.ts"), "custom");
      await init(dir, { force: true });
      expect(await readFile(join(dir, "winix.config.ts"), "utf-8")).not.toBe("custom");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("winix switch host selection", () => {
  it("uses requested host, singleton host, or current hostname match", () => {
    expect(selectHost(["wsl", "wsl-work"], "wsl-work", "other")).toBe("wsl-work");
    expect(selectHost(["only-host"], undefined, "other")).toBe("only-host");
    expect(selectHost(["wsl", "wsl-work"], undefined, "wsl")).toBe("wsl");
  });

  it("requires --host when current hostname does not match any configured host", () => {
    expect(() => selectHost(["wsl", "wsl-work"], undefined, "other")).toThrow(
      'Current hostname "other" does not match a configured host'
    );
  });
});
