import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { evaluate, host, platforms, windows, workspace, type Fragment } from "../src/index.ts";
import { generateWindows, validateWindowsWslResources } from "../src/backends/windows/index.ts";
import {
  emptyWindowsLock, readWindowsLock, resolveMissingWindowsLockEntries, resolveWindowsWslImages, serializeWindowsLock,
  type WindowsLock, type WindowsLockWslImage,
} from "../src/backends/windows/lockfile.ts";
import { optionalFeatureProperties, wslDistroProperties, type WslArchitecture } from "../src/backends/windows/wsl.ts";
import { powerShellLiteral as ps } from "../src/helpers/utils.ts";
import { applyWorkspace } from "../src/cli/commands/apply.ts";
import { update } from "../src/cli/commands/update.ts";
import { pathToFileURL } from "node:url";

const bytes = "isolated fake WSL image";
const hash = createHash("sha256").update(bytes).digest("hex");
const now = new Date("2026-11-11T00:00:00.000Z");
function image(architecture: WslArchitecture): WindowsLockWslImage {
  return {
    source: "nixos-wsl", architecture, version: "2605.7.2", sha256: hash,
    url: `https://github.com/nix-community/NixOS-WSL/releases/download/2605.7.2/${architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl"}`,
    resolvedAt: now.toISOString(),
  };
}
const pins = { "nixos-wsl/x64": image("x64"), "nixos-wsl/arm64": image("arm64") };
function hosts(entries: Fragment[]) {
  return evaluate(workspace({ inputs: {}, hosts: [host("desktop", platforms.windows(), entries)] }));
}
function baseline() {
  return [windows.package({ id: "Microsoft.WSL", version: "2.6.1" }), windows.wsl()];
}
function distro(name = "NixOS", location = "D:/WSL/NixOS", isDefault = true) {
  return windows.wsl.distro(name, { source: "nixos-wsl", installLocation: location, default: isDefault });
}

