import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { evaluate, feature, host, platforms, profile, windows, workspace, type Fragment } from "../src/index.ts";
import { generateWindows } from "../src/backends/windows/index.ts";
import {
  collectWindowsModules, emptyWindowsLock, readWindowsLock, reconcileInlinePins,
  resolveWindowsLockEntries, resolveWindowsModuleLockEntries, serializeWindowsLock,
  windowsModuleKey,
  type WindowsLock,
} from "../src/backends/windows/lockfile.ts";
import { powerShellModuleProperties, powerShellRepositoryScripts, resolvePowerShellModuleVersion } from "../src/backends/windows/powershell.ts";
import { resolveWindowsFileProperties, winixFileModuleProperties } from "../src/helpers/windows.ts";
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
    expect(doc).toContain("dependsOn: [\"PowerShell module Terminal Icons\", \"Winix PowerShell helpers\"]");
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

  it("adds pins without changing package pins, reuses them offline, and explicitly updates them", async () => {
    const lock: WindowsLock = {
      ...emptyWindowsLock(),
      packages: { "Git.Git": { source: "winget", version: "2.0", resolvedAt: "old" } },
    };
    const resolve = vi.fn(() => "0.11.0");
    const first = await resolveWindowsModuleLockEntries(lock, [module], resolve);
    expect(first.lock.modules?.["terminal-icons"]).toMatchObject({ repository: "PSGallery", version: "0.11.0" });
    expect(first.lock.packages).toEqual(lock.packages);
    expect(lock.modules).toBeUndefined();
    const offline = () => { throw new Error("must not query repository"); };
    expect((await resolveWindowsModuleLockEntries(first.lock, [module], offline, new Date(), true)).lock).toBe(first.lock);
    const next = await resolveWindowsModuleLockEntries(first.lock, [module], async () => "0.12.0");
    expect(next.resolutions[0]).toMatchObject({ previousVersion: "0.11.0", version: "0.12.0", status: "updated" });
    const packageUpdate = resolveWindowsLockEntries(next.lock, [{ id: "Git.Git", source: "winget" }], () => "3.0");
    expect(packageUpdate.lock.modules).toEqual(next.lock.modules);
    expect(reconcileInlinePins(next.lock, hosts([])).modules).toEqual(next.lock.modules);
  });

  it("rejects conflicting repositories within a host and pins new sources independently", async () => {
    expect(() => collectWindowsModules(hosts([
      windows.powershell.module("Terminal-Icons"),
      windows.powershell.module("terminal-icons", { repository: "Other" }),
    ]))).toThrow(/conflicting repositories/);
    const changed = await resolveWindowsModuleLockEntries(
      { ...emptyWindowsLock(), modules: { "terminal-icons": pin } },
      [{ ...module, repository: "Other" }], () => "0.12.0", new Date(), true
    );
    expect(changed.lock.modules?.["terminal-icons"]).toEqual(pin);
    expect(changed.lock.modules?.["terminal-icons@other"]?.version).toBe("0.12.0");
    await expect(resolveWindowsModuleLockEntries(emptyWindowsLock(), [module], () => "0.12.0-beta")).rejects.toThrow(/allowed version/);
  });

  describe("host PowerShell repository policy", () => {
    const uri = "https://packages.example.com/powershell/v3/index.json";
    const policy = {
      repositories: { approved: { uri } },
      default: "approved",
      allowed: ["approved"],
    };

    function workAndPersonal() {
      const shell = feature("shell", ({ windows }) => {
        windows.powershell.module("Terminal-Icons");
        windows.setting({ DeveloperMode: true });
      });
      const workRepositories = feature("work-repositories", ({ windows }) => {
        windows.powershell.repositories(policy);
      });
      const work = profile("work", [shell(), workRepositories()]);
      return evaluate(workspace({
        inputs: {},
        hosts: [
          host("personal", platforms.windows(), [shell()]),
          host("work", platforms.windows(), [work()]),
        ],
      }));
    }

    it("applies after merging shared profile effects, without leaking into personal hosts", async () => {
      const evaluated = workAndPersonal();
      const modules = collectWindowsModules(evaluated);
      expect(modules.size).toBe(4);
      const resolve = vi.fn(() => "0.11.0");
      const { lock } = await resolveWindowsModuleLockEntries(emptyWindowsLock(), modules.values(), resolve);
      expect(resolve).toHaveBeenCalledWith("Terminal-Icons", "approved", uri, false);
      expect(resolve).toHaveBeenCalledWith("Microsoft.Windows.Settings", "approved", uri, true);
      const docs = generateWindows(evaluated, lock).hosts;
      expect(docs.personal["configuration.winget"]).toContain("-Repository 'PSGallery'");
      expect(docs.personal["configuration.winget"]).not.toContain(uri);
      const work = docs.work["configuration.winget"];
      expect(work).not.toContain("PSGallery");
      expect(work).toContain(uri);
      expect(work).toContain("-Repository 'approved'");
      expect(work).toContain("$name = 'Microsoft.Windows.Settings'");
      expect(work).toContain("-Name $name -Version $version -Repository 'approved'");
      expect(work.match(/dependsOn: \["Register PowerShell repository approved"\]/g)).toHaveLength(2);
      expect(work).not.toContain("Unregister-PSResourceRepository");
      expect(work).not.toContain("-Trusted");
      expect(work).not.toContain("-Priority");
    });

    it("rejects explicit disallowed repositories in either fragment order", () => {
      const module = windows.powershell.module("Terminal-Icons", { repository: "PSGallery" });
      const repositories = windows.powershell.repositories(policy);
      for (const entries of [[module, repositories], [repositories, module]]) {
        expect(() => hosts(entries)).toThrow(/disallowed repository "PSGallery"/);
      }
      expect(() => windows.powershell.repositories({ ...policy, allowed: ["PSGallery"] })).toThrow(/must be allowed/);
      expect(() => windows.powershell.repositories({ ...policy, default: "missing" })).toThrow(/not declared/);
      for (const uri of ["http://packages.example.com", "https://user:password@packages.example.com", "https://packages.example.com?token=secret"]) {
        expect(() => windows.powershell.repositories({
          ...policy, repositories: { approved: { uri } },
        })).toThrow(/HTTPS without/);
      }
    });

    it("refuses conflicting composed policies instead of widening a work allowlist", () => {
      const work = windows.powershell.repositories(policy);
      const publicFeeds = windows.powershell.repositories({
        repositories: {}, default: "PSGallery", allowed: ["PSGallery"],
      });
      for (const entries of [[work, publicFeeds], [publicFeeds, work]]) {
        expect(() => hosts(entries)).toThrow(/Conflicting PowerShell repository policies/);
      }
      expect(() => hosts([work, windows.powershell.repositories(policy)])).not.toThrow();
    });

    it("round-trips both source pins, reuses them offline, and does not reuse pins after a URI change", async () => {
      const modules = [...collectWindowsModules(workAndPersonal()).values()];
      const { lock } = await resolveWindowsModuleLockEntries(emptyWindowsLock(), modules, () => "0.11.0");
      const dir = await mkdtemp(join(tmpdir(), "winix-source-lock-"));
      try {
        await writeFile(join(dir, "winix-windows.lock"), serializeWindowsLock(lock));
        const read = readWindowsLock(dir)!;
        expect(read).toEqual(lock);
        const offline = vi.fn(() => { throw new Error("offline"); });
        expect((await resolveWindowsModuleLockEntries(read, modules, offline, new Date(), true)).changed).toBe(false);
        expect(offline).not.toHaveBeenCalled();
        const workModule = modules.find((module) => module.repository === "approved")!;
        const moved = { ...workModule, repositoryUri: "https://other.example.com/v3/index.json" };
        expect(windowsModuleKey(moved)).not.toBe(windowsModuleKey(workModule));
        await expect(resolveWindowsModuleLockEntries(read, [moved], offline, new Date(), true)).rejects.toThrow("offline");
        const badLock = structuredClone(lock);
        badLock.modules![windowsModuleKey(workModule)].repositoryUri = moved.repositoryUri;
        await writeFile(join(dir, "winix-windows.lock"), JSON.stringify(badLock));
        expect(() => readWindowsLock(dir)).toThrow(/repository identity/);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it.skipIf(!hasPowerShell7)("registers only a missing named feed and refuses mismatched registrations", () => {
      const scripts = powerShellRepositoryScripts("approved", uri);
      expect(runPowerShell7(`
  $script:uri = $null
  $script:registrations = 0
  function Get-PSResourceRepository {
    [CmdletBinding()] param()
    if ($script:uri) { [pscustomobject]@{ Name = 'approved'; Uri = [uri]$script:uri } }
  }
  function Register-PSResourceRepository {
    [CmdletBinding()] param([string]$Name, [string]$Uri)
    $script:uri = $Uri
    $script:registrations++
  }
  $test = { ${scripts.test} }
  $set = { ${scripts.set} }
  if (& $test) { throw 'Missing feed incorrectly passed' }
  & $set
  & $set
  if (-not (& $test) -or $script:registrations -ne 1) { throw 'Not idempotent' }
  $script:uri = 'https://unexpected.example.com'
  try { & $set; throw 'Mismatch was accepted' } catch {
    if ($_.Exception.Message -notlike '*different URI*') { throw }
  }
  'REPOSITORY_OK'
  `)).toContain("REPOSITORY_OK");
    });

    it.skipIf(!hasPowerShell7)("installs only the exact Settings prerelease from the approved feed and reuses it", async () => {
      const evaluated = workAndPersonal();
      const { lock } = await resolveWindowsModuleLockEntries(
        emptyWindowsLock(), collectWindowsModules(evaluated).values(),
        (name) => name === "Microsoft.Windows.Settings" ? "0.1.0-alpha.6" : "0.11.0"
      );
      const doc = generateWindows(evaluated, lock).hosts.work["configuration.winget"];
      const section = doc.split('  - name: "Ensure Microsoft Windows Settings module"')[1].split("  - name:")[0];
      const script = section.split("      setScript: |-\n")[1].split("\n")
        .filter((line) => line.startsWith("        ")).map((line) => line.slice(8)).join("\n");
      expect(runPowerShell7(`
$script:installed = 'alpha.5'
$script:installs = 0
function Get-Module {
  param([switch]$ListAvailable, [string]$Name)
  if ($script:installed) {
    [pscustomobject]@{ Name = $Name; Version = [version]'0.1.0'; PrivateData = @{PSData=@{Prerelease=$script:installed}} }
  }
}
function Install-PSResource {
  [CmdletBinding()]
  param([string]$Name, [string]$Version, [string]$Repository, [string]$Scope,
    [switch]$Prerelease, [switch]$TrustRepository, [switch]$AcceptLicense, [switch]$Reinstall)
  if ($Name -ne 'Microsoft.Windows.Settings' -or $Repository -ne 'approved' -or $Scope -ne 'CurrentUser' -or
      $Version -ne '0.1.0-alpha.6' -or -not $Prerelease) {
    throw 'Wrong module source or scope'
  }
  $script:installed = 'alpha.6'
  $script:installs++
}
& { ${script} }
& { ${script} }
if ($script:installs -ne 1) { throw 'Settings installation was not idempotent' }
'SETTINGS_REPOSITORY_OK'
`)).toContain("SETTINGS_REPOSITORY_OK");
    });

    const flat = "https://packages.example.com/powershell/v3/flat/";
    const serviceIndex = { resources: [{ "@type": "PackageBaseAddress/3.0.0", "@id": flat }] };
    const noRegistration = () => "null";
    const noMutation = /(?:Register|Set|Unregister)-PSResourceRepository|Install-PSResource/;

    it("resolves an unregistered policy feed anonymously by exact lowercased ID", async () => {
      const run = vi.fn((script: string) => {
        expect(script).not.toMatch(noMutation);
        expect(script).toContain(uri);
        expect(script).not.toContain("PSGallery");
        return "null";
      });
      const fetchFeed = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(serviceIndex))
        .mockResolvedValueOnce(Response.json({ versions: ["0.9.0", "0.12.0-beta", "0.11.0"] }));
      await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved", uri, false, { run, fetch: fetchFeed })).resolves.toBe("0.11.0");
      expect(run).toHaveBeenCalledTimes(1);
      expect(fetchFeed.mock.calls.map(([url]) => url)).toEqual([uri, `${flat}terminal-icons/index.json`]);
      for (const [, options] of fetchFeed.mock.calls) {
        expect(options).toMatchObject({ credentials: "omit", redirect: "manual", headers: { Accept: "application/json" } });
      }
    });

    it.skipIf(!hasPowerShell7)("reuses only a matching registration and never initializes a missing store", async () => {
      const dir = await mkdtemp(join(tmpdir(), "winix-resolver-store-"));
      const store = join(dir, "PSResourceRepository.xml");
      try {
        const run = (script: string) => {
          expect(script).not.toMatch(noMutation);
          return runPowerShell7(`
function Get-PSResourceRepository {
  [CmdletBinding()] param()
  if (-not (Test-Path -LiteralPath ${powerShellLiteral(store)})) { throw 'Tried to initialize the store' }
  [pscustomobject]@{ Name = 'APPROVED'; Uri = [uri]'https://unrelated.example.com/v3/index.json' }
  [pscustomobject]@{ Name = 'APPROVED2'; Uri = [uri]'${uri}/' }
}
function Find-PSResource {
  [CmdletBinding()] param([string]$Name, [string]$Repository, [switch]$Prerelease)
  if ($Repository -cne 'approved2' -or -not $Prerelease) { throw 'Wrong module source or options' }
  [pscustomobject]@{ Name = 'TERMINAL-ICONS'; Version = [version]'0.11.0'; Prerelease = 'beta.2' }
}
${script.replace(/^\$store = .*$/m, () => `$store = ${powerShellLiteral(store)}`)}
`);
        };
        const fetchFeed = vi.fn<typeof fetch>()
          .mockImplementation(async (url) => Response.json(url === uri ? serviceIndex : { versions: ["0.10.0"] }));
        await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved2", uri, true, { run, fetch: fetchFeed })).resolves.toBe("0.10.0");
        await expect(readFile(store)).rejects.toMatchObject({ code: "ENOENT" });
        await writeFile(store, "<configuration/>");
        await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved", uri, true, { run, fetch: fetchFeed })).resolves.toBe("0.10.0");
        fetchFeed.mockClear();
        await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved2", uri, true, { run, fetch: fetchFeed })).resolves.toBe("0.11.0-beta.2");
        expect(fetchFeed).not.toHaveBeenCalled();
        expect(await readFile(store, "utf8")).toBe("<configuration/>");
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    });

    it.each([
      [false, ["0.9.0", "0.10.0.1", "0.10.0", "0.11.0-beta"], "0.10.0.1"],
      [true, ["0.11.0-beta.9", "0.10.0", "0.11.0-beta.10", "0.11.0-beta.2"], "0.11.0-beta.10"],
      [true, ["0.11.0-rc", "0.11.0", "0.11.0-beta"], "0.11.0"],
    ])("chooses the newest allowed NuGet version (prerelease: %s)", async (prerelease, versions, expected) => {
      const fetchFeed = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(serviceIndex))
        .mockResolvedValueOnce(Response.json({ versions }));
      await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved", uri, prerelease, { run: noRegistration, fetch: fetchFeed })).resolves.toBe(expected);
    });

    it.each([
      [Response.json({ versions: ["1.0.0+build"] }), "valid module versions"],
      [Response.json({ versions: ["1.0.0-preview"] }), "no stable module releases"],
      [new Response("", { status: 503 }), "HTTP 503"],
    ])("reports feed failures with the module and source", async (response, reason) => {
      const fetchFeed = vi.fn<typeof fetch>()
        .mockResolvedValueOnce(Response.json(serviceIndex))
        .mockResolvedValueOnce(response);
      const result = resolvePowerShellModuleVersion("Terminal-Icons", "approved", uri, false, { run: noRegistration, fetch: fetchFeed });
      await expect(result).rejects.toThrow(`"Terminal-Icons" from "approved" (${uri})`);
      await expect(result).rejects.toThrow(reason);
    });

    it("reports network failures and rejects unsafe resource URLs or redirects without following them", async () => {
      for (const [response, reason] of [
        [Response.json({ resources: [{ "@type": "PackageBaseAddress/3.0.0", "@id": "http://insecure.example.com/v3" }] }), "HTTPS without"],
        [Response.redirect("http://insecure.example.com/v3"), "HTTP 302"],
        [undefined, "network unavailable"],
      ] as const) {
        const fetchFeed = vi.fn<typeof fetch>();
        if (response) fetchFeed.mockResolvedValueOnce(response);
        else fetchFeed.mockRejectedValueOnce(new Error(reason));
        const result = resolvePowerShellModuleVersion("Terminal-Icons", "approved", uri, false, { run: noRegistration, fetch: fetchFeed });
        await expect(result).rejects.toThrow(`"Terminal-Icons" from "approved" (${uri})`);
        await expect(result).rejects.toThrow(reason);
        expect(fetchFeed).toHaveBeenCalledTimes(1);
      }
    });
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
      expect(() => readWindowsLock(dir)).toThrow(/invalid repository, version/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("resolves stable Gallery versions through structured output and surfaces errors", async () => {
    await expect(resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", undefined, false, { run: (script) => {
      expect(script).toContain("Find-PSResource -Name 'Terminal-Icons' -Repository 'PSGallery'");
      expect(script).not.toContain("-Prerelease");
      return '"0.11.0"';
    } })).resolves.toBe("0.11.0");
    for (const result of ['"0.12.0-beta"', "warning\n0.11.0", '""']) {
      await expect(resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", undefined, false, { run: () => result })).rejects.toThrow(/Failed to resolve/);
    }
    await expect(resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", undefined, false, { run: () => {
      throw new Error("network unavailable");
    } })).rejects.toThrow(/network unavailable/);
  });

  it("surfaces the transport cause when a direct feed request fails", async () => {
    const cause = Object.assign(new Error("sslv3 alert handshake failure\nstack detail"), { code: "ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE" });
    await expect(resolvePowerShellModuleVersion("Terminal-Icons", "approved", "https://feed.example.com/v3/index.json", false, {
      run: () => "null",
      fetch: async () => { throw new TypeError("fetch failed", { cause }); },
    })).rejects.toThrow(/https:\/\/feed\.example\.com\/v3\/index\.json failed \(fetch failed: ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE: sslv3 alert handshake failure\)/);
  });

  it.skipIf(!hasPowerShell7)("queries the built-in Gallery v2 endpoint without creating a store", async () => {
    const run = vi.fn((script: string) => {
      expect(script).not.toMatch(/(?:Register|Set|Unregister)-PSResourceRepository|Install-PSResource/);
      if (script.includes("Find-PSResource")) return "null";
      return runPowerShell7(`
function Invoke-WebRequest {
  param([uri]$Uri, [int]$MaximumRedirection, [int]$TimeoutSec)
  if ($Uri.Host -cne 'www.powershellgallery.com' -or
      $Uri.AbsolutePath -cne '/api/v2/FindPackagesById()' -or
      $Uri.Query -notlike '*IsLatestVersion*' -or $MaximumRedirection -ne 0) { throw 'Wrong Gallery query' }
  @{ Content = @'
<feed xmlns="http://www.w3.org/2005/Atom" xmlns:m="http://schemas.microsoft.com/ado/2007/08/dataservices/metadata" xmlns:d="http://schemas.microsoft.com/ado/2007/08/dataservices">
  <entry><m:properties><d:Id>terminal-icons</d:Id><d:Version>0.11.0</d:Version></m:properties></entry>
</feed>
'@ }
}
${script}`);
    });
    await expect(resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", undefined, false, { run })).resolves.toBe("0.11.0");
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("resolves and round-trips prereleases only for modules that explicitly allow them", async () => {
    const prereleaseModule = { ...module, prerelease: true };
    const version = await resolvePowerShellModuleVersion("Terminal-Icons", "PSGallery", undefined, true, { run: (script) => {
      expect(script).toContain("-Prerelease");
      expect(script).toContain("$version += '-' + $found[0].Prerelease");
      return '"0.12.0-beta.2"';
    } });
    const { lock } = await resolveWindowsModuleLockEntries(emptyWindowsLock(), [prereleaseModule], () => version);
    const directory = await mkdtemp(join(tmpdir(), "winix-module-prerelease-"));
    try {
      await writeFile(join(directory, "winix-windows.lock"), serializeWindowsLock(lock));
      expect(readWindowsLock(directory)).toEqual(lock);
      const properties = powerShellModuleProperties(prereleaseModule, lock.modules!["terminal-icons"]);
      expect(properties.testScript).toContain("$prerelease = 'beta.2'");
      expect(properties.setScript).toContain("-Version $version -Repository 'PSGallery' -Prerelease");
      await expect(resolveWindowsModuleLockEntries(emptyWindowsLock(), [module], () => version)).rejects.toThrow("allowed version");
      const stable = vi.fn(() => "0.11.0");
      expect((await resolveWindowsModuleLockEntries(lock, [module], stable, new Date(), true)).changed).toBe(true);
      expect(stable).toHaveBeenCalledTimes(1);
    } finally { await rm(directory, { recursive: true, force: true }); }
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
  // File resources import the shared helpers module; generated configurations
  // install it first through the "Winix PowerShell helpers" resource.
  beforeAll(() => {
    const module = winixFileModuleProperties();
    runDsc("set", module);
    expect(runDsc("test", module).inDesiredState).toBe(true);
  }, 120000);

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
