import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { evaluate, feature, host, platforms, windows, workspace } from "../src/index.ts";
import { generateWindows, type WindowsResourceSummary } from "../src/backends/windows/index.ts";
import { emptyWindowsLock, windowsLockPinGaps, type WindowsLock } from "../src/backends/windows/lockfile.ts";
import { wslDistroProperties } from "../src/backends/windows/wsl.ts";
import { wslRepositoryKey } from "../src/backends/windows/wsl-setup.ts";
import { unifiedDiff } from "../src/cli/diff.ts";
import {
  formatWindowsPlan, parseDscTestOutput, parseProbeOutput, planWindowsResources, type WindowsPlanChecker,
} from "../src/cli/windows-plan.ts";
import { inspectResources, parsePackageInventory, type WindowsStateAdapter } from "../src/cli/windows-state.ts";
import { lockGapWarnings } from "../src/cli/commands/check.ts";
import { inspectHost } from "../src/cli/commands/inspect.ts";
import { analyzeWorkspace } from "../src/cli/analysis.ts";
import { applyWorkspace } from "../src/cli/commands/apply.ts";

/** Apply a unified diff to `before`, to check that hunks are exact. */
function applyPatch(before: string, patch: string): string {
  const source = before === "" ? [] : before.replace(/\n$/, "").split("\n");
  const out: string[] = [];
  let cursor = 0;
  const lines = patch.replace(/\n$/, "").split("\n").slice(2);
  for (let i = 0; i < lines.length; i++) {
    const header = /^@@ -(\d+),(\d+) \+\d+,\d+ @@$/.exec(lines[i]);
    if (!header) throw new Error(`bad header: ${lines[i]}`);
    const start = Number(header[2]) === 0 ? Number(header[1]) : Number(header[1]) - 1;
    while (cursor < start) out.push(source[cursor++]);
    while (i + 1 < lines.length && !lines[i + 1].startsWith("@@")) {
      const line = lines[++i];
      if (line[0] === " ") { expect(source[cursor]).toBe(line.slice(1)); out.push(source[cursor++]); }
      else if (line[0] === "-") { expect(source[cursor]).toBe(line.slice(1)); cursor++; }
      else out.push(line.slice(1));
    }
  }
  while (cursor < source.length) out.push(source[cursor++]);
  return out.length ? out.join("\n") + "\n" : "";
}

describe("apply --diff unified diff", () => {
  it("prints hunks with context and line numbers", () => {
    const before = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m"].join("\n") + "\n";
    const after = ["a", "b", "c", "D", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n"].join("\n") + "\n";
    expect(unifiedDiff(before, after, "old", "new")).toBe([
      "--- old", "+++ new",
      "@@ -1,7 +1,7 @@", " a", " b", " c", "-d", "+D", " e", " f", " g",
      "@@ -11,3 +11,4 @@", " k", " l", " m", "+n", "",
    ].join("\n"));
    // Hunks whose context touches are merged, as in git.
    expect(unifiedDiff("1\n2\n3\n4\n5\n6\n7\n8\n", "1\nX\n3\n4\n5\n6\n7\nY\n", "a", "b")).toBe(
      "--- a\n+++ b\n@@ -1,8 +1,8 @@\n 1\n-2\n+X\n 3\n 4\n 5\n 6\n 7\n-8\n+Y\n");
    expect(unifiedDiff(before, before, "old", "new")).toBe("");
  });

  it("round-trips random edits", () => {
    let seed = 7;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let run = 0; run < 200; run++) {
      const before = Array.from({ length: Math.floor(random() * 40) }, () => String.fromCharCode(97 + Math.floor(random() * 5)));
      const after = before.flatMap((line) => {
        const roll = random();
        return roll < 0.15 ? [] : roll < 0.3 ? [line, "x" + line] : roll < 0.4 ? ["y"] : [line];
      });
      const a = before.length ? before.join("\n") + "\n" : "";
      const b = after.length ? after.join("\n") + "\n" : "";
      expect(applyPatch(a, unifiedDiff(a, b, "a", "b"))).toBe(b);
    }
  });
});

