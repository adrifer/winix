import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { evaluate, host, platforms, windows, workspace, type Fragment } from "../src/index.ts";
import { generateWindows } from "../src/backends/windows/index.ts";
import {
  collectWindowsModules, emptyWindowsLock, readWindowsLock, reconcileInlinePins,
  resolveWindowsLockEntries, resolveWindowsModuleLockEntries, serializeWindowsLock,
  type WindowsLock,
} from "../src/backends/windows/lockfile.ts";
import { powerShellModuleProperties, resolvePowerShellModuleVersion } from "../src/backends/windows/powershell.ts";
import { resolveWindowsFileProperties } from "../src/helpers/windows.ts";
import { windowsSourcePath } from "../src/backends/windows/paths.ts";
import { powerShellLiteral } from "../src/helpers/utils.ts";
import type { WinDscProperties } from "../src/types/windows.ts";

function hosts(entries: Fragment[]) {
  return evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), entries)] }));
}

function fileProperties(fragment: Fragment, configDir?: string) {
  return resolveWindowsFileProperties(fragment.windows!.dsc![0], configDir)!;
}

const module = { name: "Terminal-Icons", repository: "PSGallery" };
const pin = { repository: "PSGallery", version: "0.11.0", resolvedAt: "2026-11-11T00:00:00.000Z" };
const hasPowerShell7 = (() => {
  try {
    execFileSync("pwsh", ["-NoProfile", "-NonInteractive", "-Command", "exit 0"], { stdio: "ignore" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
})();

describe("Windows shell primitives", () => {
  it("resolves known folders at activation, preserving quoted child paths", () => {
    const target = windows.knownFolder.documents("PowerShell\\owner's profile.ps1");
    for (const fragment of [
      windows.file.text(target, "profile"),
      windows.file.copy(target, "%USERPROFILE%\\source.ps1"),
      windows.file.symlink(target, "%USERPROFILE%\\source.ps1"),
      windows.file.remove(target),
    ]) {
      const properties = fileProperties(fragment);
      for (const key of ["getScript", "testScript", "setScript"]) {
        expect(properties[key]).toContain("[Environment]::GetFolderPath('MyDocuments')");
        expect(properties[key]).toContain("owner''s profile.ps1");
        expect(properties[key]).toContain("Windows known folder is unavailable");
      }
    }
    expect(() => windows.knownFolder.documents("..\\secret")).toThrow(/relative/);
    expect(() => windows.knownFolder.documents("C:\\elsewhere")).toThrow(/relative/);
    expect(() => windows.knownFolder.documents("D:elsewhere")).toThrow(/relative/);
  });

  it.each([
    ["D:\\repo with spaces\\winix", "..\\windows\\profile.ps1", "D:\\repo with spaces\\windows\\profile.ps1"],
    ["/home/user/dotfiles/winix", "../windows/profile.ps1", "/home/user/dotfiles/windows/profile.ps1"],
  ])("anchors copy and symlink sources to config directory %s", (dir, source, expected) => {
    for (const create of [windows.file.copy, windows.file.symlink]) {
      const fragment = create("%USERPROFILE%\\profile.ps1", source);
      expect(fileProperties(fragment, dir).setScript).toContain(`$source = Expand-WinixPath '${expected}'`);
      expect(() => fileProperties(fragment)).toThrow(/configDir/);
    }
  });

  it("preserves absolute/environment sources and accepts module-relative file URLs", () => {
    for (const source of ["C:\\files\\profile.ps1", "\\\\server\\share\\profile.ps1", "%USERPROFILE%\\profile.ps1"]) {
      expect(fileProperties(windows.file.symlink("target", source), "D:\\config").setScript).toContain(`'${source}'`);
    }
    const source = join(process.cwd(), "profile.ps1");
    expect(fileProperties(windows.file.symlink("target", pathToFileURL(source))).setScript).toContain(`'${source}'`);
    expect(() => windows.file.copy("target", new URL("https://example.com/profile"))).toThrow();
  });

  it("translates WSL filesystem sources to Windows drive or UNC paths and reports conversion errors", () => {
    const convert = vi.fn(() => "D:\\dotfiles\\profile.ps1\n");
    expect(windowsSourcePath("/mnt/d/dotfiles/profile.ps1", "linux", "NixOS", convert)).toBe("D:\\dotfiles\\profile.ps1");
    expect(windowsSourcePath("/home/user/profile.ps1", "linux", "NixOS",
      () => "\\\\wsl.localhost\\NixOS\\home\\user\\profile.ps1")).toContain("\\\\wsl.localhost\\");
    expect(windowsSourcePath("D:\\profile.ps1", "linux", "NixOS", convert)).toBe("D:\\profile.ps1");
    expect(windowsSourcePath("/home/user/profile.ps1", "linux", "", convert)).toBe("/home/user/profile.ps1");
    expect(convert).toHaveBeenCalledTimes(1);
    expect(() => windowsSourcePath("/mnt/d/profile.ps1", "linux", "NixOS", () => "")).toThrow(/Cannot translate/);
  });

  it("collects module effects and dependencies without treating known folders as fragments", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), ({ windows }) => {
        const pwsh = windows.package({ id: "Microsoft.PowerShell", version: "7.6.0" });
        const icons = windows.powershell.module("Terminal-Icons", { dependsOn: pwsh });
        windows.file.symlink(windows.knownFolder.documents("PowerShell\\profile.ps1"),
          "../windows/profile.ps1", { dependsOn: icons, backup: true });
      })],
    }));
    expect(collectWindowsModules(evaluated).size).toBe(1);
    const lock: WindowsLock = { ...emptyWindowsLock(), modules: { "terminal-icons": pin } };
    const doc = generateWindows(evaluated, lock, "D:\\dotfiles\\winix").hosts.desktop["configuration.winget"];
    expect(doc).toContain("dependsOn: [\"PowerShell module Terminal Icons\"]");
    expect(doc).toContain("Microsoft PowerShell");
    expect(doc).not.toContain("kind:");
    expect(doc).toContain("D:\\dotfiles\\windows\\profile.ps1");
  });

  it("requires a matching module pin instead of emitting a floating install", () => {
    const evaluated = hosts([windows.powershell.module("Terminal-Icons")]);
    expect(() => generateWindows(evaluated)).toThrow(/no matching pin/);
    expect(() => generateWindows(evaluated, {
      ...emptyWindowsLock(), modules: { "terminal-icons": { ...pin, repository: "Other" } },
    })).toThrow(/no matching pin/);
    expect(() => windows.powershell.module("Terminal-*")).toThrow(/module name/);
  });

  it("collects startup commands by effect and preserves resource dependencies", () => {
    const evaluated = evaluate(workspace({
      inputs: {},
      hosts: [host("desktop", platforms.windows(), ({ windows }) => {
        const app = windows.package({ id: "Example.App", version: "1.0" });
        windows.startup.command("Example", {
          executable: "%ProgramFiles%/Example/app.exe",
          arguments: ["--config", windows.knownFolder.appData("Example/config.json"), "%LITERAL%"],
          workingDirectory: windows.knownFolder.userProfile(),
          windowStyle: "minimized",
          dependsOn: app,
          backup: true,
        });
      })],
    }));
    const doc = generateWindows(evaluated).hosts.desktop["configuration.winget"];
    expect(doc).toContain('name: "Startup Example"');
    expect(doc).toContain('dependsOn: ["Example App"]');
    expect(doc).toContain("GetFolderPath('Startup')");
    expect(doc).not.toContain("Start-Process");
    const script = evaluated[0].windows!.dsc![0].properties!.setScript;
    expect(script).toContain("'--config', (& {");
    expect(script).toContain("'%LITERAL%'");
  });

  it("rejects startup path traversal, reserved filenames, malformed commands, and null arguments", () => {
    for (const name of ["", "../escape", "bad\\name", "CON", "nul.txt", "name.", "bad:name"]) {
      expect(() => windows.startup.command(name, { executable: "app.exe" })).toThrow(/shortcut name/);
    }
    expect(() => windows.startup.command("app", { executable: "" })).toThrow(/executable/);
    expect(() => windows.startup.command("app", { executable: "app.exe", arguments: ["bad\0arg"] })).toThrow(/arguments/);
    expect(() => windows.startup.command("app", { executable: "app.exe", workingDirectory: "" })).toThrow(/workingDirectory/);
  });
});

