import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
import { wslIdentityProbe, optionalFeatureProperties, wslDistroProperties, type WslArchitecture } from "../src/backends/windows/wsl.ts";
import { wslRepositoryKey, wslScriptInvocation, wslSetupPrelude } from "../src/backends/windows/wsl-setup.ts";
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

describe("WSL distro identity", () => {
  const linuxAvailable = (() => {
    try {
      execFileSync(process.platform === "win32" ? "wsl.exe" : "python3",
        process.platform === "win32" ? ["--", "python3", "--version"] : ["--version"],
        { stdio: "ignore", timeout: 15000 });
      return true;
    } catch { return false; }
  })();

  it.skipIf(!linuxAvailable)("checks only NixOS and the Linux hostname without changing files or executing config", () => {
    const source = wslIdentityProbe("wsl-work");
    const driver = `
import os, pathlib, subprocess, tempfile
source = ${JSON.stringify(source)}
mocks = '''
grep() { [[ "$CASE" != not-nixos ]] && printf '%s\\\\n' "$OS_RELEASE" | command grep "$1" "$2"; }
cat() { [[ "$CASE" != unreadable ]] || return 1; printf '%s\\\\n' "$LINUX_HOSTNAME"; }
'''
for case in ["valid", "quoted-id", "not-nixos", "wrong-host", "unreadable"]:
    with tempfile.TemporaryDirectory(prefix="winix-identity-") as directory:
        root = pathlib.Path(directory)
        (root / "winix.config.ts").write_text("throw new Error('must never execute config')")
        def snapshot():
            return {str(p.relative_to(root)): p.read_bytes() for p in root.rglob("*") if p.is_file()}
        before = snapshot()
        result = subprocess.run(["bash", "--noprofile", "--norc", "-s"], input=mocks + source, text=True,
                                capture_output=True, cwd=root,
                                env={**os.environ, "CASE":case, "OS_RELEASE":'ID="nixos"' if case == "quoted-id" else "ID=nixos",
                                     "LINUX_HOSTNAME":"other" if case == "wrong-host" else "wsl-work"})
        if case in ["valid", "quoted-id"]:
            assert result.returncode == 0, (case, result.stderr)
        else:
            assert result.returncode != 0, (case, result.stdout)
        if case == "not-nixos":
            assert "must run NixOS" in result.stderr
        if case == "wrong-host":
            assert "hostname mismatch: expected wsl-work, found other" in result.stderr
        assert snapshot() == before, case
print("WINIX_IDENTITY_SUCCESS")
`;
    const result = execFileSync(process.platform === "win32" ? "wsl.exe" : "python3",
      process.platform === "win32" ? ["--", "python3", "-"] : ["-"],
      { input: driver, encoding: "utf8", timeout: 30000 });
    expect(result).toContain("WINIX_IDENTITY_SUCCESS");
  });

  it("uses the same distro helper for a creation location and an expected Linux hostname", () => {
    const evaluated = evaluate(workspace({ inputs: {}, hosts: [
      host("desktop", platforms.windows(), ({ windows }) => {
        windows.package({ id: "Microsoft.WSL", version: "2.6.1" });
        const prerequisite = windows.wsl({ config: { wsl2: { memory: "8GB" } } });
        windows.wsl.distro("NixOS", {
          source: "nixos-wsl", host: "wsl-work", installLocation: "D:\\WSL\\NixOS", dependsOn: prerequisite,
        });
      }),
    ] }));
    expect(evaluated[0].windows.dsc).toHaveLength(3);
    const text = generateWindows(evaluated, { ...emptyWindowsLock(), wslImages: pins }).hosts.desktop["configuration.winget"];
    expect(text).toContain("$expectedHostname = 'wsl-work'");
    expect(text).toContain("dependsOn: [\"Windows features Microsoft Windows Subsystem Linux VirtualMachinePlatform\", \"WSL configuration\", \"Microsoft WSL\"]");
    expect(text).not.toContain("git rev-parse");
  });

  it("rejects empty or unsafe Linux hostname expectations", () => {
    for (const expected of ["", "--unsafe", "wsl\nwork", "wsl;exit"]) {
      expect(() => windows.wsl.distro("NixOS", {
        source: "nixos-wsl", host: expected, installLocation: "D:\\WSL\\NixOS",
      })).toThrow("hostname");
    }
  });
});

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

