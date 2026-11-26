import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
  formatWindowsPlan, installElevation, nativeWindowsPlanChecker, noInstalledPackage, parseDscTestOutput, parseProbeOutput,
  parseRunningOutput, planWindowsResources, upgradeElevation, type PlannedResource, type WindowsPlanChecker,
} from "../src/cli/windows-plan.ts";
import {
  applyWindowsBatches, formatApplySummary, nativeWindowsBatchRunner, orderBatches, parseApplyResults, planApplyBatches,
  type ApplyBatch, type ApplyStep, type StepResult,
} from "../src/cli/windows-apply.ts";
import {
  inspectResources, inventoryPackages, parsePackageInventory, parseWingetExport, type WindowsStateAdapter,
} from "../src/cli/windows-state.ts";
import { applyProgress, dryRunSummary } from "../src/cli/commands/switch.ts";
import { formatDuration } from "../src/cli/progress.ts";
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
    const resources = generateWindows(evaluated, emptyWindowsLock()).resources.desktop;
    const doc = resources.map((resource) => [resource.testScript ?? "", resource.setScript ?? ""].join("\n")).join("\n");
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
    const output = formatWindowsPlan("desktop", planned, { live: true });
    expect(output).toEqual([
      "Plan for desktop: 3 changes, 1 conflict, 4 unchanged",
      "  + install   New.App      1.0",
      "  ~ upgrade   Old.App      1.5 → 2.0",
      "  ! conflict  Exact.App    installed 1.2, exact pin 1.0; switch fails rather than downgrade",
      "  + install   Missing.Any  latest available",
      "  = 4 unchanged (4 packages)",
      "  i 1 package newer than locked (kept; switch offers to update the lock): Newer.App",
    ]);
    // Colour only when asked (interactive terminals).
    expect(formatWindowsPlan("desktop", planned, { live: true, color: true })[1]).toBe(
      "  \x1b[32m+\x1b[0m \x1b[32minstall \x1b[0m  New.App      \x1b[2m1.0\x1b[0m");
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
      "Plan for desktop: 3 changes, 2 not checked, 2 unchanged",
      "  ~ apply  link a -> b",
      "  ? check  Enable Windows features X  needs an elevated shell to check",
      "  ? check  broken                     check failed: Cannot find path",
      "  ~ run    setup                      raw commands run on every switch",
      // Tags line up after the detail column (capped at 28 characters).
      `  ~ apply  ${"machine thing".padEnd(25)}  ${" ".repeat(28)}  [admin]`,
      "  = 2 unchanged (1 file, 1 environment variable)",
      "",
      "  ! Switch asks once for administrator approval (UAC) for the [admin] row.",
      "  ! Enable Windows features X can require a Windows restart; Winix never restarts Windows.",
    ]);
  });

  it("shows removals in the plan, warning only when a package would be uninstalled", async () => {
    const planned = await planWindowsResources([pkg("Same.App", "1.0")], new Map([["Same.App", { version: "1.0" }]]), undefined);
    const shortcuts = formatWindowsPlan("desktop", planned, {
      live: true, removals: [{ label: "Startup shortcut komorebi" }, { label: "Startup shortcut whkd" }],
      untouched: ["Old.Tool (winget package)"],
    });
    expect(shortcuts).toEqual([
      "Plan for desktop: no changes, 2 removals, 1 unchanged",
      "  - remove  Startup shortcut komorebi  no longer declared",
      "  - remove  Startup shortcut whkd      no longer declared",
      "  = 1 unchanged (1 package)",
      "  i 1 resource no longer declared but not created by Winix, so left as it is: Old.Tool (winget package)",
    ]);
    const packages = formatWindowsPlan("desktop", planned, { live: true, removals: [{ label: "Old.App (winget package)", package: true }] });
    expect(packages).toContain("  - remove  Old.App (winget package)  no longer declared; uninstalls it");
    expect(packages.at(-1)).toBe("  ! Uninstalling a package can remove its application data.");
  });

  it("describes the declaration when the machine cannot be checked", async () => {
    const planned = await planWindowsResources([pkg("Git.Git", "2.0"), summary({ category: "file", testScript: "..." })], undefined, undefined);
    expect(formatWindowsPlan("desktop", planned, { live: false, reason: "machine checks need native Windows" })).toEqual([
      "Plan for desktop (not checked against a machine: machine checks need native Windows)",
      "  Declares 1 package, 1 file.",
    ]);
  });

  it("warns when a package to upgrade is running, and only asks about upgrades", async () => {
    const resources = [pkg("Tool.Busy", "2.0"), pkg("Tool.Idle", "2.0"), pkg("Tool.Same", "1.0"), pkg("Tool.New", "1.0")];
    const inventory = new Map([
      ["Tool.Busy", { version: "1.0" }], ["Tool.Idle", { version: "1.0" }], ["Tool.Same", { version: "1.0" }], ["Tool.New", null],
    ]);
    const running = vi.fn(async () => new Map([["Tool.Busy", [{ name: "busy.exe", pid: 42 }, { name: "busy.exe", pid: 43 }]]]));
    const checker: WindowsPlanChecker = { scripts: vi.fn(async () => new Map()), dsc: vi.fn(async () => new Map()), running };
    const planned = await planWindowsResources(resources, inventory, checker);
    expect(running).toHaveBeenCalledWith(["Tool.Busy", "Tool.Idle"]);
    expect(formatWindowsPlan("desktop", planned, { live: true })).toContain(
      "  ! Close busy.exe (pid 42), busy.exe (pid 43) before switching: winget cannot upgrade a running portable app " +
      "(Tool.Busy), and a failed upgrade can remove its command.");
    expect(formatWindowsPlan("desktop", planned, { live: true })[1]).toBe("  ~ upgrade  Tool.Busy  1.0 → 2.0  [running]");

    // Advisory: a failing probe reports nothing instead of failing the plan.
    const failing: WindowsPlanChecker = { ...checker, running: vi.fn(async () => { throw new Error("no pwsh"); }) };
    const quiet = await planWindowsResources(resources, inventory, failing);
    expect(quiet.some((entry) => entry.running)).toBe(false);
  });

  it("lists packages that will ask for UAC", async () => {
    const resources = [pkg("Machine.Upgrade", "2.0"), pkg("User.Upgrade", "2.0"), pkg("Machine.Install", "1.0"), pkg("Same.App", "1.0")];
    const inventory = new Map([
      ["Machine.Upgrade", { version: "1.0" }], ["User.Upgrade", { version: "1.0" }], ["Machine.Install", null], ["Same.App", { version: "1.0" }],
    ]);
    const elevation = vi.fn(async () => new Map([
      ["Machine.Upgrade", "installed machine-wide"], ["Machine.Install", "no per-user installer"],
    ]));
    const checker: WindowsPlanChecker = { scripts: vi.fn(async () => new Map()), dsc: vi.fn(async () => new Map()), elevation };
    const planned = await planWindowsResources(resources, inventory, checker);
    expect(elevation).toHaveBeenCalledWith([
      { id: "Machine.Upgrade", source: "winget", action: "upgrade", version: "2.0" },
      { id: "User.Upgrade", source: "winget", action: "upgrade", version: "2.0" },
      { id: "Machine.Install", source: "winget", action: "install", version: "1.0" },
    ]);
    expect(formatWindowsPlan("desktop", planned, { live: true })).toContain(
      "  ! Switch asks once for administrator approval (UAC) for the 2 [admin] rows " +
      "(Machine.Upgrade: installed machine-wide; Machine.Install: no per-user installer).");
  });

  it("keeps an upgrade winget cannot find by id and explains how to hand it over", async () => {
    const resources = [pkg("Microsoft.PowerShell", "7.7.0.0"), pkg("Git.Git", "2.0")];
    const inventory = new Map([["Microsoft.PowerShell", { version: "7.6.10.0" }], ["Git.Git", { version: "1.0" }]]);
    const unmatched = vi.fn(async () => new Set(["Microsoft.PowerShell"]));
    const elevation = vi.fn(async () => new Map<string, string>());
    const checker: WindowsPlanChecker = { scripts: vi.fn(async () => new Map()), dsc: vi.fn(async () => new Map()), unmatched, elevation };
    const planned = await planWindowsResources(resources, inventory, checker);
    expect(unmatched).toHaveBeenCalledWith([
      { id: "Microsoft.PowerShell", source: "winget" }, { id: "Git.Git", source: "winget" },
    ]);
    expect(planned[0]).toMatchObject({
      state: "ok", action: "keep", notUpgradable: { installed: "7.6.10.0", locked: "7.7.0.0" },
    });
    expect(planned[1]).toMatchObject({ state: "change", action: "upgrade" });
    // Only the upgrade that will run is asked about UAC.
    expect(elevation).toHaveBeenCalledWith([{ id: "Git.Git", source: "winget", action: "upgrade", version: "2.0" }]);
    const lines = formatWindowsPlan("desktop", planned, { live: true });
    expect(lines[0]).toBe("Plan for desktop: 1 change, 1 unchanged");
    expect(lines).toContain(
      "  ! Microsoft.PowerShell 7.6.10.0 was installed by another installer, so winget cannot upgrade it to 7.7.0.0; " +
      "switch keeps it. To let Winix upgrade it, uninstall that copy and switch again (Winix then installs 7.7.0.0).");

    // Advisory: a failing probe keeps the upgrade.
    const failing: WindowsPlanChecker = { ...checker, unmatched: vi.fn(async () => { throw new Error("no winget"); }) };
    expect((await planWindowsResources(resources, inventory, failing))[0]).toMatchObject({ state: "change", action: "upgrade" });
  });

  it("recognizes winget's no-installed-package exit code however it is reported", () => {
    expect(noInstalledPackage({ code: -1978335212, stdout: "" })).toBe(true);
    expect(noInstalledPackage({ code: 2316632084, stdout: "" })).toBe(true);
    expect(noInstalledPackage({ code: 0, stdout: "PowerShell 7-x64 Microsoft.PowerShell 7.7.0.0 winget" })).toBe(false);
    expect(noInstalledPackage({ code: null, stdout: "" })).toBe(false);
  });

  it("reads installed scope and installer choice from winget output", () => {
    const details = "Neovim [Neovim.Neovim]\r\nVersion: 0.12.6\r\nInstaller Category: msi\r\nInstalled Scope: Machine\r\n";
    expect(upgradeElevation(details)).toBe("installed machine-wide");
    expect(upgradeElevation(details.replace("Machine", "User"))).toBeUndefined();
    expect(upgradeElevation("No installed package found matching input criteria.")).toBeUndefined();

    const show = (url: string) => ({ code: 0, stdout: `Found x [X]\nInstaller Type: wix\nInstaller Url: ${url}\n` });
    const none = { code: 2316632084, stdout: "No applicable installer found; see logs for more details.\n" };
    expect(installElevation(show("https://e/x.msi"), none)).toBe("no per-user installer");
    expect(installElevation(show("https://e/x.msi"), show("https://e/x.zip"))).toBe("winget picks its machine-wide installer");
    expect(installElevation(show("https://e/x.zip"), show("https://e/x.zip"))).toBeUndefined();
    // Unparseable output (another language, an error) reports nothing.
    expect(installElevation({ code: 1, stdout: "Fehler" }, none)).toBeUndefined();
  });

  it.runIf(process.platform === "win32" && !!process.env.WINIX_WINGET_INTEGRATION)("asks winget about real packages", async () => {
    const prompts = await nativeWindowsPlanChecker.elevation!([
      { id: "Neovim.Neovim", source: "winget", action: "install" },
      { id: "JesseDuffield.lazygit", source: "winget", action: "install" },
    ]);
    expect(prompts.get("Neovim.Neovim")).toBe("no per-user installer");
    expect(prompts.has("JesseDuffield.lazygit")).toBe(false);
  });

  it("parses running-process probe output", () => {
    expect(parseRunningOutput('WINIX-RUNNING:[{"id":"A","name":"a.exe","pid":1},{"id":"A","name":"a.exe","pid":2},{"id":"B","name":"b.exe","pid":3}]'))
      .toEqual(new Map([["A", [{ name: "a.exe", pid: 1 }, { name: "a.exe", pid: 2 }]], ["B", [{ name: "b.exe", pid: 3 }]]]));
    expect(parseRunningOutput('WINIX-RUNNING:{"id":"A","name":"a.exe","pid":1}')).toEqual(new Map([["A", [{ name: "a.exe", pid: 1 }]]]));
    expect(parseRunningOutput("WINIX-RUNNING:[]")).toEqual(new Map());
    expect(() => parseRunningOutput("nothing")).toThrow("no result");
  });

  it.runIf(process.platform === "win32")("probes running processes natively without failing on unknown ids", async () => {
    const running = await nativeWindowsPlanChecker.running!(["Winix.Test.NotInstalled", "Another.Missing"]);
    expect(running).toEqual(new Map());
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
    // Checked through WMI without elevation; only applying needs administrator rights.
    expect([features.reboot, features.needsElevationToCheck, features.elevated]).toEqual([true, undefined, true]);
    expect(features.testScript).toContain("Win32_OptionalFeature");
    expect(features.testScript?.trim().endsWith("Test-WinixFeatures")).toBe(true);
    expect(resources.find((resource) => resource.category === "winix")?.label).toBe("Winix PowerShell helpers (used by file resources)");
  });
});

