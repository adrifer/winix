import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";

interface InstallResult {
  ok: boolean;
  error: string | null;
  calls: { file: string; args: string[] }[];
}

const script = join(process.cwd(), "scripts", "install.ps1").replaceAll("'", "''");
const shells = [
  join(process.env.SystemRoot ?? "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
  "pwsh",
].filter((shell) => {
  if (process.platform !== "win32") return true;
  const probe = spawnSync(shell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", "Get-ExecutionPolicy"], { encoding: "utf8", timeout: 15000 });
  if (probe.error) throw probe.error;
  if (probe.status !== 0 && !probe.stderr.includes("CouldNotAutoloadMatchingModule")) throw new Error(probe.stderr);
  const blocked = probe.status !== 0 || ["AllSigned", "Restricted"].includes(probe.stdout.trim());
  if (blocked) console.warn(`Skipping install fixtures in ${shell}: host signing policy/security module prevents unsigned script execution.`);
  return !blocked;
});

/** Runs a function from install.ps1 with every tool, download and Winix call mocked. */
function run(shell: string, setup: string, options = "-Yes", action = "Install-Winix"): InstallResult {
  const harness = `
$ErrorActionPreference = 'Stop'
. '${script}'
$script:calls = @()
$script:versions = @{ 'git.exe' = '2.50.0'; 'pwsh.exe' = '7.5.0'; 'dsc.exe' = '3.2.0' }
$script:missingWinget = $false
$script:failInstall = $false
$script:missingResource = $false
$script:noInstallEffect = $false
$script:dirty = ''
function Update-WinixBootstrapPath {}
function Add-AppxPackage { $script:calls += @{ file = 'Add-AppxPackage'; args = @() }; throw 'not registered' }
function Get-WinixBootstrapApplication {
    param($Name)
    if ($Name -eq 'winget.exe') { if (-not $script:missingWinget) { return $Name }; return $null }
    if ($script:versions.ContainsKey($Name)) { return $Name }
    return $null
}
function Invoke-WinixBootstrapNative {
    param($FilePath, [string[]]$Arguments)
    $script:calls += @{ file = $FilePath; args = @($Arguments) }
    if ($FilePath -eq 'winget.exe') {
        if ($script:failInstall) { throw 'Synthetic installer failure' }
        if (-not $script:noInstallEffect) {
            switch ($Arguments[2]) {
                'Git.Git' { $script:versions['git.exe'] = '2.50.0' }
                'Microsoft.PowerShell' { $script:versions['pwsh.exe'] = '7.5.0' }
                'Microsoft.DSC' { $script:versions['dsc.exe'] = '3.2.0' }
                default { throw "Unexpected package: $($Arguments[2])" }
            }
        }
        return
    }
    if ($Arguments[0] -eq '--version') { return $script:versions[$FilePath] }
    if ($FilePath -eq 'git.exe') {
        switch ($Arguments[2]) {
            'remote' { return 'https://example.com/dotfiles.git' }
            'status' { return $script:dirty }
            'rev-parse' { return ('a' * 40) }
            default { throw "Unexpected Git command: $Arguments" }
        }
    }
    if ($Arguments[0] -eq '--version') { return $script:versions[$FilePath] }
    if ($FilePath -eq 'dsc.exe') {
        if ($script:missingResource) { return }
        return (@{ type = $Arguments[2] } | ConvertTo-Json -Compress)
    }
}
function Get-WinixLatestVersion { $script:calls += @{ file = 'latest'; args = @() }; return '0.9.0' }
function Install-WinixRuntime { param($Version) $script:calls += @{ file = 'runtime'; args = @($Version) }; return 'winix.exe' }
function Invoke-WinixExecutable { param($Binary, [string[]]$Arguments) $script:calls += @{ file = 'winix'; args = @($Arguments) } }
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
  if (!result) throw new Error(`Missing install result: ${output}`);
  return JSON.parse(result.slice("WINIX_RESULT:".length));
}

const installs = (result: InstallResult) =>
  result.calls.filter((call) => ["install", "upgrade"].includes(call.args[0]) && call.file === "winget.exe").map((call) => [call.args[0], call.args[2]]);

describe.skipIf(process.platform !== "win32").each(shells)("install.ps1 using %s (mocked installations)", (shell) => {
  it("without a repository: installs missing prerequisites, the latest Winix and the command", () => {
    const result = run(shell, "$script:versions.Remove('dsc.exe'); $script:versions['pwsh.exe'] = '7.3.0'");
    expect(result.ok, result.error ?? "").toBe(true);
    expect(installs(result)).toEqual([["upgrade", "Microsoft.PowerShell"], ["install", "Microsoft.DSC"]]);
    expect(result.calls.filter((call) => call.file === "winget.exe").every((call) =>
      call.args.includes("--exact") && call.args.includes("--source") && call.args.includes("--disable-interactivity"))).toBe(true);
    expect(result.calls.find((call) => call.file === "runtime")?.args).toEqual(["0.9.0"]);
    expect(result.calls.find((call) => call.file === "winix")?.args).toEqual(["install", "command"]);
    expect(result.calls.filter((call) => call.file === "dsc.exe" && call.args[0] === "resource")).toHaveLength(4);
    // Only what Winix needs: no Node, npm or NVM.
    expect(result.calls.some((call) => /node|npm|nvm/i.test(call.file))).toBe(false);
  });

  it("installs the requested version instead of the latest", () => {
    const result = run(shell, "", "-Version 0.3.2 -Yes");
    expect(result.ok, result.error ?? "").toBe(true);
    expect(result.calls.some((call) => call.file === "latest")).toBe(false);
    expect(result.calls.find((call) => call.file === "runtime")?.args).toEqual(["0.3.2"]);
    expect(run(shell, "", "-Version latest -Yes").error).toContain("-Version takes a release version");
  });

  it("sets up a pinned checkout with the version it pins, and reruns over local changes", () => {
    const root = mkdtempSync(join(tmpdir(), "winix-repository-"));
    try {
      mkdirSync(join(root, ".git"));
      mkdirSync(join(root, "winix"));
      writeFileSync(join(root, "winix", "winix.config.ts"), "export default {}");
      writeFileSync(join(root, "winix", "package.json"), '{"dependencies":{"@adrifer/winix":"0.3.0-preview.1"}}');
      const repository = `-Repository 'https://example.com/dotfiles.git' -Ref main -Destination '${root.replaceAll("'", "''")}'`;
      for (const dirty of ["", " M windows/terminal/settings.json"]) {
        const result = run(shell, `$script:dirty = '${dirty}'`, `${repository} -HostName desktop -PrepareOnly -Yes`);
        expect(result.ok, result.error ?? "").toBe(true);
        expect(result.calls.find((call) => call.file === "runtime")?.args).toEqual(["0.3.0-preview.1"]);
        // Consent was given by the script; Winix asks nothing more.
        expect(result.calls.find((call) => call.file === "winix")?.args).toEqual(["bootstrap", "--confirmed", "--host", "desktop", "--prepare-only", "--yes"]);
        expect(result.calls.some((call) => call.file === "latest")).toBe(false);
      }
      // Without -HostName, Winix lets the user choose (and remembers it).
      const chosen = run(shell, "", `${repository} -Yes`);
      expect(chosen.calls.find((call) => call.file === "winix")?.args).toEqual(["bootstrap", "--confirmed", "--yes"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  }, 30000);

  it("gives a repository without a Winix config the latest Winix and says to run winix init", () => {
    const root = mkdtempSync(join(tmpdir(), "winix-empty-repository-"));
    try {
      mkdirSync(join(root, ".git"));
      const result = run(shell, "", `-Repository 'https://example.com/dotfiles.git' -Destination '${root.replaceAll("'", "''")}' -Yes`);
      expect(result.ok, result.error ?? "").toBe(true);
      expect(result.calls.find((call) => call.file === "runtime")?.args).toEqual(["0.9.0"]);
      expect(result.calls.find((call) => call.file === "winix")?.args).toEqual(["install", "command"]);
      // Without -ConfigDirectory a new config starts at the repository root.
      expect(existsSync(join(root, "winix"))).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("finds a config at the repository root without -ConfigDirectory", () => {
    const root = mkdtempSync(join(tmpdir(), "winix-root-repository-"));
    try {
      mkdirSync(join(root, ".git"));
      writeFileSync(join(root, "winix.config.ts"), "export default {}");
      writeFileSync(join(root, "package.json"), '{"dependencies":{"@adrifer/winix":"0.3.0-preview.1"}}');
      const result = run(shell, "", `-Repository 'https://example.com/dotfiles.git' -Destination '${root.replaceAll("'", "''")}' -HostName desktop -PrepareOnly -Yes`);
      expect(result.ok, result.error ?? "").toBe(true);
      expect(result.calls.find((call) => call.file === "runtime")?.args).toEqual(["0.3.0-preview.1"]);
      expect(result.calls.find((call) => call.file === "winix")?.args).toEqual(["bootstrap", "--confirmed", "--host", "desktop", "--prepare-only", "--yes"]);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  it("changes nothing in a dry run", () => {
    const root = join(tmpdir(), `winix-nonexistent-${process.pid}`);
    for (const options of ["-DryRun", `-Repository 'https://example.com/dotfiles.git' -Destination '${root.replaceAll("'", "''")}' -HostName desktop -DryRun`]) {
      const result = run(shell, "function Get-WinixBootstrapApplication { throw 'Tools must not run' }", options);
      expect(result.ok, result.error ?? "").toBe(true);
      expect(result.calls).toEqual([]);
    }
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

  it("rejects untrusted repositories, path escapes and repository-only options before anything runs", () => {
    for (const options of [
      "-Repository 'http://example.com/dotfiles.git'",
      "-Repository 'https://user:secret@example.com/dotfiles.git'",
      "-Repository 'https://example.com/dotfiles.git' -ConfigDirectory '..\\escape'",
      "-HostName desktop",
      "-PrepareOnly",
    ]) {
      const result = run(shell, "function Get-WinixBootstrapApplication { throw 'Tools must not run' }", options + " -Yes");
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

  it.each([
    ["$script:missingWinget = $true", "App Installer"],
    ["$script:versions['pwsh.exe'] = 'unknown'", "Cannot parse"],
    ["$script:versions['pwsh.exe'] = '7.6.0-preview.1'", "Prerelease"],
    ["$script:versions.Remove('git.exe'); $script:failInstall = $true", "Synthetic installer failure"],
    ["$script:versions.Remove('git.exe'); $script:noInstallEffect = $true", "did not make git.exe ready"],
    ["$script:missingResource = $true", "Required DSC resource is unavailable"],
  ])("fails explicitly for %s", (setup, message) => {
    const result = run(shell, setup);
    expect(result.ok).toBe(false);
    expect(result.error).toContain(message);
  });

  it("asks before changing anything, and needs -Yes without a terminal", () => {
    const result = run(shell, "$script:versions.Remove('git.exe')", "");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("-Yes");
    expect(result.calls).toEqual([]);
  });
});