describe("generated Windows output size", () => {
  it("emits shared file helpers once and keeps the WSL setup runtime out of test scripts", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), [
        windows.file.symlink("%USERPROFILE%\\a", "%USERPROFILE%\\x"),
        windows.file.symlink("%USERPROFILE%\\b", "%USERPROFILE%\\y", { recursive: true }),
        windows.file.copy("%USERPROFILE%\\c", "%USERPROFILE%\\z"),
        windows.file.text("%USERPROFILE%\\d", "hello"),
      ])],
    }));
    const doc = generateWindows(evaluated, emptyWindowsLock()).hosts.desktop["configuration.winget"];
    for (const fn of ["function Set-WinixSymlink", "function Test-WinixCopy", "function Get-WinixTextBytes", "function Move-WinixExistingTarget"]) {
      expect(doc.split(fn).length - 1).toBe(1);
    }
    expect(doc.split("Import-Module -Name $winixModule").length - 1).toBe(8);

    const setup = {
      repository: "https://github.com/example/dotfiles.git", ref: "main",
      host: "wsl-work", configDirectory: "winix", user: "alice", checkout: "/home/alice/dotfiles",
    };
    const image = (architecture: "x64" | "arm64") => ({
      source: "nixos-wsl" as const, architecture, version: "2605.7.2", sha256: "a".repeat(64),
      url: `https://github.com/nix-community/NixOS-WSL/releases/download/2605.7.2/${architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl"}`,
      resolvedAt: "2026-11-11T00:00:00.000Z",
    });
    const properties = wslDistroProperties({
      name: "NixOS", source: "nixos-wsl", installLocation: "D:\\WSL\\NixOS", default: true, setup,
    }, { "nixos-wsl/x64": image("x64"), "nixos-wsl/arm64": image("arm64") }, {
      [wslRepositoryKey(setup)]: { repository: setup.repository, ref: "main", revision: "b".repeat(40), resolvedAt: "2026-11-11T00:00:00.000Z" },
    });
    expect(properties.setScript).toContain("WINIX_WSL_SETUP");
    expect(properties.testScript).toContain("Invoke-WinixWslSetup $true");
    expect(properties.testScript).not.toContain("WINIX_WSL_SETUP_REQUEST");
    expect(properties.getScript).not.toContain("Invoke-WinixWslSetup");
    expect(properties.testScript.length).toBeLessThan(properties.setScript.length / 2);
  });
});

function summary(overrides: Partial<WindowsResourceSummary>): WindowsResourceSummary {
  return { name: "r", type: "Microsoft.DSC.Transitional/PowerShellScript", category: "other", label: "r", elevated: false, reboot: false, dependsOn: [], ...overrides };
}
function pkg(id: string, version: string | undefined, extra: Partial<NonNullable<WindowsResourceSummary["package"]>> = {}): WindowsResourceSummary {
  return summary({
    name: id, type: "Microsoft.WinGet/Package", category: "package", label: id,
    package: { id, source: "winget", version, anyVersion: false, exact: false, ...extra },
  });
}