describe("PowerShell module locking", () => {
  it.skipIf(!hasPowerShell7)("replaces a same-version prerelease with the stable pin and then remains idempotent", () => {
    const properties = powerShellModuleProperties(
      { name: "PSReadLine", repository: "PSGallery" }, { ...pin, version: "2.2.0" },
    );
    const output = runPowerShell7(`
$script:prerelease = 'beta4'
$script:installs = 0
function Get-Module {
  param([switch]$ListAvailable, [string]$Name)
  [pscustomobject]@{ Version = [version]'2.2.0'; PrivateData = @{ PSData = @{ Prerelease = $script:prerelease } } }
}
function Install-PSResource {
  [CmdletBinding()]
  param([string]$Name, [string]$Version, [string]$Repository, [string]$Scope,
    [switch]$TrustRepository, [switch]$AcceptLicense, [switch]$Reinstall)
  if (-not $Reinstall) { throw 'Must replace the conflicting prerelease' }
  $script:prerelease = ''
  $script:installs++
}
$test = { ${properties.testScript} }
$set = { ${properties.setScript} }
if (& $test) { throw 'Prerelease incorrectly satisfied the stable pin' }
& $set
if (-not (& $test)) { throw 'Stable installation was not detected' }
& $set
if ($script:installs -ne 1) { throw 'Stable installation was repeated' }
'STABLE_MODULE_OK'
`);
    expect(output).toContain("STABLE_MODULE_OK");
  });

  it("adds pins without changing package pins, reuses them offline, and explicitly updates them", () => {
    const lock: WindowsLock = {
      ...emptyWindowsLock(),
      packages: { "Git.Git": { source: "winget", version: "2.0", resolvedAt: "old" } },
    };
    const resolve = vi.fn(() => "0.11.0");
    const first = resolveWindowsModuleLockEntries(lock, [module], resolve);
    expect(first.lock.modules?.["terminal-icons"]).toMatchObject({ repository: "PSGallery", version: "0.11.0" });
    expect(first.lock.packages).toEqual(lock.packages);
    expect(lock.modules).toBeUndefined();
    const offline = () => { throw new Error("must not query repository"); };
    expect(resolveWindowsModuleLockEntries(first.lock, [module], offline, new Date(), true).lock).toBe(first.lock);
    const next = resolveWindowsModuleLockEntries(first.lock, [module], () => "0.12.0");
    expect(next.resolutions[0]).toMatchObject({ previousVersion: "0.11.0", version: "0.12.0", status: "updated" });
    const packageUpdate = resolveWindowsLockEntries(next.lock, [{ id: "Git.Git", source: "winget" }], () => "3.0");
    expect(packageUpdate.lock.modules).toEqual(next.lock.modules);
    expect(reconcileInlinePins(next.lock, hosts([])).modules).toEqual(next.lock.modules);
  });

  it("rejects conflicting repositories and requires explicit updates for repository changes", () => {
    expect(() => collectWindowsModules(hosts([
      windows.powershell.module("Terminal-Icons"),
      windows.powershell.module("terminal-icons", { repository: "Other" }),
    ]))).toThrow(/conflicting repositories/);
    expect(() => resolveWindowsModuleLockEntries(
      { ...emptyWindowsLock(), modules: { "terminal-icons": pin } },
      [{ ...module, repository: "Other" }], () => "0.12.0", new Date(), true
    )).toThrow(/changed repository/);
    expect(() => resolveWindowsModuleLockEntries(emptyWindowsLock(), [module], () => "0.12.0-beta")).toThrow(/stable version/);
  });

  it("round-trips module entries and rejects malformed module locks", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-module-lock-"));
    try {
      const lock: WindowsLock = { ...emptyWindowsLock(), modules: { "terminal-icons": pin } };
      await writeFile(join(dir, "winix-windows.lock"), serializeWindowsLock(lock));
      expect(readWindowsLock(dir)).toEqual(lock);
      await writeFile(join(dir, "winix-windows.lock"), JSON.stringify({
        ...lock, modules: { "terminal-icons": { ...pin, version: "latest" } },
      }));
      expect(() => readWindowsLock(dir)).toThrow(/invalid repository, stable version/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves stable Gallery versions through structured output and surfaces errors", () => {
    expect(resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", (script) => {
      expect(script).toContain("Find-PSResource -Name 'Terminal-Icons' -Repository 'PSGallery'");
      expect(script).not.toContain("-Prerelease");
      return '"0.11.0"';
    })).toBe("0.11.0");
    for (const result of ['"0.12.0-beta"', "warning\n0.11.0", '""']) {
      expect(() => resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", () => result)).toThrow(/Failed to resolve/);
    }
    expect(() => resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", () => {
      throw new Error("network unavailable");
    })).toThrow(/network unavailable/);
  });

  it("keeps Unicode script data ASCII on the DSC transport without expanding PowerShell syntax", () => {
    const properties = fileProperties(windows.file.text("C:\\caf\u00e9\\profile", '\u{1f680} "$HOME" ` literal'));
    for (const script of Object.values(properties)) {
      expect(script).not.toMatch(/[^\x00-\x7f]/);
    }
    expect(properties.setScript).toContain("`u{1f680}");
    expect(properties.setScript).toContain('`"`$HOME');
  });
});