describe("Windows apply (switch)", () => {
  const planned = (resource: WindowsResourceSummary, state: PlannedResource["state"], action: string): PlannedResource =>
    ({ resource, state, action });
  const script = (name: string, overrides: Partial<WindowsResourceSummary> = {}) => summary({
    name, label: name, category: "file", shell: "pwsh", testScript: "$false", setScript: "'set'", ...overrides,
  });

  it("applies only what the plan found out of date, waiting only on pending dependencies", () => {
    const batches = planApplyBatches([
      planned(pkg("Same.App", "1.0"), "ok", "keep"),
      planned(pkg("New.App", "1.0"), "change", "install"),
      planned(script("helpers"), "ok", "keep"),
      planned(script("config", { dependsOn: ["helpers", "New App"] }), "change", "apply"),
      planned(script("check later", { needsElevationToCheck: true }), "unknown", "check"),
      planned(summary({ name: "always", category: "command", command: { executable: "cmd", arguments: ["/c", "ver"] } }), "change", "run"),
      planned(summary({ name: "registry", type: "Microsoft.Windows/Registry", category: "environment", properties: { keyPath: "HKCU\\X" } }), "change", "apply"),
    ].map((entry) => entry.resource.package ? { ...entry, resource: { ...entry.resource, name: entry.resource.package.id.replace(".", " ") } } : entry));
    expect(batches).toHaveLength(1);
    const steps = batches[0].steps;
    expect(steps.map((step) => [step.name, step.kind])).toEqual([
      ["New App", "package"], ["check later", "script"], ["always", "command"], ["registry", "dsc"], ["config", "script"],
    ]);
    // "helpers" is already in place, so config only waits for the package being installed.
    expect(steps.find((step) => step.name === "config")?.dependsOn).toEqual(["New App"]);
    expect(steps[0].package).toEqual({ id: "New.App", source: "winget", version: "1.0", action: "install" });
    expect(steps.find((step) => step.name === "registry")?.dsc).toEqual({ type: "Microsoft.Windows/Registry", properties: { keyPath: "HKCU\\X" } });
  });

  it("refuses conflicts before applying anything", () => {
    expect(() => planApplyBatches([
      planned(pkg("Exact.App", "1.0", { exact: true }), "conflict", "conflict"),
    ].map((entry) => ({ ...entry, detail: "installed 1.2, exact pin 1.0" })))).toThrow("Exact.App: installed 1.2, exact pin 1.0");
  });

  it("collects elevated work into one batch, ordered around what it depends on", () => {
    const steps: ApplyStep[] = [
      { name: "user pkg", label: "u", kind: "package", elevated: false, dependsOn: [] },
      { name: "machine pkg", label: "m", kind: "package", elevated: true, dependsOn: [] },
      { name: "feature", label: "f", kind: "script", elevated: true, dependsOn: ["user pkg"] },
      { name: "link", label: "l", kind: "script", elevated: false, dependsOn: ["machine pkg"] },
      { name: "settings", label: "s", kind: "dsc", elevated: false, dependsOn: [] },
    ];
    expect(orderBatches(steps).map((batch) => [batch.elevated, batch.steps.map((step) => step.name)])).toEqual([
      [false, ["user pkg", "settings"]],
      [true, ["machine pkg", "feature"]],
      [false, ["link"]],
    ]);
    expect(() => orderBatches([
      { name: "a", label: "a", kind: "script", elevated: false, dependsOn: ["b"] },
      { name: "b", label: "b", kind: "script", elevated: false, dependsOn: ["a"] },
    ])).toThrow("dependency cycle: a, b");
  });

  it("marks machine-wide packages from the elevation check as elevated", () => {
    const [batch] = planApplyBatches([planned(pkg("Machine.App", "2.0"), "change", "upgrade")],
      new Map([["Machine.App", "installed machine-wide"]]));
    expect(batch.elevated).toBe(true);
  });

  it("skips dependents of a failure, also in later batches, and summarizes", async () => {
    const batches: ApplyBatch[] = [
      { elevated: false, steps: [
        { name: "a", label: "A", kind: "script", elevated: false, dependsOn: [] },
        { name: "b", label: "B", kind: "script", elevated: false, dependsOn: [] },
      ] },
      { elevated: true, steps: [
        { name: "c", label: "C", kind: "package", elevated: true, dependsOn: ["a"] },
        { name: "d", label: "D", kind: "package", elevated: true, dependsOn: ["b"] },
      ] },
    ];
    const run = vi.fn(async (batch: ApplyBatch) => batch.steps.map((step): StepResult => step.name === "a"
      ? { name: "a", status: "failed", error: "boom" } : { name: step.name, status: step.name === "b" ? "unchanged" : "applied" }));
    const lines: string[] = [];
    const outcome = await applyWindowsBatches(batches, { run }, (line) => lines.push(line));
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[1][0].steps.map((step) => step.name)).toEqual(["d"]);
    expect(outcome.results).toEqual([
      { name: "a", status: "failed", error: "boom" }, { name: "b", status: "unchanged" },
      { name: "c", status: "skipped", error: "a dependency failed" }, { name: "d", status: "applied" },
    ]);
    expect(lines).toContain("  Approve the UAC prompt for the change that needs administrator rights (it can open behind other windows).");
    expect(formatApplySummary(outcome, new Map([["a", "A"], ["c", "C"]]))).toEqual([
      "Applied 1, already in place 1, failed 1, skipped 1.", "  ✗ A: boom", "  ✗ C: a dependency failed",
    ]);
  });

  it("still applies what depends on a package whose upgrade failed, but not on a failed install", async () => {
    const upgrade = { id: "Microsoft.PowerShell", source: "winget", version: "7.7.0.0", action: "upgrade" as const };
    const install = { id: "New.Tool", source: "winget", version: "1.0", action: "install" as const };
    const batches: ApplyBatch[] = [
      { elevated: false, steps: [
        { name: "pwsh", label: "Microsoft.PowerShell", kind: "package", elevated: false, dependsOn: [], package: upgrade },
        { name: "tool", label: "New.Tool", kind: "package", elevated: false, dependsOn: [], package: install },
      ] },
      { elevated: true, steps: [
        { name: "profile", label: "profile", kind: "script", elevated: true, dependsOn: ["pwsh"] },
        { name: "config", label: "config", kind: "script", elevated: true, dependsOn: ["tool"] },
      ] },
    ];
    const run = vi.fn(async (batch: ApplyBatch) => batch.steps.map((step): StepResult =>
      step.kind === "package" ? { name: step.name, status: "failed", error: "winget failed" } : { name: step.name, status: "applied" }));
    const outcome = await applyWindowsBatches(batches, { run }, () => {});
    expect(run.mock.calls[1][0].steps.map((step) => step.name)).toEqual(["profile"]);
    expect(outcome.results.map((result) => [result.name, result.status])).toEqual([
      ["pwsh", "failed"], ["tool", "failed"], ["config", "skipped"], ["profile", "applied"],
    ]);
  });

  it("reports a declined UAC prompt (or any runner error) as failures of that batch", async () => {
    const outcome = await applyWindowsBatches(
      [{ elevated: true, steps: [{ name: "m", label: "M", kind: "package", elevated: true, dependsOn: [] }] }],
      { run: async () => { throw new Error("the administrator approval (UAC) was declined"); } }, () => {});
    expect(outcome.failed).toEqual([{ name: "m", status: "failed", error: "the administrator approval (UAC) was declined" }]);
  });

  it("parses runner results", () => {
    expect(parseApplyResults('WINIX-APPLY:[{"name":"a","status":"applied"},{"name":"b","status":"failed","error":"x"}]')).toEqual([
      { name: "a", status: "applied" }, { name: "b", status: "failed", error: "x" },
    ]);
    expect(parseApplyResults('WINIX-APPLY:{"name":"a","status":"unchanged"}')).toEqual([{ name: "a", status: "unchanged" }]);
    expect(() => parseApplyResults("nothing")).toThrow("no results");
    expect(() => parseApplyResults('WINIX-APPLY:[{"name":"a","status":"weird"}]')).toThrow("invalid result");
  });

  it.runIf(process.platform === "win32")("runs scripts natively: test, set, verify; failures skip dependents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-runner-"));
    const file = join(dir, "out.txt").replaceAll("'", "''");
    try {
      const steps: ApplyStep[] = [
        { name: "write", label: "write", kind: "script", elevated: false, dependsOn: [], shell: "pwsh",
          testScript: `(Test-Path -LiteralPath '${file}')`, setScript: `Set-Content -LiteralPath '${file}' -Value 'hi'; Write-Host 'wrote it'` },
        { name: "broken", label: "broken", kind: "script", elevated: false, dependsOn: [], shell: "pwsh",
          testScript: "$false", setScript: "'no-op'" },
        { name: "after", label: "after", kind: "script", elevated: false, dependsOn: ["broken"], shell: "pwsh",
          testScript: "$false", setScript: "'never'" },
        { name: "winps", label: "winps", kind: "script", elevated: false, dependsOn: [], shell: "powershell",
          testScript: "$PSVersionTable.PSEdition -eq 'Desktop'", setScript: "throw 'not reached'" },
      ];
      const lines: string[] = [];
      const results = await nativeWindowsBatchRunner.run({ elevated: false, steps }, (line) => lines.push(line));
      expect(results).toEqual([
        { name: "write", status: "applied" },
        { name: "broken", status: "failed", error: "still not in the desired state after applying" },
        { name: "after", status: "skipped", error: "a dependency failed" },
        { name: "winps", status: "unchanged" },
      ]);
      expect(await readFile(join(dir, "out.txt"), "utf8")).toContain("hi");
      expect(lines.join("\n")).toContain("wrote it");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 60000);
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