describe("Windows plan", () => {
  it("decides package actions from the inventory", async () => {
    const resources = [
      pkg("New.App", "1.0"), pkg("Old.App", "2.0"), pkg("Same.App", "3.0"), pkg("Newer.App", "1.0"),
      pkg("Exact.App", "1.0", { exact: true }), pkg("Any.App", undefined, { anyVersion: true }),
      pkg("Unknown.App", "1.0"), pkg("Missing.Any", undefined, { anyVersion: true }),
    ];
    const inventory = new Map([
      ["New.App", null], ["Old.App", { version: "1.5" }], ["Same.App", { version: "3.0" }],
      ["Newer.App", { version: "1.1" }], ["Exact.App", { version: "1.2" }], ["Any.App", { version: "9" }],
      ["Unknown.App", { version: "Unknown" }], ["Missing.Any", null],
    ]);
    const planned = await planWindowsResources(resources, inventory, undefined);
    expect(planned.map((entry) => [entry.resource.label, entry.state, entry.action])).toEqual([
      ["New.App", "change", "install"], ["Old.App", "change", "upgrade"], ["Same.App", "ok", "keep"],
      ["Newer.App", "ok", "keep"], ["Exact.App", "conflict", "conflict"], ["Any.App", "ok", "keep"],
      ["Unknown.App", "ok", "keep"], ["Missing.Any", "change", "install"],
    ]);
    const output = formatWindowsPlan("desktop", planned, { live: true }).join("\n");
    expect(output).toContain("+ install   New.App  (1.0)");
    expect(output).toContain("~ upgrade   Old.App  (1.5 -> 2.0)");
    expect(output).toContain("! conflict  Exact.App  (installed 1.2, exact pin 1.0; switch fails rather than downgrade)");
    expect(output).toContain("+ install   Missing.Any  (latest available)");
    expect(output).toContain("= 4 unchanged (packages: 4)");
    expect(output).toContain("newer than locked; switch keeps them and offers to update the lock: Newer.App");
    expect(output).toContain("Summary: 3 to change, 1 conflict(s), 4 unchanged.");
  });

  it("checks scripts and DSC resources independently and explains what could not be checked", async () => {
    const resources = [
      summary({ name: "link", category: "file", label: "link a -> b", testScript: "Test-WinixSymlink" }),
      summary({ name: "same", category: "file", label: "write c", testScript: "..." }),
      summary({ name: "features", category: "features", label: "Enable Windows features X", testScript: "...", reboot: true, needsElevationToCheck: true }),
      summary({ name: "broken", category: "other", label: "broken", testScript: "..." }),
      summary({ name: "env", type: "Microsoft.Windows/Registry", category: "environment", label: "EDITOR=nvim (user)", properties: {} }),
      summary({ name: "cmd", type: "Microsoft.DSC.Transitional/RunCommandOnSet", category: "command", label: "setup" }),
      summary({ name: "admin", category: "settings", label: "machine thing", elevated: true, testScript: "..." }),
    ];
    const checker: WindowsPlanChecker = {
      scripts: vi.fn(async () => new Map([
        ["link", { ok: false }], ["same", { ok: true }], ["admin", { ok: false }],
        ["features", { error: "The requested operation requires elevation." }],
        ["broken", { error: "Cannot find path\nmore detail" }],
      ])),
      dsc: vi.fn(async () => new Map([["env", { ok: true }]])),
    };
    const planned = await planWindowsResources(resources, new Map(), checker);
    expect(checker.dsc).toHaveBeenCalledWith([resources[4]]);
    const output = formatWindowsPlan("desktop", planned, { live: true });
    expect(output).toEqual([
      "Plan for desktop (checked against this machine):",
      "  ~ apply  link a -> b",
      "  ? check  Enable Windows features X  (needs an elevated shell to check)",
      "  ? check  broken  (check failed: Cannot find path)",
      "  ~ run    setup  (raw commands run on every switch)",
      "  ~ apply  machine thing",
      "  = 2 unchanged (files: 1, environment: 1)",
      "  ! 1 change(s) run elevated; run switch from an elevated shell: machine thing",
      "  ! Enable Windows features X can require a Windows restart; Winix never restarts Windows.",
      "  Summary: 3 to change, 2 not checked, 2 unchanged.",
    ]);
  });

  it("describes the declaration when the machine cannot be checked", async () => {
    const planned = await planWindowsResources([pkg("Git.Git", "2.0"), summary({ category: "file", testScript: "..." })], undefined, undefined);
    expect(formatWindowsPlan("desktop", planned, { live: false, reason: "machine checks need native Windows" })).toEqual([
      "Plan for desktop (not checked against a machine: machine checks need native Windows):",
      "  Declares packages: 1, files: 1.",
    ]);
  });

  it("parses probe and dsc test output", () => {
    expect(parseProbeOutput('noise\nWINIX-PLAN:[{"name":"a","ok":true},{"name":"b","error":"boom"}]\n')).toEqual(
      new Map([["a", { ok: true }], ["b", { error: "boom" }]]));
    expect(parseProbeOutput('WINIX-PLAN:{"name":"only","ok":false}')).toEqual(new Map([["only", { ok: false }]]));
    expect(() => parseProbeOutput("nothing")).toThrow("no result");
    expect(parseDscTestOutput({ results: [
      { name: "x", result: { inDesiredState: true } }, { name: "y", result: { inDesiredState: false } },
    ] })).toEqual(new Map([["x", { ok: true }], ["y", { ok: false }]]));
  });

  it("summarizes every generated resource with categories, flags and edges", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), ({ windows }) => {
        const git = windows.package("Git.Git");
        windows.package("Valve.Steam", { version: "any" });
        windows.file.symlink("%USERPROFILE%\\.gitconfig", "%USERPROFILE%\\dotfiles\\gitconfig", { dependsOn: git });
        windows.env.set("EDITOR", "nvim");
        windows.wsl();
      })],
    }));
    const lock: WindowsLock = { version: 1, packages: {
      "Git.Git": { source: "winget", version: "2.44.0", resolvedAt: "x" },
      "Microsoft.WSL": { source: "winget", version: "2.6.1", resolvedAt: "x" },
    } };
    const resources = generateWindows(evaluated, lock).resources.desktop;
    const byLabel = Object.fromEntries(resources.map((resource) => [resource.label, resource]));
    expect(byLabel["Git.Git"].package).toEqual({ id: "Git.Git", source: "winget", version: "2.44.0", anyVersion: false, exact: false });
    expect(byLabel["Valve.Steam"].package?.anyVersion).toBe(true);
    const link = byLabel["link %USERPROFILE%\\.gitconfig -> %USERPROFILE%\\dotfiles\\gitconfig"];
    expect(link.category).toBe("file");
    expect(link.dependsOn).toEqual(["Git Git", "Winix PowerShell helpers"]);
    expect(link.testScript).toContain("Test-WinixSymlink");
    expect(byLabel["EDITOR=nvim (user)"].category).toBe("environment");
    expect(byLabel["EDITOR=nvim (user)"].properties).toBeDefined();
    const features = resources.find((resource) => resource.category === "features")!;
    expect([features.reboot, features.needsElevationToCheck]).toEqual([true, true]);
    expect(resources.find((resource) => resource.category === "winix")?.label).toBe("Winix PowerShell helpers (used by file resources)");
  });
});