interface PsResult {
  error: string | null; imports: number; downloads: number; defaults: number; enabled: number; disabled: number; probes: number;
  tracking: { adopted: boolean; host: string; registration: string; location: string } | null;
}
function mockIdentity(script: unknown, expected: string, error?: string): string {
  const probe = wslIdentityProbe(expected);
  return String(script).replaceAll(
    wslScriptInvocation("Invoke-WinixWslIdentity", probe, probe, "WSL identity validation").join("\n"),
    `function Invoke-WinixWslIdentity { $script:probes++; ${error ? `throw ${ps(error)}` : "return $true"} }`,
  );
}

function runPs(script: string, setup = ""): PsResult {
  const stateDir = mkdtempSync(join(tmpdir(), "winix-wsl-tracking-"));
  const harness = `
$ErrorActionPreference = 'Stop'
$script:testStateRoot = ${ps(stateDir)}
$script:registration = $null
$script:defaultGuid = $null
$script:imports = 0; $script:downloads = 0; $script:defaults = 0
$script:enabled = 0; $script:disabled = 0; $script:restart = $false
$script:states = @{}
$script:pending = $false
$script:importFail = $false
$script:probes = 0
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
try { & { ${script
      .replaceAll("[Environment]::GetFolderPath('LocalApplicationData')", "$script:testStateRoot")
      .replaceAll("[Diagnostics.ProcessStartInfo]::new('wsl.exe')", "[Diagnostics.ProcessStartInfo]::new('winix-test-forbidden-wsl.exe')")} } } catch { $failure=$_.Exception.Message }
$recordPath = Join-Path $script:testStateRoot 'Winix\\wsl-registrations\\registration-nixos.json'
$trackingResult = if ([IO.File]::Exists($recordPath)) { [IO.File]::ReadAllText($recordPath) | ConvertFrom-Json } else { $null }
'WINIX_RESULT:' + (@{error=$failure;imports=$script:imports;downloads=$script:downloads;defaults=$script:defaults;enabled=$script:enabled;disabled=$script:disabled;probes=$script:probes;tracking=$trackingResult}|ConvertTo-Json -Compress)
`;
  try {
    const output = execFileSync("pwsh", [
      "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "& ([scriptblock]::Create([Console]::In.ReadToEnd()))",
    ], { encoding: "utf8", input: harness, stdio: ["pipe", "pipe", "pipe"], timeout: 30000 });
    const result = output.split(/\r?\n/).find((line) => line.startsWith("WINIX_RESULT:"));
    if (!result) throw new Error(output);
    return JSON.parse(result.slice("WINIX_RESULT:".length));
  } finally { rmSync(stateDir, { recursive: true, force: true }); }
}