describe("Windows WSL SDK and backend", () => {
  it("returns a handle for the complete setup and supports returned or effect-only declarations", () => {
    const prerequisite = windows.package("Git.Git");
    const setup = windows.wsl({
      config: { wsl2: { memory: "8GB" } }, backup: true, force: true, dependsOn: prerequisite,
    });
    const resources = setup.windows!.dsc!;
    expect(resources).toHaveLength(2);
    expect(setup.__winixHandle).toEqual({ kind: "dsc", token: resources[1].token });
    expect(setup.windows!.packages).toEqual({ "Microsoft.WSL": { id: "Microsoft.WSL", source: "winget" } });
    expect(resources[0].dependsOn).toEqual([
      { kind: "package", id: "Microsoft.WSL" }, prerequisite.__winixHandle,
    ]);
    expect(resources[1].dependsOn).toEqual([
      { kind: "dsc", token: resources[0].token }, prerequisite.__winixHandle,
    ]);
    expect(resources[1].properties!.setScript).toContain("$backup = $true");
    expect(resources[1].properties!.setScript).toContain("$force = $true");
    const returned = evaluate(workspace({ inputs: {}, hosts: [
      host("desktop", platforms.windows(), ({ windows }) => windows.wsl({ config: { wsl2: { memory: "8GB" } } })),
    ] }));
    expect(returned[0].windows.dsc).toHaveLength(2);
    expect(returned[0].windows.packages).toEqual(setup.windows!.packages);
    const enabledOnly = windows.wsl();
    expect(enabledOnly.windows!.dsc).toHaveLength(1);
    expect(enabledOnly.__winixHandle).toEqual({ kind: "dsc", token: enabledOnly.windows!.dsc![0].token });
    expect(enabledOnly.windows!.packages).toEqual(setup.windows!.packages);
    expect(enabledOnly.windows!.dsc![0].dependsOn).toEqual([{ kind: "package", id: "Microsoft.WSL" }]);
  });

  it("locks the implicit runtime normally and preserves explicit package options in either declaration order", () => {
    const evaluated = hosts([windows.wsl()]);
    const resolver = vi.fn(() => "2.6.1");
    const resolved = resolveMissingWindowsLockEntries(emptyWindowsLock(now), evaluated, resolver, now);
    expect(resolver).toHaveBeenCalledExactlyOnceWith("Microsoft.WSL", "winget");
    const reused = resolveMissingWindowsLockEntries(resolved.lock, evaluated, resolver, now);
    expect(reused.changed).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(1);
    for (const entries of [
      [windows.package({ id: "Microsoft.WSL", version: "2.6.1", elevated: true }), windows.wsl()],
      [windows.wsl(), windows.package({ id: "Microsoft.WSL", version: "2.6.1", elevated: true })],
    ]) {
      const evaluated = hosts(entries);
      expect(evaluated[0].windows.packages).toEqual({
        "Microsoft.WSL": { id: "Microsoft.WSL", source: "winget", version: "2.6.1", elevated: true },
      });
      const output = generateWindows(evaluated).hosts.desktop["configuration.winget"];
      expect(output.match(/id: Microsoft.WSL/g)).toHaveLength(1);
    }
  });

  it("collects WSL effects and wires distro prerequisites without leaking metadata", () => {
    const evaluated = evaluate(workspace({ inputs: {}, hosts: [
      host("desktop", platforms.windows(), ({ windows }) => {
        windows.wsl({ config: { wsl2: { memory: "16GB", processors: 8 } }, backup: true });
        windows.wsl.distro("NixOS", {
          source: "nixos-wsl", installLocation: windows.knownFolder.localAppData("Winix/WSL/NixOS"), default: true,
        });
      }),
    ] }));
    const lock: WindowsLock = {
      ...emptyWindowsLock(now), wslImages: pins,
      packages: { "Microsoft.WSL": { source: "winget", version: "2.6.1", resolvedAt: now.toISOString() } },
    };
    const output = generateWindows(evaluated, lock).hosts.desktop["configuration.winget"];
    expect(output).toContain("Windows features Microsoft Windows Subsystem Linux VirtualMachinePlatform");
    expect(output).toContain("dependsOn: [\"Windows features Microsoft Windows Subsystem Linux VirtualMachinePlatform\", \"WSL configuration\", \"Microsoft WSL\"]");
    expect(output).toContain("[wsl2]");
    expect(output).toContain("memory=16GB");
    expect(output).toContain("processors=8");
    expect(output).toContain("Restart WSL manually");
    expect(output).toContain("securityContext: elevated");
    expect(output).not.toContain("kind:");
    expect(output).not.toContain("--unregister");
    expect(output).not.toContain("--shutdown");
  });

  it("rejects invalid names, paths, INI injection, and unsupported settings", () => {
    expect(() => distro("../NixOS")).toThrow("distro name");
    expect(() => distro("NixOS", "relative/path")).toThrow("installLocation");
    expect(() => windows.wsl({ config: { wsl2: { memory: "16GB\nkernel=unsafe" } } })).toThrow("option");
    expect(() => windows.wsl({ config: { wsl2: { processors: 0 } } })).toThrow("option");
    expect(() => windows.wsl({ config: { wsl2: { processors: 1.5 } } })).toThrow("option");
    expect(() => windows.wsl({ config: { wsl2: { memory: "0GB" } } })).toThrow("option");
    expect(() => windows.wsl({ config: { wsl2: { swap: "0" } } })).not.toThrow();
    // @ts-expect-error Runtime callers must also supply an options object.
    expect(() => windows.wsl(null)).toThrow("options must be an object");
    // @ts-expect-error Overwrite protections are validated at runtime.
    expect(() => windows.wsl({ backup: "yes" })).toThrow("must be a boolean");
    expect(() => windows.optionalFeature("bad;command")).toThrow("feature name");
  });

  it("rejects missing prerequisites, conflicting features, duplicate configs/names/locations and defaults", () => {
    const validate = (entries: Fragment[]) => validateWindowsWslResources(hosts(entries)[0].windows);
    expect(() => validate([distro()])).toThrow("windows.wsl()");
    expect(() => validate([windows.wsl(), distro()])).not.toThrow();
    expect(() => validate([
      windows.optionalFeature("Microsoft-Windows-Subsystem-Linux"),
      windows.optionalFeature("VirtualMachinePlatform"),
      distro(),
    ])).toThrow("Microsoft.WSL");
    expect(() => validate([...baseline(), windows.optionalFeature("VirtualMachinePlatform", { enabled: false })])).toThrow("Conflicting");
    expect(() => validate([...baseline(), distro(), distro("nixos")])).toThrow("Duplicate");
    expect(() => validate([...baseline(), distro(), distro("Other")])).toThrow("installLocation");
    expect(() => validate([...baseline(), distro(), distro("Other", "d:\\WSL\\.\\NixOS", false)])).toThrow("installLocation");
    expect(() => validate([...baseline(), distro(), distro("Other", "D:/WSL/Other")])).toThrow("one WSL distro");
    expect(() => validate([
      windows.wsl({ config: { wsl2: { memory: "8GB" } } }), windows.wsl({ config: { wsl2: { memory: "16GB" } } }),
    ])).toThrow("one windows.wsl({ config })");
    expect(() => generateWindows(hosts([...baseline(), distro()]), emptyWindowsLock(now))).toThrow("image pin");
  });
});