describe("batched Windows inventory", () => {
  it("uses one batched call when the adapter supports it", async () => {
    const inspectMany = vi.fn(async (resources: unknown[]) => resources.map((_, index) => ({ version: String(index) })));
    const adapter: WindowsStateAdapter = { inspect: vi.fn(), inspectMany, remove: vi.fn() };
    const resources = [
      { kind: "package" as const, id: "A", source: "winget" }, { kind: "package" as const, id: "B", source: "winget" },
    ];
    const result = await inspectResources(adapter, resources);
    expect(inspectMany).toHaveBeenCalledTimes(1);
    expect(adapter.inspect).not.toHaveBeenCalled();
    expect([...result.values()]).toEqual([{ version: "0" }, { version: "1" }]);
  });

  it("parses a dsc config get inventory and validates identities", () => {
    const resources = [{ kind: "package" as const, id: "Git.Git", source: "winget" }, { kind: "package" as const, id: "No.Pe", source: "winget" }];
    expect(parsePackageInventory(resources, { results: [
      { name: "package 0", result: { actualState: { _exist: true, id: "Git.Git", source: "winget", version: "2.55.0" } } },
      { name: "package 1", result: { actualState: { _exist: false, id: "No.Pe", source: "winget" } } },
    ] })).toEqual([{ version: "2.55.0" }, null]);
    expect(() => parsePackageInventory(resources, { results: [
      { name: "package 0", result: { actualState: { _exist: true, id: "Other", source: "winget", version: "1" } } },
    ] })).toThrow("identity mismatch");
    expect(() => parsePackageInventory(resources.slice(1), { results: [] })).toThrow("missing No.Pe");
  });
});