describe("winget export inventory", () => {
  const exportText = JSON.stringify({ Sources: [
    { SourceDetails: { Name: "winget" }, Packages: [
      { PackageIdentifier: "Git.Git", Version: "2.56.0" },
      { PackageIdentifier: "Side.BySide", Version: "1.0" }, { PackageIdentifier: "Side.BySide", Version: "2.0" },
    ] },
    { SourceDetails: { Name: "msstore" }, Packages: [] },
  ] });
  const resource = (id: string, source = "winget") => ({ kind: "package" as const, id, source });

  it("parses exported packages by source and id", () => {
    const parsed = parseWingetExport("\uFEFF" + exportText);
    expect(parsed.sources).toEqual(new Set(["winget", "msstore"]));
    expect(parsed.versions.get("winget|git.git")).toEqual(["2.56.0"]);
    expect(parsed.versions.get("winget|side.byside")).toEqual(["1.0", "2.0"]);
    expect(() => parseWingetExport("{}")).toThrow("Invalid winget export");
  });

  it("answers from the export and confirms everything else with DSC", async () => {
    const readDsc = vi.fn(async (resources: { id: string }[]) => resources.map((entry) => entry.id === "Missing.App" ? null : { version: "9" }));
    const resources = [resource("git.git"), resource("Missing.App"), resource("Side.BySide"), resource("Store.App", "custom")];
    const snapshots = await inventoryPackages(resources, async () => parseWingetExport(exportText), readDsc);
    expect(snapshots).toEqual([{ version: "2.56.0" }, null, { version: "9" }, { version: "9" }]);
    // Absent, side-by-side and other-source packages go to DSC in one batch.
    expect(readDsc).toHaveBeenCalledTimes(1);
    expect(readDsc.mock.calls[0][0].map((entry) => entry.id)).toEqual(["Missing.App", "Side.BySide", "Store.App"]);
  });

  it("falls back to DSC for everything when the export fails", async () => {
    const readDsc = vi.fn(async (resources: unknown[]) => resources.map(() => ({ version: "1" })));
    const snapshots = await inventoryPackages([resource("Git.Git")], async () => { throw new Error("no winget"); }, readDsc);
    expect(snapshots).toEqual([{ version: "1" }]);
    expect(readDsc).toHaveBeenCalledTimes(1);
  });
});

