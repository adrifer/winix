import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";

interface BootstrapResult {
  ok: boolean;
  error: string | null;
  calls: { file: string; args: string[] }[];
}

const script = join(process.cwd(), "scripts", "bootstrap-windows.ps1").replaceAll("'", "''");
const shells = [
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  "pwsh",
].filter((shell) => {
  if (process.platform !== "win32") return true;
  const probe = spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"], { encoding: "utf8", timeout: 15000 });
  if (probe.error) throw probe.error;
  if (probe.status !== 0 && !probe.stderr.includes("CouldNotAutoloadMatchingModule")) throw new Error(probe.stderr);
  const blocked = probe.status !== 0 || ["AllSigned", "Restricted"].includes(probe.stdout.trim());
  if (blocked) console.warn(`Skipping bootstrap fixtures in ${shell}: host signing policy/security module prevents unsigned script execution.`);
  return !blocked;
});

function run(shell: string, setup: string, options = "-Yes", action = "Invoke-WinixWindowsBootstrap"): BootstrapResult {
  const harness = `
$ErrorActionPreference = 'Stop'
. '${script}'
$script:calls = @()
$script:versions = @{ 'git.exe' = '2.50.0'; 'node.exe' = '24.0.0'; 'pwsh.exe' = '7.5.0'; 'dsc.exe' = '3.2.0' }
$script:missingWinget = $false
$script:nvm = $false
$script:failInstall = $false
$script:missingResource = $false
$script:noInstallEffect = $false
function Update-WinixBootstrapPath {}
function Get-WinixBootstrapApplication {
    param($Name)
    if ($Name -eq 'winget.exe') { if (-not $script:missingWinget) { return $Name }; return $null }
    if ($Name -eq 'npm.cmd') { return $Name }
    if ($Name -eq 'nvm.exe') { if ($script:nvm) { return $Name }; return $null }
    if ($script:versions.ContainsKey($Name)) { return $Name }
    return $null
}
function Invoke-WinixBootstrapNative {
    param($FilePath, [string[]]$Arguments)
    $script:calls += @{ file = $FilePath; args = @($Arguments) }
    if ($FilePath -eq 'winget.exe') {
        if ($Arguments[0] -eq '--version') { return 'v1.30.0' }
        if ($Arguments[0] -eq 'configure') {
            if ($Arguments[1] -eq '--help') { return '--enable' }
            if ($Arguments -contains '--enable' -and $Arguments.Count -ne 2) {
                throw "Option '--enable' cannot be used with other arguments."
            }
            return
        }
        if ($script:failInstall) { throw 'Synthetic installer failure' }
        if (-not $script:noInstallEffect) {
            switch ($Arguments[2]) {
                'Git.Git' { $script:versions['git.exe'] = '2.50.0' }
                'OpenJS.NodeJS.LTS' { $script:versions['node.exe'] = '24.0.0' }
                'Microsoft.PowerShell' { $script:versions['pwsh.exe'] = '7.5.0' }
                'Microsoft.DSC' { $script:versions['dsc.exe'] = '3.2.0' }
                'CoreyButler.NVMforWindows' { $script:nvm = $true }
                default { throw "Unexpected package: $($Arguments[2])" }
            }
        }
        return
    }
    if ($FilePath -eq 'nvm.exe') {
        if ($Arguments[0] -eq 'use') { $script:versions['node.exe'] = '24.0.0' }
        return
    }
    if ($Arguments[0] -eq '--version') { return $script:versions[$FilePath] }
    if ($FilePath -eq 'dsc.exe') {
        if ($script:missingResource) { return }
        return (@{ type = $Arguments[2] } | ConvertTo-Json -Compress)
    }
}
${setup}
$ok = $false
$failure = $null
try { ${action} ${options}; $ok = $true }
catch { $failure = $_.Exception.Message }
'WINIX_RESULT:' + (@{ ok = $ok; error = $failure; calls = @($script:calls) } | ConvertTo-Json -Depth 8 -Compress)
`;
  const output = execFileSync(shell, [
    "-NoLogo", "-NoProfile", "-NonInteractive",
    "-EncodedCommand", Buffer.from(harness, "utf16le").toString("base64"),
  ], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  const result = output.split(/\r?\n/).find((line) => line.startsWith("WINIX_RESULT:"));
  if (!result) throw new Error(`Missing bootstrap result: ${output}`);
  return JSON.parse(result.slice("WINIX_RESULT:".length));
}

describe.skipIf(process.platform !== "win32").each(shells)("Windows bootstrap using %s (mocked installations)", (shell) => {
  it.each(["22.13.0", "24.0.0", "26.0.0"])("probes supported Node %s without passing removed flags to Node 26", (version) => {
    const result = run(shell, `$script:versions['node.exe'] = '${version}'`, "-Check");
    expect(result.ok, result.error ?? "").toBe(true);
    const probe = result.calls.find((call) => call.file === "node.exe" && call.args.includes("--eval"));
    expect(probe).toBeDefined();
    expect(probe!.args.includes("--experimental-transform-types")).toBe(!version.startsWith("26."));
  });

  it.each(["22.12.0", "25.0.0", "28.0.0"])("rejects unsupported Node %s during check without installing anything", (version) => {
    const result = run(shell, `$script:versions['node.exe'] = '${version}'`, "-Check");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Prerequisites are missing or too old");
    expect(result.calls.some((call) => ["install", "upgrade"].includes(call.args[0]))).toBe(false);
  });
  it("prepares a pinned checkout without npm and preserves it on rerun", () => {
    const root = mkdtempSync(join(tmpdir(), "winix-repository-"));
    try {
      mkdirSync(join(root, ".git"));
      mkdirSync(join(root, "winix"));
      writeFileSync(join(root, "winix", "package.json"), '{"dependencies":{"@adrifer/winix":"0.3.0-preview.1"}}');
      const setup = `
function Invoke-WinixBootstrapNative {
    param($FilePath, [string[]]$Arguments)
    $script:calls += @{ file=$FilePath; args=@($Arguments) }
    if ($FilePath -eq 'git.exe') {
        switch ($Arguments[2]) {
            'remote' { return 'https://example.com/dotfiles.git' }
            'status' { return '' }
            'rev-parse' { return ('a' * 40) }
            default { throw "Unexpected Git mutation: $Arguments" }
        }
    }
    if ($Arguments[0] -eq '--version') { return '0.3.0-preview.1' }
    throw "Unexpected command: $FilePath $Arguments"
}
function Save-WinixVerifiedDownload {
    param($Url,$ChecksumUrl,$Asset,$Destination)
    $script:calls += @{ file='download';args=@($Url,$ChecksumUrl,$Asset) }
    if ($Asset -eq 'bootstrap-windows.ps1') {
        Set-Content -LiteralPath $Destination -Value '# verified prerequisite-only script fixture'
    } else { Set-Content -LiteralPath $Destination -Value 'verified executable fixture' }
}
function Invoke-WinixBootstrapHost {
    param($Binary,[string[]]$Arguments)
    $script:calls += @{file='bootstrap';args=@($Arguments)}
}
`;
      for (let index = 0; index < 2; index++) {
        const result = run(shell, setup,
          `-Repository 'https://example.com/dotfiles.git' -Ref main -Destination '${root.replaceAll("'", "''")}' -HostName desktop -PrepareOnly -Yes`,
          "Invoke-WinixRepositoryBootstrap");
        expect(result.ok, result.error ?? "").toBe(true);
        expect(result.calls.find((call) => call.file === "bootstrap")?.args).toEqual(["bootstrap", "--host", "desktop", "--prepare-only", "--yes"]);
        expect(result.calls.some((call) => call.file === "download" && call.args[0].includes("/v0.3.0-preview.1/"))).toBe(true);
        expect(result.calls.some((call) => call.file === "node.exe" || call.file === "npm.cmd")).toBe(false);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("does not discover/install tools or create files for repository dry-run", () => {
    const root = join(tmpdir(), `winix-nonexistent-${process.pid}`);
    const result = run(shell, "function Get-WinixBootstrapApplication { throw 'Tools must not run' }",
      `-Repository 'https://example.com/dotfiles.git' -Ref main -Destination '${root.replaceAll("'", "''")}' -HostName desktop -DryRun`,
      "Invoke-WinixRepositoryBootstrap");
    expect(result.ok, result.error ?? "").toBe(true);
    expect(result.calls).toEqual([]);
  });

  it("rejects checksum mismatches without replacing a previous executable or leaving temporary downloads", () => {
    const root = mkdtempSync(join(tmpdir(), "winix-checksum-"));
    const binary = join(root, "winix.exe");
    writeFileSync(binary, "old verified executable");
    try {
      const result = run(shell, `
function Invoke-WebRequest {
    param($Uri,$OutFile,[switch]$UseBasicParsing,$TimeoutSec)
    if ($OutFile) { [IO.File]::WriteAllText($OutFile,'corrupt download'); return }
    return @{Content=[Text.Encoding]::UTF8.GetBytes(('a' * 64) + '  winix-windows-x64.exe')}
}
`, `-Url 'https://example.com/winix.exe' -ChecksumUrl 'https://example.com/SHA256SUMS' -Asset 'winix-windows-x64.exe' -Destination '${binary.replaceAll("'", "''")}'`,
      "Save-WinixVerifiedDownload");
      expect(result.ok).toBe(false);
      expect(result.error).toContain("checksum mismatch");
      expect(readFileSync(binary, "utf8")).toBe("old verified executable");
      expect(readdirSync(root)).toEqual(["winix.exe"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("rejects untrusted repository shapes and config path escapes before tools run", () => {
    for (const options of [
      "-Repository 'http://example.com/dotfiles.git' -HostName desktop",
      "-Repository 'https://user:secret@example.com/dotfiles.git' -HostName desktop",
      "-Repository 'https://example.com/dotfiles.git' -HostName desktop -ConfigDirectory '..\\escape'",
    ]) {
      const result = run(shell, "function Get-WinixBootstrapApplication { throw 'Tools must not run' }",
        options + " -Yes", "Invoke-WinixRepositoryBootstrap");
      expect(result.ok).toBe(false);
      expect(result.error).not.toContain("Tools must not run");
      expect(result.calls).toEqual([]);
    }
  });

  it.each([7, 3010])("reports actual native command exit %i instead of continuing", (code) => {
    const child = Buffer.from(`exit ${code}`, "utf16le").toString("base64");
    const harness = `
$ErrorActionPreference = 'Stop'
. '${script}'
try {
    Invoke-WinixBootstrapNative '${shell.replaceAll("'", "''")}' @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', '${child}')
    throw 'Unexpected success'
} catch { $_.Exception.Message }
`;
    const output = execFileSync(shell, [
      "-NoLogo", "-NoProfile", "-NonInteractive",
      "-EncodedCommand", Buffer.from(harness, "utf16le").toString("base64"),
    ], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
    expect(output).toContain(code === 3010 ? "requires a restart" : "exit 7");
    expect(output).not.toContain("Unexpected success");
  });

  it("only inspects prerequisites in check mode", () => {
    const result = run(shell, "", "-Check");
    expect(result.ok).toBe(true);
    expect(result.calls.some((call) => ["install", "upgrade"].includes(call.args[0]))).toBe(false);
    expect(result.calls.some((call) => call.args.includes("--enable"))).toBe(false);
    expect(result.calls.filter((call) => call.file === "dsc.exe" && call.args[0] === "resource")).toHaveLength(4);
  });

  it("reports missing prerequisites without installing them in check mode", () => {
    const result = run(shell, "$script:versions.Remove('node.exe')", "-Check");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("missing or too old");
    expect(result.calls.some((call) => ["install", "upgrade"].includes(call.args[0]))).toBe(false);
  });

  it("checks standalone prerequisites without inspecting or installing Node/npm", () => {
    const result = run(shell, "$script:versions.Remove('node.exe'); $script:nvm = $true", "-Check -Standalone");
    expect(result.ok).toBe(true);
    expect(result.calls.some((call) => ["node.exe", "npm.cmd", "nvm.exe"].includes(call.file))).toBe(false);
    expect(result.calls.filter((call) => call.file === "dsc.exe" && call.args[0] === "resource")).toHaveLength(4);
    const install = run(shell, "$script:versions.Remove('node.exe'); $script:versions.Remove('dsc.exe')", "-Yes -Standalone");
    expect(install.ok).toBe(true);
    expect(install.calls.filter((call) => call.args[0] === "install").map((call) => call.args[2])).toEqual(["Microsoft.DSC"]);
    expect(run(shell, "", "-Standalone -UseNvm").error).toContain("cannot be combined");
  });

  it("installs only missing tools, upgrades outdated ones, then enables configuration", () => {
    const result = run(shell, "$script:versions.Remove('dsc.exe'); $script:versions['node.exe'] = '22.0.0'");
    expect(result.ok).toBe(true);
    const installations = result.calls.filter((call) => ["install", "upgrade"].includes(call.args[0]));
    expect(installations.map((call) => [call.args[0], call.args[2]])).toEqual([
      ["upgrade", "OpenJS.NodeJS.LTS"], ["install", "Microsoft.DSC"],
    ]);
    expect(installations.every((call) => call.args.includes("--exact") && call.args.includes("--source") &&
      call.args.includes("winget") && call.args.includes("--disable-interactivity"))).toBe(true);
    expect(result.calls.some((call) => call.args.join(" ") === "configure --enable")).toBe(true);
    expect(result.calls.some((call) => call.args.includes("--file"))).toBe(false);
  });

  it("uses NVM instead of standalone Node when requested", () => {
    const result = run(shell, "$script:versions.Remove('node.exe')", "-Yes -UseNvm");
    expect(result.ok).toBe(true);
    expect(result.calls.some((call) => call.args[2] === "CoreyButler.NVMforWindows")).toBe(true);
    expect(result.calls.some((call) => call.args[2] === "OpenJS.NodeJS.LTS")).toBe(false);
    expect(result.calls.filter((call) => call.file === "nvm.exe").map((call) => call.args)).toEqual([
      ["install", "lts"], ["use", "lts"],
    ]);
  });

  it("refuses conflicting Node managers before installation", () => {
    const result = run(shell, "$script:versions.Remove('node.exe'); $script:nvm = $true");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Rerun with -UseNvm");
    expect(result.calls.some((call) => ["install", "upgrade"].includes(call.args[0]))).toBe(false);
    const standalone = run(shell, "$script:versions['node.exe'] = '22.0.0'", "-Yes -UseNvm");
    expect(standalone.error).toContain("Existing Node.js");
  });

  it.each([
    ["$script:missingWinget = $true", "App Installer"],
    ["$script:versions['node.exe'] = 'unknown'", "Cannot parse"],
    ["$script:versions['pwsh.exe'] = '7.6.0-preview.1'", "Prerelease"],
    ["$script:versions.Remove('git.exe'); $script:failInstall = $true", "Synthetic installer failure"],
    ["$script:versions.Remove('git.exe'); $script:noInstallEffect = $true", "did not make git.exe ready"],
    ["$script:missingResource = $true", "Required DSC resource is unavailable"],
  ])("fails explicitly for %s", (setup, message) => {
    const result = run(shell, setup);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
  });

  it("requires explicit acceptance for noninteractive bootstrap", () => {
    const result = run(shell, "$script:versions.Remove('git.exe')", "");
    expect(result.ok).toBe(false);
    expect(result.calls.some((call) => ["install", "upgrade"].includes(call.args[0]))).toBe(false);
  });
});