describe("lock pin gaps", () => {
  it("reports every pin apply would resolve online, naming the implicit settings module", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), [
        windows.package("Git.Git"), windows.package("Valve.Steam", { version: "any" }),
        windows.setting({ DeveloperMode: true }),
      ])],
    }));
    const gaps = windowsLockPinGaps(null, evaluated);
    expect(gaps.map((gap) => [gap.kind, gap.label, gap.selector])).toEqual([
      ["package", "package Git.Git", "Git.Git"],
      ["module", "PowerShell module Microsoft.Windows.Settings (implicit, used by windows.setting)", "Microsoft.Windows.Settings"],
    ]);
    expect(lockGapWarnings(gaps)).toEqual([
      "Warning: winix-windows.lock is missing 2 pin(s): package Git.Git, PowerShell module Microsoft.Windows.Settings (implicit, used by windows.setting).",
      "  Until the lock contains them, every apply and switch resolves them online (\"Would pin…\" in dry runs), and --offline/--locked fail.",
      "  Pin them now with winix update --windows Git.Git Microsoft.Windows.Settings, then commit winix-windows.lock.",
      "  A mistyped package id fails at that point; find ids with winix package search <query>.",
    ]);
    expect(lockGapWarnings([])).toEqual([]);
  });
});

describe("apply --offline / --locked", () => {
  async function workspaceDir(hostsSource: string, lock?: unknown): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "winix-offline-"));
    const indexUrl = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
    await writeFile(join(dir, "winix.config.mjs"), `
      import { host, platforms, windows, workspace } from ${JSON.stringify(indexUrl)};
      export default workspace({ hosts: [${hostsSource}] });
    `);
    if (lock) await writeFile(join(dir, "winix-windows.lock"), JSON.stringify(lock));
    return dir;
  }

  it("fails before any resolver runs when pins are missing", async () => {
    const dir = await workspaceDir('host("desktop", platforms.windows(), [windows.package("Git.Git")])');
    const resolve = vi.fn(() => "1.0");
    try {
      for (const flag of ["offline", "locked"] as const) {
        await expect(applyWorkspace(dir, { dry: true, diff: false, print: false, [flag]: true, resolveWindowsPackageVersion: resolve }))
          .rejects.toThrow(`--${flag}: winix-windows.lock is missing 1 pin(s): package Git.Git. Resolve them with network access (winix update --windows Git.Git)`);
      }
      expect(resolve).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("--locked also rejects inline pins the lock does not record; --offline accepts them", async () => {
    const dir = await workspaceDir('host("desktop", platforms.windows(), [windows.package({ id: "Git.Git", version: "2.0" })])', {
      version: 1, packages: { "Git.Git": { source: "winget", version: "1.0", resolvedAt: "x" } },
    });
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await expect(applyWorkspace(dir, { dry: true, diff: false, print: false, locked: true }))
        .rejects.toThrow("--locked: inline Windows package versions differ from winix-windows.lock");
      const result = await applyWorkspace(dir, { dry: true, diff: false, print: false, offline: true });
      expect(result.windowsLock?.packages["Git.Git"].version).toBe("2.0");
      expect(result.windowsOutput?.resources.desktop.map((resource) => resource.label)).toEqual(["Git.Git"]);
    } finally {
      log.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("inspect", () => {
  it("lists each feature once with its scopes, Windows resources and dependsOn edges", () => {
    const shell = feature("windows-shell", ({ windows }) => {
      const pwsh = windows.package({ id: "Microsoft.PowerShell", version: "7.6.0" });
      const icons = windows.powershell.module("Terminal-Icons", { dependsOn: pwsh });
      windows.file.symlink(windows.knownFolder.documents("PowerShell\\profile.ps1"), "../windows/profile.ps1", { dependsOn: icons });
      windows.env.set("EDITOR", "nvim");
    });
    const git = feature("git", ({ home }) => { home.packages(["git"]); });
    const ws = workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [shell(), git()])] });
    const [analysis] = analyzeWorkspace(ws, { configDir: "D:\\dotfiles\\winix" });
    expect(inspectHost(analysis, ["git"])).toEqual([
      "",
      "desktop",
      "  platform: windows",
      "  composition: windows-shell > git",
      "  windows-shell  [windows]",
      "    package Microsoft.PowerShell 7.6.0 (exact)",
      "    PowerShell module Terminal-Icons  <- after package Microsoft.PowerShell",
      "    link documents\\PowerShell\\profile.ps1 -> ../windows/profile.ps1  <- after PowerShell module Terminal-Icons",
      "    EDITOR=nvim (user)",
      "  git  [homeManager]  (no applicable configuration on this platform; ignored)",
      "    homeManager: home",
    ]);
  });
});