describe("NixOS-WSL image locks", () => {
  it("pins both architectures once, preserves old locks and refreshes only on explicit update", async () => {
    const resolver = vi.fn(image);
    const original = emptyWindowsLock(now);
    const result = await resolveWindowsWslImages(original, resolver, now, true);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect(JSON.parse(serializeWindowsLock(result.lock)).wslImages).toEqual(pins);
    expect(original.wslImages).toBeUndefined();
    expect((await resolveWindowsWslImages(result.lock, resolver, now, true)).changed).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(2);
    expect((await resolveWindowsWslImages(result.lock, resolver, now)).changed).toBe(false);
    expect(resolver).toHaveBeenCalledTimes(4);
  });

  it("rejects untrusted or corrupt image pins without changing the existing lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-wsl-lock-"));
    try {
      const lock: WindowsLock = { ...emptyWindowsLock(now), wslImages: pins };
      await writeFile(join(dir, "winix-windows.lock"), serializeWindowsLock(lock));
      expect(readWindowsLock(dir)?.wslImages).toEqual(pins);
      for (const replacement of [
        { url: "https://example.com/image.wsl" }, { sha256: "invalid" },
        { url: "https://github.com/nix-community/NixOS-WSL/releases/latest/download/nixos.wsl" },
      ]) {
        const invalid = { ...lock, wslImages: { ...pins, "nixos-wsl/x64": { ...pins["nixos-wsl/x64"], ...replacement } } };
        await writeFile(join(dir, "winix-windows.lock"), JSON.stringify(invalid));
        expect(() => readWindowsLock(dir)).toThrow("WSL image");
      }
      const before = serializeWindowsLock(lock);
      await expect(resolveWindowsWslImages(lock, (architecture) => {
        if (architecture === "arm64") throw new Error("offline");
        return { ...image(architecture), sha256: "b".repeat(64) };
      })).rejects.toThrow("offline");
      expect(serializeWindowsLock(lock)).toBe(before);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("resolves dry apply/update pins without writing them and reuses committed pins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-wsl-cli-"));
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const url = pathToFileURL(join(process.cwd(), "src", "index.ts")).href;
      await writeFile(join(dir, "winix.config.mjs"), `
        import {host, platforms, workspace} from ${JSON.stringify(url)};
        export default workspace({inputs:{}, hosts:[host("desktop", platforms.windows(), ({windows})=>{
          windows.package({id:"Microsoft.WSL",version:"2.6.1"});
          windows.wsl();
          windows.wsl.distro("NixOS",{source:"nixos-wsl",installLocation:"D:/WSL/NixOS"});
        })]});
      `);
      const resolver = vi.fn(image);
      await applyWorkspace(dir, { dry: true, diff: false, resolveWindowsWslImage: resolver });
      await expect(readFile(join(dir, "winix-windows.lock"))).rejects.toMatchObject({ code: "ENOENT" });
      await applyWorkspace(dir, { dry: false, diff: false, resolveWindowsWslImage: resolver });
      const saved = await readFile(join(dir, "winix-windows.lock"), "utf8");
      await applyWorkspace(dir, { dry: true, diff: false, resolveWindowsWslImage: () => { throw new Error("must reuse pins"); } });
      await update(dir, {
        windows: true, inputs: ["nixos-wsl"], dry: true,
        resolveWindowsWslImage: (architecture) => ({ ...image(architecture), sha256: "b".repeat(64) }),
      });
      expect(await readFile(join(dir, "winix-windows.lock"), "utf8")).toBe(saved);
      await update(dir, {
        windows: true, inputs: ["nixos-wsl"], dry: false,
        resolveWindowsWslImage: (architecture) => ({ ...image(architecture), sha256: "b".repeat(64) }),
      });
      expect(readWindowsLock(dir)?.wslImages?.["nixos-wsl/x64"].sha256).toBe("b".repeat(64));
      const updated = await readFile(join(dir, "winix-windows.lock"), "utf8");
      await expect(update(dir, {
        windows: true, inputs: [], dry: false,
        resolveWindowsWslImage: (architecture) => {
          if (architecture === "arm64") throw new Error("offline");
          return image(architecture);
        },
      })).rejects.toThrow("offline");
      expect(await readFile(join(dir, "winix-windows.lock"), "utf8")).toBe(updated);
    } finally {
      log.mockRestore(); warn.mockRestore();
      await rm(dir, { recursive: true, force: true });
    }
  });
});