describe("switch progress", () => {
  it("ends a dry run consistently with the plan header", () => {
    const entry = (state: PlannedResource["state"]) => ({ resource: summary({}), state, action: "x" }) as PlannedResource;
    expect(dryRunSummary([entry("ok")])).toBe("winix switch would change nothing.");
    expect(dryRunSummary([entry("change"), entry("ok")])).toBe("winix switch would apply only this change.");
    expect(dryRunSummary([entry("change"), entry("unknown")])).toBe(
      "winix switch would apply only this change, and check the unchecked one as it applies (applying it if needed).");
    expect(dryRunSummary([entry("unknown"), entry("unknown")])).toBe(
      "winix switch would apply nothing, and check the 2 unchecked ones as it applies (applying them if needed).");
    expect(dryRunSummary([entry("ok")], true, 2)).toBe('winix switch would remove the 2 items marked "- remove" (after asking).');
    expect(dryRunSummary([entry("change"), entry("unknown")], true, 1)).toBe(
      'winix switch would apply only this change, remove the item marked "- remove" (after asking), and check the unchecked one as it applies (applying it if needed).');
    expect(dryRunSummary([entry("change"), entry("conflict")])).toBe(
      "winix switch would stop before changing anything: resolve the 1 conflict first.");
    // Not checked against a machine (not native Windows): everything is unknown.
    expect(dryRunSummary([entry("unknown"), entry("unknown")], false)).toBe(
      "winix switch on that Windows machine would check these 2 resources and apply only what is out of date.");
  });

  it("formats durations", () => {
    expect([formatDuration(400), formatDuration(9_940), formatDuration(45_000), formatDuration(125_000)])
      .toEqual(["0.4s", "9.9s", "45s", "2m 05s"]);
  });

  it("turns runner lines into one line per finished step", () => {
    const lines: string[] = [];
    const log = applyProgress((line) => lines.push(line));
    for (const line of [
      "  Approve the UAC prompt for the change that needs administrator rights (it can open behind other windows).",
      "  ~ install  Proton.ProtonPass 1.43.0",
      "    ✓ Proton.ProtonPass (45s)",
      "  ~ apply  link C:\\a -> C:\\b",
      "      some output",
      "    ✗ link C:\\a -> C:\\b: still not in the desired state after applying",
    ]) log(line);
    expect(lines.map((line) => line.replace(/\([\d.]+s\)/, "(T)"))).toEqual([
      "  Approve the UAC prompt for the change that needs administrator rights (it can open behind other windows).",
      "  ~ install Proton.ProtonPass 1.43.0",
      "  ✓ install Proton.ProtonPass 1.43.0 (T)",
      "  ~ apply link C:\\a -> C:\\b",
      "      some output",
      "  ✗ apply link C:\\a -> C:\\b (T): still not in the desired state after applying",
    ]);
  });
});