function runPowerShell7(script: string): string {
  return execFileSync("pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command",
    "$ErrorActionPreference = 'Stop'; & ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String([Console]::In.ReadToEnd()))))",
  ], { encoding: "utf8", input: Buffer.from(script).toString("base64"), stdio: ["pipe", "pipe", "pipe"] }).trim();
}

interface DscResult {
  inDesiredState?: boolean;
  actualState?: { output?: unknown[]; valueData?: { String?: string } };
}

function runDsc(
  operation: "get" | "test" | "set",
  properties: WinDscProperties,
  resource = "Microsoft.DSC.Transitional/PowerShellScript"
): DscResult {
  return JSON.parse(execFileSync("dsc", [
    "resource", operation, "--resource", resource, "--file", "-",
  ], {
    encoding: "utf8", input: JSON.stringify(properties),
    stdio: ["pipe", "pipe", "pipe"], timeout: 30000,
  }));
}

describe.skipIf(process.platform !== "win32" || process.env.WINIX_DSC_INTEGRATION !== "1")("native Windows DSC execution", () => {
  it("manages Startup shortcuts without launching, preserves argv, and protects existing entries", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix startup's \u00e9 "));
    const name = "Winix-\u00e9";
    const target = join(dir, `${name}.lnk`);
    const values = ["", "two words", 'quote"inside', 'backslash\\"quote', "C:\\trailing dir\\", "plain\\", "$literal %PATH% caf\u00e9 \u4e2d\u6587 \u{1f680}"];
    const executable = join(dir, "\u4e2d\u6587.exe");
    const spec = {
      executable,
      arguments: [...values, windows.knownFolder.userProfile("startup folder")],
      workingDirectory: dir,
      windowStyle: "minimized" as const,
    };
    const isolated = (backup: boolean) => {
      const properties = windows.startup.command(name, { ...spec, backup }).windows!.dsc![0].properties!;
      return Object.fromEntries(Object.entries(properties).map(([key, script]) => [
        key, String(script).replace(
          "$startup = [Environment]::GetFolderPath('Startup')", `$startup = ${powerShellLiteral(dir)}`
        ),
      ]));
    };
    try {
      await writeFile(executable, "This file must never be executed.");
      const properties = isolated(true);
      expect(runDsc("test", properties).inDesiredState).toBe(false);
      runDsc("set", properties);
      expect(runDsc("test", properties).inDesiredState).toBe(true);
      const actual = JSON.parse(runPowerShell7(`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WinixArgv {
  [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
  public static extern IntPtr CommandLineToArgvW(string input, out int count);
  [DllImport("kernel32.dll")]
  public static extern IntPtr LocalFree(IntPtr pointer);
}
'@
$link = (New-Object -ComObject Shell.Application).NameSpace(${powerShellLiteral(dir)}).ParseName(${powerShellLiteral(`${name}.lnk`)}).GetLink()
$count = 0
$pointer = [WinixArgv]::CommandLineToArgvW('ignored.exe ' + $link.Arguments, [ref]$count)
try {
  $values = @(for ($index = 1; $index -lt $count; $index++) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($pointer, $index * [IntPtr]::Size))
  })
  @{ Values = $values; Target = $link.Path; Directory = $link.WorkingDirectory; Style = $link.ShowCommand } | ConvertTo-Json -Compress
} finally { [WinixArgv]::LocalFree($pointer) | Out-Null }
`));
      expect(actual.Values).toEqual([...values, join(process.env.USERPROFILE!, "startup folder")]);
      expect(actual.Target).toBe(executable);
      expect(actual.Directory).toBe(dir);
      expect(actual.Style).toBe(7);
      const bytes = await readFile(target);
      runDsc("set", properties);
      expect(await readFile(target)).toEqual(bytes);
      const mutate = () => runPowerShell7(`
$link = (New-Object -ComObject WScript.Shell).CreateShortcut(${powerShellLiteral(target)})
$link.Arguments = 'obsolete'
$link.Save()
`);
      mutate();
      const conflicting = await readFile(target);
      expect(() => runDsc("set", isolated(false))).toThrow();
      expect(await readFile(target)).toEqual(conflicting);
      runDsc("set", properties);
      expect(await readFile(target + ".bak")).toEqual(conflicting);
      mutate();
      expect(() => runDsc("set", properties)).toThrow();
      expect(await readFile(target + ".bak")).toEqual(conflicting);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("runs module get/test/set directly through DSC PowerShell 7 without installing anything", () => {
    const properties = powerShellModuleProperties(
      { name: "Microsoft.PowerShell.Utility", repository: "PSGallery" },
      { ...pin, version: "7.0.0.0" }
    );
    expect(runDsc("test", properties).inDesiredState).toBe(true);
    runDsc("set", properties);
    expect(runDsc("get", properties).actualState?.output).toContainEqual({
      Name: "Microsoft.PowerShell.Utility", Version: "7.0.0.0",
    });
    const missing = powerShellModuleProperties({ name: "Winix-Definitely-Missing", repository: "PSGallery" }, pin);
    expect(runDsc("test", missing).inDesiredState).toBe(false);
    const invalid = powerShellModuleProperties(
      { name: "Microsoft.PowerShell.Utility", repository: "PSGallery" },
      { ...pin, version: "invalid" }
    );
    expect(() => runDsc("test", invalid)).toThrow();
  }, 120000);

  it("creates live config-relative symlinks, preserves backups, and rejects backup collisions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix shell's "));
    try {
      await mkdir(join(dir, "config"));
      await writeFile(join(dir, "source.ps1"), "first");
      const target = join(dir, "profile.ps1");
      await writeFile(target, "original");
      const properties = fileProperties(
        windows.file.symlink(target, "..\\source.ps1", { backup: true }), join(dir, "config")
      );
      expect(runDsc("test", properties).inDesiredState).toBe(false);
      runDsc("set", properties);
      expect(await readlink(target)).toBe(join(dir, "source.ps1"));
      expect(await readFile(`${target}.bak`, "utf8")).toBe("original");
      await writeFile(join(dir, "source.ps1"), "second");
      expect(await readFile(target, "utf8")).toBe("second");
      expect(runDsc("test", properties).inDesiredState).toBe(true);
      runDsc("set", properties);
      await rm(target);
      await writeFile(target, "different");
      expect(() => runDsc("set", properties)).toThrow();
      expect(await readFile(target, "utf8")).toBe("different");
      expect(await readFile(`${target}.bak`, "utf8")).toBe("original");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("evaluates the Documents known folder in PowerShell 7 rather than generator environment", () => {
    const properties = fileProperties(windows.file.text(
      windows.knownFolder.documents("Winix-nonexistent-profile"), ""
    ));
    const expected = runPowerShell7("[Environment]::GetFolderPath('MyDocuments')");
    const target = runPowerShell7(`${properties.getScript}\n$target`);
    expect(target).toBe(join(expected, "Winix-nonexistent-profile"));
  });

  it("writes UTF-8 files, copies them, and safely removes files through DSC PowerShell 7", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-pwsh-\u00e9-"));
    try {
      const source = join(dir, "source.txt");
      const content = 'caf\u00e9 \u2713 \u{1f680} "$HOME" ` literal\n';
      const text = fileProperties(windows.file.text(source, content));
      runDsc("set", text);
      expect(runDsc("test", text).inDesiredState).toBe(true);
      expect(await readFile(source, "utf8")).toBe(content);
      const target = join(dir, "copy.txt");
      const copy = fileProperties(windows.file.copy(target, source));
      runDsc("set", copy);
      expect(runDsc("test", copy).inDesiredState).toBe(true);
      const remove = fileProperties(windows.file.remove(target));
      runDsc("set", remove);
      expect(runDsc("test", remove).inDesiredState).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);

  it("reads PATH through DSC PowerShell 7 without modifying existing entries", () => {
    const unique = `C:\\Winix-absent-${randomUUID()}`;
    const add = windows.path.add(unique).windows!.dsc![0].properties!;
    const remove = windows.path.remove(unique).windows!.dsc![0].properties!;
    expect(runDsc("test", add).inDesiredState).toBe(false);
    expect(runDsc("test", remove).inDesiredState).toBe(true);
    expect(runDsc("get", add).actualState?.output).toBeDefined();
  }, 120000);

  it("sets and removes an isolated user environment value through native Registry DSC", () => {
    const name = `WINIX_PWSH_PROBE_${randomUUID().replaceAll("-", "")}`;
    const value = "Winix PowerShell 7";
    const set = windows.env.set(name, value).windows!.dsc![0];
    const remove = windows.env.remove(name).windows!.dsc![0];
    try {
      runDsc("set", set.properties!, set.resourceType);
      expect(runDsc("get", set.properties!, set.resourceType).actualState?.valueData?.String).toBe(value);
      expect(runPowerShell7(`[Environment]::GetEnvironmentVariable('${name}', 'User')`)).toBe(value);
    } finally {
      runDsc("set", remove.properties!, remove.resourceType);
    }
    expect(runPowerShell7(`[Environment]::GetEnvironmentVariable('${name}', 'User')`)).toBe("");
  }, 120000);

  it("applies a generated PowerShell 7 bundle through winget using only temporary state", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-pwsh-winget-"));
    const name = `WINIX_PWSH_PROBE_${randomUUID().replaceAll("-", "")}`;
    const remove = windows.env.remove(name).windows!.dsc![0];
    try {
      const source = join(dir, "source.txt");
      const link = join(dir, "linked.txt");
      const rawOutput = join(dir, "raw.txt");
      const evaluated = evaluate(workspace({
        inputs: {},
        hosts: [host("probe", platforms.windows(), ({ windows }) => {
          const file = windows.file.text(source, "caf\u00e9 \u{1f680}\n");
          windows.file.symlink(link, source, { dependsOn: file });
          windows.raw(`[IO.File]::WriteAllText('${rawOutput.replaceAll("'", "''")}', "$($PSVersionTable.PSEdition):$($PSVersionTable.PSVersion.Major)")`);
          windows.powershell.module("Microsoft.PowerShell.Utility");
          windows.env.set(name, "verified");
        })],
      }));
      const lock: WindowsLock = {
        ...emptyWindowsLock(),
        modules: { "microsoft.powershell.utility": { ...pin, version: "7.0.0.0" } },
      };
      const bundle = generateWindows(evaluated, lock, dir).hosts.probe;
      const config = join(dir, "configuration.winget");
      await writeFile(config, bundle["configuration.winget"]);
      execFileSync("winget", [
        "configure", "--file", config,
        "--accept-configuration-agreements", "--disable-interactivity",
      ], { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], timeout: 90000 });
      expect(await readFile(source, "utf8")).toBe("caf\u00e9 \u{1f680}\n");
      expect(await readlink(link)).toBe(source);
      expect(await readFile(rawOutput, "utf8")).toBe("Core:7");
      expect(runPowerShell7(`[Environment]::GetEnvironmentVariable('${name}', 'User')`)).toBe("verified");
    } finally {
      runDsc("set", remove.properties!, remove.resourceType);
      await rm(dir, { recursive: true, force: true });
    }
  }, 120000);
});