interface PsResult { error: string | null; imports: number; downloads: number; defaults: number; enabled: number; disabled: number }
function runPs(script: string, setup = ""): PsResult {
  const harness = `
$ErrorActionPreference = 'Stop'
$script:registration = $null
$script:defaultGuid = $null
$script:imports = 0; $script:downloads = 0; $script:defaults = 0
$script:enabled = 0; $script:disabled = 0; $script:restart = $false
$script:states = @{}
$script:pending = $false
$script:importFail = $false
function Get-WindowsOptionalFeature { param([switch]$Online,$FeatureName,$ErrorAction)
  $state = if ($script:states.ContainsKey($FeatureName)) { $script:states[$FeatureName] } else { 'Enabled' }
  [pscustomobject]@{FeatureName=$FeatureName; State=$state}
}
function Enable-WindowsOptionalFeature { param([switch]$Online,$FeatureName,[switch]$All,[switch]$NoRestart,$ErrorAction)
  $script:enabled++; $script:states[$FeatureName] = if($script:restart){'EnablePending'}else{'Enabled'}
  [pscustomobject]@{RestartNeeded=$script:restart}
}
function Disable-WindowsOptionalFeature { param([switch]$Online,$FeatureName,[switch]$NoRestart,$ErrorAction)
  $script:disabled++; $script:states[$FeatureName]='Disabled'
  [pscustomobject]@{RestartNeeded=$false}
}
function Test-Path { param($LiteralPath,$PathType)
  if ($LiteralPath -like 'HKLM:*') { return $script:pending }
  if ($LiteralPath -like 'HKCU:*') { return $null -ne $script:registration }
  if ($PathType) { return Microsoft.PowerShell.Management\\Test-Path -LiteralPath $LiteralPath -PathType $PathType }
  Microsoft.PowerShell.Management\\Test-Path -LiteralPath $LiteralPath
}
function Get-ChildItem { param($LiteralPath) [pscustomobject]@{PSPath='mock-registration'} }
function Get-ItemProperty { param($LiteralPath)
  if($LiteralPath -eq 'mock-registration'){ return $script:registration }
  [pscustomobject]@{DefaultDistribution=$script:defaultGuid}
}
function Invoke-WebRequest { param($Uri,$OutFile,$ErrorAction)
  $script:downloads++; [IO.File]::WriteAllText($OutFile,${ps(bytes)},[Text.UTF8Encoding]::new($false))
}
function wsl.exe {
  if($args[0] -eq '--import') {
    $script:imports++
    [IO.Directory]::CreateDirectory($args[2]) | Out-Null
    $script:registration=[pscustomobject]@{DistributionName=$args[1];BasePath=$args[2];Version=2;PSChildName='{test-guid}'}
    if($script:importFail) { $global:LASTEXITCODE=1; return }
  } elseif($args[0] -eq '--set-default') { $script:defaults++; $script:defaultGuid='{test-guid}' }
  else { throw 'Unexpected WSL mutation' }
  $global:LASTEXITCODE=0
}
${setup}
$failure=$null
try { & { ${script} } } catch { $failure=$_.Exception.Message }
'WINIX_RESULT:' + (@{error=$failure;imports=$script:imports;downloads=$script:downloads;defaults=$script:defaults;enabled=$script:enabled;disabled=$script:disabled}|ConvertTo-Json -Compress)
`;
  const output = execFileSync("pwsh", [
    "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
  ], { encoding: "utf8", input: harness, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
  const result = output.split(/\r?\n/).find((line) => line.startsWith("WINIX_RESULT:"));
  if (!result) throw new Error(output);
  return JSON.parse(result.slice("WINIX_RESULT:".length));
}

describe.skipIf(process.platform !== "win32")("WSL generated PowerShell with mocked machine operations", () => {
  it("enables all requested features before reporting a required reboot, never restarting", () => {
    const properties = optionalFeatureProperties(["Microsoft-Windows-Subsystem-Linux", "VirtualMachinePlatform"], true);
    const setup = "$script:states=@{'Microsoft-Windows-Subsystem-Linux'='Disabled';VirtualMachinePlatform='Disabled'}; $script:restart=$true";
    const result = runPs(String(properties.setScript), setup);
    expect(result.error).toContain("WINIX_REBOOT_REQUIRED");
    expect(result.enabled).toBe(2);
    expect(result.imports).toBe(0);
    const noop = runPs(String(properties.setScript));
    expect(noop.error).toBeNull();
    expect(noop.enabled).toBe(0);
  });

  it("supports explicit disabling without removing declarations implicitly", () => {
    const result = runPs(String(optionalFeatureProperties(["ExampleFeature"], false).setScript));
    expect(result.error).toBeNull();
    expect(result.disabled).toBe(1);
  });

  it("verifies the image before import, records registration, and never reimports on later switches/lock updates", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix wsl's \u00e9-"));
    const location = join(dir, "NixOS");
    try {
      const spec = { name: "NixOS", source: "nixos-wsl" as const, installLocation: location, default: true };
      const properties = wslDistroProperties(spec, pins);
      const next = wslDistroProperties(spec, { ...pins, "nixos-wsl/x64": { ...pins["nixos-wsl/x64"], sha256: "b".repeat(64) } });
      const result = runPs(`${properties.setScript}
$desired = @(& { ${properties.testScript} })
if ($desired.Count -ne 1 -or $desired[0] -isnot [bool] -or -not $desired[0]) { throw 'Expected exactly one true test result' }
$script:defaultGuid = '{other-guid}'
${next.setScript}`);
      expect(result.error).toBeNull();
      expect(result.imports).toBe(1);
      expect(result.downloads).toBe(1);
      expect(result.defaults).toBe(2);
      expect(JSON.parse(await readFile(join(location, ".winix-wsl.json"), "utf8")).sha256).toBe(hash);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each(["checksum", "pending", "unmanaged", "conflict", "location", "import-failure"])("refuses %s registration without destructive repair", async (failure) => {
    const dir = await mkdtemp(join(tmpdir(), "winix-wsl-refuse-"));
    const location = join(dir, "NixOS");
    try {
      if (failure === "location") await mkdir(location);
      const properties = wslDistroProperties({
        name: "NixOS", source: "nixos-wsl", installLocation: location, default: false,
      }, failure === "checksum"
        ? Object.fromEntries(Object.entries(pins).map(([key, pin]) => [key, { ...pin, sha256: "b".repeat(64) }]))
        : pins);
      const setup = failure === "pending" ? "$script:pending=$true" :
        failure === "import-failure" ? "$script:importFail=$true" :
        failure === "unmanaged" || failure === "conflict"
          ? `$script:registration=[pscustomobject]@{DistributionName='NixOS';BasePath=${ps(failure === "conflict" ? join(dir, "Other") : location)};Version=2;PSChildName='{test-guid}'}`
          : "";
      const result = runPs(String(properties.setScript), setup);
      expect(result.error).toMatch(/checksum mismatch|REBOOT_REQUIRED|refusing automatic adoption|Conflicting WSL registration|location already exists|WSL command failed/);
      expect(result.imports).toBe(failure === "import-failure" ? 1 : 0);
      expect(result.defaults).toBe(0);
      if (failure === "import-failure") {
        expect((await stat(location)).isDirectory()).toBe(true);
        await expect(readFile(join(location, ".winix-wsl.json"))).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
