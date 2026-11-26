import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { windowsText } from "./helpers/windows-text.ts";
import { describe, expect, it } from "vitest";
import { evaluate, feature, host, platforms, windows, workspace } from "../src/index.ts";
import { generateWindows } from "../src/backends/windows/index.ts";
import { normalizeWinSettings } from "../src/helpers/windows-settings.ts";
import { wallpaperProperties } from "../src/backends/windows/personalization.ts";
import { fontInstallPrelude } from "../src/backends/windows/fonts-runtime.ts";
import { fontsProperties } from "../src/backends/windows/fonts.ts";
import { emptyWindowsLock } from "../src/backends/windows/lockfile.ts";
import { powerShellLiteral as quote } from "../src/helpers/utils.ts";

const pwsh = (() => {
  try { execFileSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.ToString()"], { stdio: "ignore" }); return true; }
  catch { return false; }
})();

function powershell(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "winix-personalization-"));
  try {
    const file = join(dir, "check.ps1");
    writeFileSync(file, script);
    return execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-File", file], { encoding: "utf8", timeout: 30000 });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

describe("Windows personalization, wallpaper and fonts authoring", () => {
  it("maps only declared preferences and preserves accent DWORD byte order", () => {
    const normalized = normalizeWinSettings({
      theme: { accentColor: "#123456", colorMode: "dark" },
      explorer: { showExtensions: true, showHiddenFiles: false, openTo: "thisPC", showFullPathInTitleBar: true, classicContextMenu: true, compactMode: true },
      taskbar: { search: "iconAndLabel", taskView: false, widgets: true, endTask: true },
    });
    const values = normalized.personalizationDwords;
    expect(values.find((value) => value.name === "AppsUseLightTheme")?.value).toBe(0);
    expect(values.find((value) => value.name === "SystemUsesLightTheme")?.value).toBe(0);
    expect(values.find((value) => value.name === "AccentColor")?.value).toBe(0xff563412);
    expect(values.find((value) => value.name === "ColorizationColor")?.value).toBe(0xff123456);
    expect(values.find((value) => value.name === "HideFileExt")?.value).toBe(0);
    expect(values.find((value) => value.name === "Hidden")?.value).toBe(2);
    expect(values.find((value) => value.name === "FullPath")?.value).toBe(1);
    expect(values.find((value) => value.name === "UseCompactMode")?.value).toBe(1);
    expect(values.find((value) => value.name === "SearchboxTaskbarMode")?.value).toBe(3);
    expect(values.find((value) => value.name === "TaskbarEndTask")?.value).toBe(1);
    expect(normalized.classicContextMenu).toBe(true);
    expect(() => windows.settings.theme({ accentColor: "red" })).toThrow("#RRGGBB");
    expect(() => windows.settings.theme({ accentColor: "#123456", autoColorization: true })).toThrow("cannot set both");
    expect(() => windows.settings({})).toThrow("at least one");
  });

  it("supports standalone classicContextMenu without DWord values", () => {
    const enableProps = windows.settings.explorer({ classicContextMenu: true }).windows!.dsc![0].properties!;
    expect(String(enableProps.testScript)).toContain("86ca1aa0-34aa-4e8b-a509-50c905bae2a2");
    expect(String(enableProps.setScript)).toContain("CreateSubKey");
    const disableProps = windows.settings.explorer({ classicContextMenu: false }).windows!.dsc![0].properties!;
    expect(String(disableProps.setScript)).toContain("DeleteSubKeyTree");
  });

  it("collects injected effects and resolves native Windows wallpaper paths and dependencies", () => {
    const declarations = feature("desktop", ({ windows }) => {
      const prefs = windows.settings({
        explorer: { showExtensions: true },
        taskbar: { autoHide: true },
      });
      windows.wallpaper({ source: "..\\images\\desktop.jpg", style: "Fit", dependsOn: prefs });
      windows.fonts({ sources: ["..\\fonts\\font.ttf"], dependsOn: prefs });
    });
    const hosts = evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), [declarations()])] }));
    expect(hosts[0].windows.dsc).toHaveLength(3);
    const yaml = windowsText(generateWindows(hosts, emptyWindowsLock(), "D:\\config\\winix"), "desktop");
    expect(yaml).toContain("D:\\config\\images\\desktop.jpg");
    expect(yaml).toContain("D:\\\\config\\\\fonts\\\\font.ttf");
    expect(yaml).toContain("SystemParametersInfo");
    expect(yaml).toContain("SHAppBarMessage");
    expect(yaml).toContain("Windows personalization");
  });

  it("supports known folders and detects content changes without restarting Explorer", () => {
    const scripts = wallpaperProperties({
      source: windows.knownFolder.documents("wallpaper.jpg"), style: "Span",
    });
    expect(scripts.testScript).toContain("Get-FileHash");
    expect(scripts.setScript).toContain("WinixWallpaperNative");
    expect(scripts.setScript).toContain("WallpaperStyle', '22'");
    expect(scripts.setScript).not.toContain("Stop-Process");
    expect(() => windows.wallpaper({ source: "https://example.com/wallpaper.jpg" })).toThrow("local");
    expect(() => windows.wallpaper({ source: { kind: "knownFolder", folder: "documents", path: "x\\..\\y" } })).toThrow("valid");
  });
});

