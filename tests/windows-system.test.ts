import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { evaluate, feature, host, platforms, windows, workspace } from "../src/index.ts";
import { describeWindowsDscResource, generateWindows } from "../src/backends/windows/index.ts";
import { emptyWindowsLock } from "../src/backends/windows/lockfile.ts";
import { powerShellLiteral as quote } from "../src/helpers/utils.ts";
import { windowsText } from "./helpers/windows-text.ts";

const pwsh = (() => {
  try { execFileSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

function powershell(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "winix-system-"));
  try {
    const file = join(dir, "check.ps1");
    writeFileSync(file, script);
    return execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", file], { encoding: "utf8", timeout: 30000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Unified windows.settings, windows.settings.* and windows.registry helpers", () => {
  it("emits elevated HKLM DSC resources for windows.settings.developer({ sudo, longPaths })", () => {
    const handle = windows.settings.developer({ sudo: "inline", longPaths: true });
    const resource = handle.windows!.dsc![0];
    expect(resource.elevated).toBe(true);
    expect(describeWindowsDscResource(resource)).toEqual({
      category: "settings",
      label: "Windows developer: sudo inline, long paths on",
    });
    const setScript = String(resource.properties!.setScript);
    expect(setScript).toContain("LocalMachine");
    expect(setScript).toContain("Sudo");
    expect(setScript).toContain('"value":3');
    expect(setScript).toContain("LongPathsEnabled");
    expect(setScript).toContain('"value":1');

    expect(() => windows.settings.developer({})).toThrow("at least one");
    expect(() => windows.settings.developer({ sudo: "root" as never })).toThrow("sudo");
    expect(() => windows.settings.developer({ longPaths: "yes" as never })).toThrow("boolean");
  });

  it("emits un-elevated HKCU DSC resources for windows.settings.clipboard()", () => {
    const handle = windows.settings.clipboard({ history: true });
    const resource = handle.windows!.dsc![0];
    expect(resource.elevated).toBeUndefined();
    expect(describeWindowsDscResource(resource)).toEqual({
      category: "settings",
      label: "Windows clipboard: history on",
    });
    expect(String(resource.properties!.testScript)).toContain("CurrentUser");
    expect(String(resource.properties!.testScript)).toContain("EnableClipboardHistory");
    expect(() => windows.settings.clipboard({})).toThrow("at least one");
    expect(() => windows.settings.clipboard({ history: 1 as never })).toThrow("boolean");
  });

  it("emits live SystemParametersInfo scripts for windows.settings.keyboard() and mouse() and validates bounds", () => {
    const handle = windows.settings({
      keyboard: { repeatDelay: 0, repeatSpeed: 31 },
      mouse: { speed: 12, enhancePointerPrecision: false, swapButtons: true },
    });
    const resource = handle.windows!.dsc![0];
    expect(resource.elevated).toBeUndefined();
    expect(describeWindowsDscResource(resource)).toEqual({
      category: "settings",
      label: "Windows input: keyboard delay 0, keyboard speed 31, mouse speed 12, pointer precision off, swap mouse buttons on",
    });
    const setScript = String(resource.properties!.setScript);
    expect(setScript).toContain("WinixInputNative");
    expect(setScript).toContain("0x0017");
    expect(setScript).toContain("0x000B");
    expect(setScript).toContain("0x0071");
    expect(setScript).toContain("0x0004");
    expect(setScript).toContain("0x0021");

    const kbOnly = windows.settings.keyboard({ repeatDelay: 0 });
    expect(describeWindowsDscResource(kbOnly.windows!.dsc![0]).label).toBe("Windows input: keyboard delay 0");
    const mouseOnly = windows.settings.mouse({ speed: 10 });
    expect(describeWindowsDscResource(mouseOnly.windows!.dsc![0]).label).toBe("Windows input: mouse speed 10");

    expect(() => windows.settings.keyboard({})).toThrow("at least one");
    expect(() => windows.settings.keyboard({ repeatDelay: 4 as never })).toThrow("0 to 3");
    expect(() => windows.settings.keyboard({ repeatSpeed: 32 })).toThrow("0 to 31");
    expect(() => windows.settings.mouse({ speed: 0 })).toThrow("1 to 20");
    expect(() => windows.settings.mouse({ speed: 21 })).toThrow("1 to 20");
    expect(() => windows.settings.mouse({ enhancePointerPrecision: "off" as never })).toThrow("boolean");
  });

  it("supports all 10 section helpers and keeps per-user settings free of elevation and MS Settings module", () => {
    const perUserOnly = feature("per-user", ({ windows }) => {
      windows.settings.theme({ colorMode: { apps: "dark", system: "light" }, accentColor: "#0078D4" });
      windows.settings.explorer({ showExtensions: true, compactMode: true, startupDelay: false, waitForIdle: false });
      windows.settings.taskbar({ autoHide: true, search: "hidden", taskView: false, widgets: false, endTask: true });
      windows.settings.clipboard({ history: true });
      windows.settings.keyboard({ repeatDelay: 0, repeatSpeed: 31 });
      windows.settings.mouse({ speed: 12, enhancePointerPrecision: false });
    });
    const hosts = evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [perUserOnly()])] }));
    const out = generateWindows(hosts, emptyWindowsLock(), "D:\\config");
    expect(out.resources.desktop.some((r) => r.elevated)).toBe(false);
    expect(out.resources.desktop.some((r) => r.type === "Microsoft.Windows.Settings/WindowsSettings")).toBe(false);
    expect(out.resources.desktop.some((r) => r.name === "Ensure Microsoft Windows Settings module")).toBe(false);
  });

  it("splits unified windows.settings() cleanly into minimal buckets and wires multi-resource dependsOn", () => {
    const combined = feature("combined", ({ windows }) => {
      const base = windows.settings({
        developer: { mode: true, sudo: "inline", longPaths: true },
        theme: { colorMode: "dark", transparency: true },
        explorer: { showExtensions: true, startupDelay: false },
        clipboard: { history: true },
        keyboard: { repeatDelay: 0 },
      });
      windows.registry.set("HKCU\\Software\\WinixExample", "Ready", 1, { dependsOn: base });
      windows.settings.start({ folders: ["documents", "settings"], showRecent: false });
      windows.settings.time({ zone: "Romance Standard Time", automaticZone: false });
      windows.settings.notifications({ usbErrors: true, weakCharger: false });
    });
    const hosts = evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [combined()])] }));
    const lock = {
      ...emptyWindowsLock(),
      modules: {
        "microsoft.windows.settings": {
          repository: "PSGallery",
          version: "0.1.0-alpha.6",
          resolvedAt: "2026-06-24T18:37:00.000Z",
        },
      },
    };
    const out = generateWindows(hosts, lock, "D:\\config");
    const reg = out.resources.desktop.find((r) => r.type === "Microsoft.Windows/Registry")!;
    // All 6 buckets produced by `base` become dependencies of `Ready`.
    expect(reg.dependsOn).toHaveLength(6);
    expect(reg.dependsOn).toContain("Windows Settings");
    expect(reg.dependsOn).toContain("Windows developer sudo inline long paths on");
    expect(reg.dependsOn).toContain("Windows personalization");
    expect(reg.dependsOn).toContain("Explorer startup startup delay off");
    expect(reg.dependsOn).toContain("Windows clipboard history on");
    expect(reg.dependsOn).toContain("Windows input keyboard delay 0");
  });

  it("emits Microsoft.Windows/Registry resources with automatic elevation and typed valueData", () => {
    const userSet = windows.registry.set("HKCU\\Software\\WinixTest", "Theme", "dark");
    expect(userSet.windows!.dsc![0].resourceType).toBe("Microsoft.Windows/Registry");
    expect(userSet.windows!.dsc![0].elevated).toBeUndefined();
    expect(userSet.windows!.dsc![0].properties).toEqual({
      keyPath: "HKCU\\Software\\WinixTest",
      valueName: "Theme",
      _exist: true,
      valueData: { String: "dark" },
    });

    const machineDword = windows.registry.set("HKLM\\SOFTWARE\\WinixTest", "Enabled", 1);
    expect(machineDword.windows!.dsc![0].elevated).toBe(true);
    expect(machineDword.windows!.dsc![0].properties).toEqual({
      keyPath: "HKLM\\SOFTWARE\\WinixTest",
      valueName: "Enabled",
      _exist: true,
      valueData: { DWord: 1 },
    });

    const expandStr = windows.registry.set("HKCU\\Software\\WinixTest", "Bin", "%USERPROFILE%\\bin", { type: "expandString" });
    expect(expandStr.windows!.dsc![0].properties!.valueData).toEqual({ ExpandString: "%USERPROFILE%\\bin" });

    const qword = windows.registry.set("HKCU\\Software\\WinixTest", "Big", 4294967296, { type: "qword" });
    expect(qword.windows!.dsc![0].properties!.valueData).toEqual({ QWord: 4294967296 });

    const multi = windows.registry.set("HKCU\\Software\\WinixTest", "List", ["a", "b"]);
    expect(multi.windows!.dsc![0].properties!.valueData).toEqual({ MultiString: ["a", "b"] });

    const bin = windows.registry.set("HKCU\\Software\\WinixTest", "Bytes", [0, 255]);
    expect(bin.windows!.dsc![0].properties!.valueData).toEqual({ Binary: [0, 255] });

    const defaultVal = windows.registry.set("HKCU\\Software\\WinixTest", "", "fallback");
    expect(describeWindowsDscResource(defaultVal.windows!.dsc![0]).label).toBe("Registry set HKCU\\Software\\WinixTest\\(Default)");

    const removeValue = windows.registry.remove("HKCU\\Software\\WinixTest", "Old");
    expect(removeValue.windows!.dsc![0].properties).toEqual({
      keyPath: "HKCU\\Software\\WinixTest",
      valueName: "Old",
      _exist: false,
    });

    const removeKey = windows.registry.remove("HKLM\\SOFTWARE\\WinixTest");
    expect(removeKey.windows!.dsc![0].elevated).toBe(true);
    expect(removeKey.windows!.dsc![0].properties).toEqual({
      keyPath: "HKLM\\SOFTWARE\\WinixTest",
      _exist: false,
    });

    const overrideUnElevated = windows.registry.remove("HKLM\\SOFTWARE\\WinixTest", { elevated: false });
    expect(overrideUnElevated.windows!.dsc![0].elevated).toBeUndefined();

    expect(() => windows.registry.set("HKCU:\\Software\\WinixTest", "A", 1)).toThrow("omit the colon");
    expect(() => windows.registry.set("HKCU", "A", 1)).toThrow("subkey");
    expect(() => windows.registry.set("HKXX\\Software\\WinixTest", "A", 1)).toThrow("registry hive");
    expect(() => windows.registry.set("HKCU\\Software\\WinixTest", "Empty", [])).toThrow("opts.type");
    expect(() => windows.registry.set("HKCU\\Software\\WinixTest", "BadByte", [256], { type: "binary" })).toThrow("0 to 255");
    expect(() => windows.registry.set("HKCU\\Software\\WinixTest", "Neg", -1)).toThrow("0 to 4294967295");
  });

  it("collects injected effects and wires dependsOn through host generation", () => {
    const prefs = feature("prefs", ({ windows }) => {
      const dev = windows.settings.developer({ sudo: "inline", longPaths: true });
      const clip = windows.settings.clipboard({ history: true }, { dependsOn: dev });
      const inp = windows.settings.keyboard({ repeatDelay: 0, repeatSpeed: 31 }, { dependsOn: clip });
      windows.registry.set("HKCU\\Software\\WinixExample", "Ready", 1, { dependsOn: inp });
      windows.registry.remove("HKCU\\Software\\WinixExample", "Legacy");
    });
    const hosts = evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [prefs()])] }));
    expect(hosts[0].windows.dsc).toHaveLength(5);
    const json = windowsText(generateWindows(hosts, emptyWindowsLock(), "D:\\config"), "desktop");
    expect(json).toContain("Windows developer sudo inline long paths on");
    expect(json).toContain("Windows clipboard history on");
    expect(json).toContain("Windows input keyboard delay 0 keyboard speed 31");
    expect(json).toContain("Microsoft.Windows/Registry");
    expect(json).toContain("dependsOn");
  });
});

describe.skipIf(!pwsh)("Generated PowerShell for settings buckets", () => {
  it("parses all get/test/set scripts without syntax errors", () => {
    const resources = [
      windows.settings.developer({ sudo: "inline", longPaths: true }).windows!.dsc![0].properties!,
      windows.settings.clipboard({ history: true }).windows!.dsc![0].properties!,
      windows.settings({
        keyboard: { repeatDelay: 0, repeatSpeed: 31 },
        mouse: { speed: 10, enhancePointerPrecision: true, swapButtons: false },
      }).windows!.dsc![0].properties!,
    ];
    for (const properties of resources) {
      for (const script of Object.values(properties)) {
        const output = powershell(`$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseInput(${quote(String(script))}, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw ($errors | Out-String) }
Write-Output 'parsed'`);
        expect(output.trim()).toBe("parsed");
      }
    }
  }, 30000);
});