describe("lock pin gaps", () => {
  it("reports every pin apply would resolve online, naming the implicit settings module", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), [
        windows.package("Git.Git"), windows.package("Valve.Steam", { version: "any" }),
        windows.settings.developer({ mode: true }),
      ])],
    }));
    const gaps = windowsLockPinGaps(null, evaluated);
    expect(gaps.map((gap) => [gap.kind, gap.label, gap.selector])).toEqual([
      ["package", "package Git.Git", "Git.Git"],
      ["module", "PowerShell module Microsoft.Windows.Settings (implicit, used by windows.settings)", "Microsoft.Windows.Settings"],
    ]);
    expect(lockGapWarnings(gaps)).toEqual([
      "Warning: winix-windows.lock is missing 2 pin(s): package Git.Git, PowerShell module Microsoft.Windows.Settings (implicit, used by windows.settings).",
      "  Until the lock contains them, every apply and switch resolves them online (\"Would pin…\" in dry runs), and --offline/--locked fail.",
      "  Pin them now with winix update --windows Git.Git Microsoft.Windows.Settings, then commit winix-windows.lock.",
      "  A mistyped package id fails at that point; find ids with winix windows search <query>.",
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

describe("embedded scripts", () => {
  // The standalone build writes non-ASCII characters as \uXXXX escapes, which a
  // String.raw template keeps as literal text (the Windows apply log printed
  // "✓" instead of a check mark).
  it("keeps String.raw templates ASCII-only", async () => {
    const { readdir } = await import("node:fs/promises");
    const sources = (await readdir("src", { recursive: true })).filter((file) => file.endsWith(".ts"));
    const offenders: string[] = [];
    for (const file of sources) {
      const text = await readFile(join("src", file), "utf8");
      for (const match of text.matchAll(/String\.raw`([^`]*)`/g)) {
        const characters = [...match[1]].filter((character) => character.charCodeAt(0) > 0x7f);
        if (characters.length > 0) offenders.push(`${file}: ${characters.join("")}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("help", () => {
  it("has help for every command the main help lists, and none for unknown ones", async () => {
    const { commandHelp, mainHelp } = await import("../src/cli/help.ts");
    const listed = [...mainHelp().matchAll(/^ {2}([a-z]+)(?: |$)/gm)].map((match) => match[1]);
    expect(listed).toEqual(expect.arrayContaining(["plan", "switch", "update", "state", "bootstrap"]));
    for (const command of listed) expect(commandHelp(command), command).toMatch(/^Usage: winix /);
    expect(commandHelp("bogus")).toBeUndefined();
    expect(commandHelp("toString")).toBeUndefined();
  });
});