describe.skipIf(process.platform !== "win32")("WSL generated PowerShell with mocked machine operations", () => {
  it("adopts a matching existing distro once, preserving its actual location, contents and defaults", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-adopt's \u00e9-"));
    const actual = join(dir, "Existing NixOS");
    const requested = join(dir, "New NixOS");
    try {
      await mkdir(actual);
      await writeFile(join(actual, "data.txt"), "preserve");
      const properties = wslDistroProperties({
        name: "NixOS", source: "nixos-wsl", host: "wsl-work", installLocation: requested, default: true,
      }, pins);
      const result = runPs(mockIdentity(`
${properties.getScript}
$before = @(& { ${properties.testScript} })
if ($before.Count -ne 1 -or $before[0] -isnot [bool] -or $before[0]) { throw 'Untracked distro should require recording' }
& { ${properties.setScript} }
`, "wsl-work") + mockIdentity(`
$saved = [IO.File]::ReadAllText((Join-Path $testStateRoot 'Winix\\wsl-registrations\\registration-nixos.json'))
$desired = @(& { ${properties.testScript} })
if ($desired.Count -ne 1 -or $desired[0] -isnot [bool] -or -not $desired[0]) { throw 'Adopted distro should be in desired state' }
& { ${properties.setScript} }
if ($saved -cne [IO.File]::ReadAllText((Join-Path $testStateRoot 'Winix\\wsl-registrations\\registration-nixos.json'))) { throw 'Tracking changed on repeat apply' }
`, "wsl-work"),
        `$script:registration=[pscustomobject]@{DistributionName='nixos';Version=2;BasePath=${ps(actual)};PSChildName='{existing-guid}'}`);
      expect(result.error).toBeNull();
      expect(result.tracking).toMatchObject({
        adopted: true, host: "wsl-work", registration: "{existing-guid}", location: actual,
      });
      expect([result.imports, result.downloads, result.defaults]).toEqual([0, 0, 0]);
      expect(result.probes).toBe(5);
      expect(await readFile(join(actual, "data.txt"), "utf8")).toBe("preserve");
      await expect(stat(requested)).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(join(actual, ".winix-wsl.json"))).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it.each(["wrong-host", "not-nixos", "wsl1", "ambiguous", "no-host"])("refuses %s without importing, recording or changing defaults", (failure) => {
    const properties = wslDistroProperties({
      name: "NixOS", source: "nixos-wsl", host: failure === "no-host" ? undefined : "wsl-work",
      installLocation: "D:\\New\\NixOS", default: true,
    }, pins);
    const registration = `$script:registration=[pscustomobject]@{DistributionName='NixOS';Version=${failure === "wsl1" ? 1 : 2};BasePath='D:\\Existing\\NixOS';PSChildName='{existing-guid}'}`;
    const setup = registration + (failure === "ambiguous"
      ? "; function Get-ChildItem { [pscustomobject]@{PSPath='mock-registration'}; [pscustomobject]@{PSPath='mock-registration'} }" : "");
    for (const script of [properties.getScript, properties.testScript, properties.setScript]) {
      const result = runPs(mockIdentity(script, failure === "no-host" ? "" : "wsl-work",
        failure === "not-nixos" ? "Existing WSL distro must run NixOS" : "Linux hostname mismatch"), setup);
      expect(result.error).toMatch(/must run NixOS|hostname mismatch|WSL 2|Ambiguous|expected Linux hostname/);
      expect(result.tracking).toBeNull();
      expect([result.imports, result.downloads, result.defaults]).toEqual([0, 0, 0]);
    }
  });

  it("uses setup.host for matching but never runs setup for an adopted distro", () => {
    const setup = {
      repository: "https://github.com/example/dotfiles.git", ref: "main",
      host: "wsl-work", configDirectory: "winix", user: "alice", checkout: "/home/alice/dotfiles",
    };
    const pin = { repository: setup.repository, ref: setup.ref, revision: "a".repeat(40), resolvedAt: now.toISOString() };
    const properties = wslDistroProperties({
      name: "NixOS", source: "nixos-wsl", installLocation: "D:\\New\\NixOS", default: true, setup,
    }, pins, { [wslRepositoryKey(setup)]: pin });
    const result = runPs(mockIdentity(`
& { ${properties.setScript} }
& { ${properties.setScript} }
$desired = @(& { ${properties.testScript} })
if ($desired.Count -ne 1 -or $desired[0] -isnot [bool] -or -not $desired[0]) { throw 'Expected an adopted distro to stay linked' }
`, "wsl-work").replaceAll(wslSetupPrelude(setup, pin).join("\n"),
      "function Invoke-WinixWslSetup { throw 'Existing distro must not run Linux setup' }"),
      "$script:registration=[pscustomobject]@{DistributionName='NixOS';Version=2;BasePath='D:\\Existing\\NixOS';PSChildName='{existing-guid}'}");
    expect(result.error).toBeNull();
    expect(result.tracking).toMatchObject({ adopted: true, host: "wsl-work" });
    expect([result.imports, result.downloads, result.defaults, result.probes]).toEqual([0, 0, 0, 3]);
  });

  it.each(["guid", "missing", "location", "declaration", "hostname", "invalid-record"])("protects tracked adopted distros against %s changes", (failure) => {
    const properties = wslDistroProperties({
      name: "NixOS", source: "nixos-wsl", host: "wsl-work", installLocation: "D:\\New\\NixOS", default: true,
    }, pins);
    const record = {
      version: failure === "invalid-record" ? 2 : 1, source: "nixos-wsl", name: "NixOS", adopted: true,
      registration: "{existing-guid}", location: "D:\\Existing\\NixOS",
      host: failure === "declaration" ? "wsl-other" : "wsl-work",
    };
    const setup = `
$directory = Join-Path $testStateRoot 'Winix\\wsl-registrations'
[IO.Directory]::CreateDirectory($directory) | Out-Null
[IO.File]::WriteAllText((Join-Path $directory 'registration-nixos.json'), ${ps(JSON.stringify(record))})
${failure === "missing" ? "" : `$script:registration=[pscustomobject]@{
  DistributionName='NixOS';Version=2;BasePath=${ps(failure === "location" ? "D:\\Moved\\NixOS" : record.location)};
  PSChildName=${ps(failure === "guid" ? "{replacement-guid}" : record.registration)}
}`}
`;
    const result = runPs(mockIdentity(properties.setScript, "wsl-work",
      failure === "hostname" ? "Linux hostname mismatch" : undefined), setup);
    expect(result.error).toMatch(/registration changed|registration is missing|declaration changed|hostname mismatch|Invalid WSL tracking record/);
    expect([result.imports, result.downloads, result.defaults]).toEqual([0, 0, 0]);
    expect(result.tracking).toMatchObject(record);
  });

  it("preserves previously provisioned distros and migrates legacy markers without adoption", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-wsl-legacy-"));
    try {
      const marker = JSON.stringify({ version: 1, source: "nixos-wsl", name: "NixOS", registration: "{legacy-guid}" });
      await writeFile(join(dir, ".winix-wsl.json"), marker);
      const properties = wslDistroProperties({
        name: "NixOS", source: "nixos-wsl", installLocation: dir, default: false,
      }, pins);
      const result = runPs(`
& { ${properties.setScript} }
$desired = @(& { ${properties.testScript} })
if ($desired.Count -ne 1 -or $desired[0] -isnot [bool] -or -not $desired[0]) { throw 'Legacy distro should remain managed' }
`, `$script:registration=[pscustomobject]@{DistributionName='NixOS';Version=2;BasePath=${ps(dir)};PSChildName='{legacy-guid}'}`);
      expect(result.error).toBeNull();
      expect(result.tracking).toMatchObject({ adopted: false, registration: "{legacy-guid}" });
      expect([result.imports, result.downloads, result.defaults, result.probes]).toEqual([0, 0, 0, 0]);
      expect(await readFile(join(dir, ".winix-wsl.json"), "utf8")).toBe(marker);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

  it("refuses a registration replaced during its identity probe", () => {
    const properties = wslDistroProperties({
      name: "NixOS", source: "nixos-wsl", host: "wsl-work", installLocation: "D:\\New\\NixOS", default: true,
    }, pins);
    const script = mockIdentity(properties.setScript, "wsl-work").replace(
      "$script:probes++; return $true",
      "$script:probes++; $script:registration=[pscustomobject]@{DistributionName='NixOS';Version=2;BasePath='D:\\Existing\\NixOS';PSChildName='{replacement-guid}'}; return $true",
    );
    const result = runPs(script,
      "$script:registration=[pscustomobject]@{DistributionName='NixOS';Version=2;BasePath='D:\\Existing\\NixOS';PSChildName='{original-guid}'}");
    expect(result.error).toContain("registration changed during validation");
    expect(result.tracking).toBeNull();
    expect([result.imports, result.downloads, result.defaults]).toEqual([0, 0, 0]);
  });

  it("does not adopt over a legacy marker left at the configured creation location", async () => {
    const dir = await mkdtemp(join(tmpdir(), "winix-wsl-old-location-"));
    try {
      await writeFile(join(dir, ".winix-wsl.json"), JSON.stringify({
        version: 1, source: "nixos-wsl", name: "NixOS", registration: "{old-guid}",
      }));
      const properties = wslDistroProperties({
        name: "NixOS", source: "nixos-wsl", host: "wsl-work", installLocation: dir, default: true,
      }, pins);
      const result = runPs(mockIdentity(properties.setScript, "wsl-work"),
        "$script:registration=[pscustomobject]@{DistributionName='NixOS';Version=2;BasePath='D:\\Other\\NixOS';PSChildName='{replacement-guid}'}");
      expect(result.error).toContain("configured location already has a Winix marker");
      expect(result.tracking).toBeNull();
      expect([result.imports, result.downloads, result.defaults]).toEqual([0, 0, 0]);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

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
      expect(result.tracking).toMatchObject({ adopted: false, registration: "{test-guid}" });
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
      expect(result.error).toMatch(/checksum mismatch|REBOOT_REQUIRED|Cannot adopt existing WSL distro|Conflicting WSL registration|location already exists|WSL command failed/);
      expect(result.imports).toBe(failure === "import-failure" ? 1 : 0);
      expect(result.defaults).toBe(0);
      if (failure === "import-failure") {
        expect((await stat(location)).isDirectory()).toBe(true);
        await expect(readFile(join(location, ".winix-wsl.json"))).rejects.toMatchObject({ code: "ENOENT" });
      }
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
});