describe.skipIf(!pwsh)("Generated PowerShell (no desktop/font activation)", () => {
  it("parses all get/test/set scripts without executing native changes", () => {
    const resources = [
      wallpaperProperties({ source: "D:\\wallpaper.jpg" }),
      windows.settings({
        theme: { accentColor: "#123456" },
        explorer: { classicContextMenu: true, showFullPathInTitleBar: true, compactMode: true },
        taskbar: { autoHide: true, endTask: true },
      }).windows!.dsc![0].properties!,
      windows.settings.explorer({ classicContextMenu: false }).windows!.dsc![0].properties!,
      fontsProperties(["D:\\font.ttf"], emptyWindowsLock()),
    ];
    for (const properties of resources) for (const script of Object.values(properties)) {
      const output = powershell(`$tokens = $null; $errors = $null
[System.Management.Automation.Language.Parser]::ParseInput(${quote(String(script))}, [ref]$tokens, [ref]$errors) | Out-Null
if ($errors.Count) { throw ($errors | Out-String) }
Write-Output 'parsed'`);
      expect(output.trim()).toBe("parsed");
    }
  }, 30000);

  it.each(["../escape.ttf", "/escape.ttf", "dir\\escape.ttf", "C:escape.ttf"])(
    "rejects unsafe archive member %s without extracting it", (member) => {
      const dir = mkdtempSync(join(tmpdir(), "winix-font-zip-"));
      try {
        const output = powershell(`${fontInstallPrelude}
$archive = ${quote(join(dir, "fonts.zip"))}
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try { $entry = $zip.CreateEntry(${quote(member)}); $stream = $entry.Open(); $stream.WriteByte(0); $stream.Dispose() }
finally { $zip.Dispose() }
try { Expand-WinixFonts $archive ${quote(dir)} @('**/*.ttf'); throw 'accepted unsafe ZIP' }
catch { if ($_.Exception.Message -notlike 'Unsafe font ZIP entry*') { throw }; Write-Output 'rejected' }`);
        expect(output.trim()).toBe("rejected");
      } finally { rmSync(dir, { recursive: true, force: true }); }
    },
  );

  it("selects font members, rejects missing selections and duplicate basenames", () => {
    const dir = mkdtempSync(join(tmpdir(), "winix-font-members-"));
    try {
      const output = powershell(`${fontInstallPrelude}
$archive = ${quote(join(dir, "fonts.zip"))}
$zip = [IO.Compression.ZipFile]::Open($archive, [IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($name in @('a/font.ttf', 'b/font.ttf', 'license.txt')) {
    $entry = $zip.CreateEntry($name); $stream = $entry.Open(); $stream.WriteByte(0); $stream.Dispose()
  }
} finally { $zip.Dispose() }
$first = Join-Path ${quote(dir)} 'first'; New-Item -ItemType Directory $first | Out-Null
$files = @(Expand-WinixFonts $archive $first @('a/font.ttf'))
if ($files.Count -ne 1) { throw 'Wrong font selection' }
$second = Join-Path ${quote(dir)} 'second'; New-Item -ItemType Directory $second | Out-Null
try { Expand-WinixFonts $archive $second @('**/*.ttf'); throw 'accepted duplicate' }
catch { if ($_.Exception.Message -notlike 'Duplicate font filename*') { throw } }
$third = Join-Path ${quote(dir)} 'third'; New-Item -ItemType Directory $third | Out-Null
try { Expand-WinixFonts $archive $third @('missing.ttf'); throw 'accepted missing member' }
catch { if ($_.Exception.Message -notlike '*no matching*') { throw } }
Write-Output 'checked'`);
      expect(output.trim()).toBe("checked");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it("checks installed fonts and local source drift using an isolated registry mock", () => {
    const dir = mkdtempSync(join(tmpdir(), "winix-font-state-"));
    try {
      const output = powershell(`${fontInstallPrelude}
$env:LOCALAPPDATA = ${quote(dir)}
$source = Join-Path $env:LOCALAPPDATA 'source.ttf'
[IO.File]::WriteAllText($source, 'original')
$destination = Join-Path $env:LOCALAPPDATA 'Microsoft\\Windows\\Fonts'
New-Item -ItemType Directory -Path $destination -Force | Out-Null
$target = Join-Path $destination 'font.ttf'
[IO.File]::Copy($source, $target)
$hash = (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash
$manifest = Join-Path $env:LOCALAPPDATA 'manifest.json'
$plan = @(@{ path = $source })
@{ version = 1; fonts = @(@{ name = 'font.ttf'; path = $target; sha256 = $hash }); sources = @(@{ path = $source; sha256 = $hash }) } |
  ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifest
function Get-WinixFontRegistry {
  $registry = [pscustomobject]@{}
  $registry | Add-Member ScriptMethod GetValue { param($name) return $target }
  $registry | Add-Member ScriptMethod Dispose {}
  return $registry
}
if (-not (Test-WinixFonts)) { throw 'Matching font not recognized' }
[IO.File]::WriteAllText($source, 'changed')
if (Test-WinixFonts) { throw 'Local font drift not detected' }
[IO.File]::WriteAllText($source, 'original')
[IO.File]::WriteAllText($target, 'external edit')
if (Test-WinixFonts) { throw 'Installed font drift not detected' }
Write-Output 'checked'`);
      expect(output.trim()).toBe("checked");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
