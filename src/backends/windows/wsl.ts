import type { WinDscProperties, WinWslDistro } from "../../types/index.ts";
import { filePathExpression, filePathPrelude } from "../../helpers/windows.ts";
import { powerShellLiteral as ps } from "../../helpers/utils.ts";
import type { WindowsLockWslImage } from "./lockfile.ts";
import { wslRepositoryKey, wslSetupPrelude, wslScriptInvocation, type WindowsLockWslRepository } from "./wsl-setup.ts";

export type WslArchitecture = "x64" | "arm64";
export type WindowsWslImageResolver = (architecture: WslArchitecture) =>
  Omit<WindowsLockWslImage, "resolvedAt"> | Promise<Omit<WindowsLockWslImage, "resolvedAt">>;

export function validWslImage(value: unknown): value is WindowsLockWslImage {
  if (!value || typeof value !== "object") return false;
  const entry = value as Record<string, unknown>;
  if (entry.source !== "nixos-wsl" || !["x64", "arm64"].includes(String(entry.architecture)) ||
      typeof entry.version !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(entry.version) ||
      typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256) ||
      typeof entry.resolvedAt !== "string") return false;
  const asset = entry.architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl";
  return entry.url === `https://github.com/nix-community/NixOS-WSL/releases/download/${entry.version}/${asset}`;
}

export const resolveNixosWslImage: WindowsWslImageResolver = async (architecture) => {
  const assetName = architecture === "x64" ? "nixos.wsl" : "nixos.aarch64.wsl";
  const response = await fetch("https://api.github.com/repos/nix-community/NixOS-WSL/releases/latest", {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "Winix" },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`NixOS-WSL release lookup failed: HTTP ${response.status}`);
  const release: unknown = await response.json();
  if (!release || typeof release !== "object" || !("draft" in release) || release.draft !== false ||
      !("prerelease" in release) || release.prerelease !== false) {
    throw new Error("Expected a stable NixOS-WSL release");
  }
  const asset = "assets" in release && Array.isArray(release.assets)
    ? release.assets.find((entry: unknown): entry is Record<string, unknown> =>
      !!entry && typeof entry === "object" && "name" in entry && entry.name === assetName)
    : undefined;
  if (!asset || typeof asset.digest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(asset.digest)) {
    throw new Error("Release asset lacks a SHA256 digest");
  }
  const image = {
    source: "nixos-wsl" as const, architecture,
    version: "tag_name" in release ? release.tag_name : undefined,
    url: asset.browser_download_url, sha256: asset.digest.slice(7), resolvedAt: "",
  };
  if (!validWslImage(image)) {
    throw new Error("Invalid official NixOS-WSL release image");
  }
  const { resolvedAt: _, ...validated } = image;
  return validated;
};

export function optionalFeatureProperties(names: string[], enabled: boolean): WinDscProperties {
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    ` $names = @(${names.map(ps).join(", ")})`,
    ` $enabled = ${enabled ? "$true" : "$false"}`,
    "function Get-WinixFeatureStates {",
    "  foreach ($name in $names) { Get-WindowsOptionalFeature -Online -FeatureName $name -ErrorAction Stop }",
    "}",
    "function Test-WinixFeatures {",
    "  foreach ($feature in @(Get-WinixFeatureStates)) {",
    "    $state = [string]$feature.State",
    "    if ($enabled) { if ($state -ne 'Enabled') { return $false } }",
    "    elseif ($state -notin @('Disabled', 'DisabledWithPayloadRemoved')) { return $false }",
    "  }",
    "  return $true",
    "}",
  ];
  return {
    getScript: [...prelude, "Get-WinixFeatureStates | Select-Object FeatureName,State"].join("\n"),
    testScript: [...prelude, "Test-WinixFeatures"].join("\n"),
    setScript: [
      ...prelude,
      "$restart = $false",
      "foreach ($feature in @(Get-WinixFeatureStates)) {",
      "  $state = [string]$feature.State",
      "  if ($state -in @('EnablePending', 'DisablePending')) { $restart = $true; continue }",
      "  if ($enabled -and $state -ne 'Enabled') {",
      "    $result = Enable-WindowsOptionalFeature -Online -FeatureName $feature.FeatureName -All -NoRestart -ErrorAction Stop",
      "    $restart = $restart -or [bool]$result.RestartNeeded",
      "  } elseif (-not $enabled -and $state -notin @('Disabled', 'DisabledWithPayloadRemoved')) {",
      "    $result = Disable-WindowsOptionalFeature -Online -FeatureName $feature.FeatureName -NoRestart -ErrorAction Stop",
      "    $restart = $restart -or [bool]$result.RestartNeeded",
      "  }",
      "}",
      "if ($restart -or -not (Test-WinixFeatures)) {",
      "  throw 'WINIX_REBOOT_REQUIRED: Restart Windows yourself, then rerun winix switch. Dependent provisioning was not completed.'",
      "}",
    ].join("\n"),
  };
}

export function wslIdentityProbe(host: string): string {
  return [
    "set -euo pipefail",
    'export PATH="/run/current-system/sw/bin:/run/wrappers/bin${PATH:+:$PATH}"',
    "grep -Eq '^ID=\"?nixos\"?$' /etc/os-release || { echo 'Existing WSL distro must run NixOS' >&2; exit 2; }",
    'actual=$(cat /proc/sys/kernel/hostname)',
    `expected='${host.replaceAll("'", "'\\''")}'`,
    '[[ "$actual" == "$expected" ]] || { printf \'Existing NixOS WSL hostname mismatch: expected %s, found %s\\n\' "$expected" "$actual" >&2; exit 2; }',
  ].join("\n");
}

export function wslDistroProperties(
  distro: WinWslDistro, pins: Record<string, WindowsLockWslImage>,
  repositories: Record<string, WindowsLockWslRepository> = {}
): WinDscProperties {
  const images: string[] = [];
  for (const architecture of ["x64", "arm64"] as const) {
    const pin = pins[`nixos-wsl/${architecture}`];
    if (!validWslImage(pin) || pin.architecture !== architecture) {
      throw new Error(`Missing/invalid nixos-wsl/${architecture} image pin. Run winix update --windows nixos-wsl.`);
    }
    images.push(`${architecture} = @{ Url = ${ps(pin.url)}; Sha256 = ${ps(pin.sha256)}; Version = ${ps(pin.version)} }`);
  }
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    ...filePathPrelude(),
    "if ([Security.Principal.WindowsIdentity]::GetCurrent().IsSystem) { throw 'WSL provisioning must run as the intended Windows user, not SYSTEM' }",
    `$name = ${ps(distro.name)}`,
    `$expectedHostname = ${ps(distro.host ?? distro.setup?.host ?? "")}`,
    `$location = ${filePathExpression(distro.installLocation)}`,
    "if (-not [IO.Path]::IsPathFullyQualified($location)) { throw 'WSL installLocation must resolve to an absolute path' }",
    "$location = [IO.Path]::GetFullPath($location)",
    "if ($location -notmatch '^[a-zA-Z]:\\\\' -or $location.TrimEnd('\\') -eq [IO.Path]::GetPathRoot($location).TrimEnd('\\')) {",
    "  throw 'WSL installLocation must be an absolute local-drive directory, not a drive root or UNC path'",
    "}",
    "$marker = Join-Path $location '.winix-wsl.json'",
    "$localAppData = [Environment]::GetFolderPath('LocalApplicationData')",
    "if (-not $localAppData -or -not [IO.Path]::IsPathFullyQualified($localAppData)) { throw 'Cannot determine WSL tracking location' }",
    "$trackingDirectory = Join-Path $localAppData 'Winix\\wsl-registrations'",
    `$tracking = Join-Path $trackingDirectory ${ps(`registration-${distro.name.toLowerCase()}.json`)}`,
    "$lxss = 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Lxss'",
    ` $makeDefault = ${distro.default ? "$true" : "$false"}`,
    ` $images = @{ ${images.join("; ")} }`,
    "function Normalize-WinixWslPath([string]$Path) {",
    "  if ($Path.StartsWith('\\\\?\\')) { $Path = $Path.Substring(4) }",
    "  [IO.Path]::TrimEndingDirectorySeparator([IO.Path]::GetFullPath($Path))",
    "}",
    "function Get-WinixWslRegistration {",
    "  if (-not (Test-Path -LiteralPath $lxss)) { return $null }",
    "  $matches = @(Get-ChildItem -LiteralPath $lxss | ForEach-Object { Get-ItemProperty -LiteralPath $_.PSPath } |",
    "    Where-Object { $_.DistributionName -ieq $name })",
    "  if ($matches.Count -gt 1) { throw \"Ambiguous WSL registration: $name\" }",
    "  if ($matches.Count -eq 1) { return $matches[0] }",
    "  return $null",
    "}",
    "function Assert-WinixWslLocation($Registration) {",
    "  if ((Normalize-WinixWslPath $Registration.BasePath) -ine (Normalize-WinixWslPath $location) -or $Registration.Version -ne 2 -or -not $Registration.PSChildName) {",
    "    throw \"Conflicting WSL registration for $name; refusing to move, replace, or convert an existing distro\"",
    "  }",
    "}",
    "function Get-WinixWslTracking {",
    "  if (-not (Test-Path -LiteralPath $tracking)) { return $null }",
    "  $record = [IO.File]::ReadAllText($tracking) | ConvertFrom-Json",
    "  if ($record.version -ne 1 -or $record.source -ne 'nixos-wsl' -or $record.name -ine $name -or",
    "      $record.adopted -isnot [bool] -or $record.registration -isnot [string] -or -not $record.registration -or",
    "      $record.location -isnot [string] -or -not [IO.Path]::IsPathFullyQualified($record.location) -or",
    "      ($record.adopted -and ($record.host -isnot [string] -or -not $record.host))) {",
    "    throw \"Invalid WSL tracking record: $tracking; inspect it before manual recovery\"",
    "  }",
    "  return $record",
    "}",
    "function Assert-WinixWslIdentity {",
    "  if (-not $expectedHostname) { throw \"Cannot adopt existing WSL distro $name without an expected Linux hostname; declare host or setup.host\" }",
    "  if (-not (Invoke-WinixWslIdentity $true)) { throw 'WSL identity validation did not complete' }",
    "}",
    "function Get-WinixWslKind($Registration, $Record) {",
    "  if ($Registration.Version -ne 2 -or -not $Registration.PSChildName) { throw \"Expected a WSL 2 registration for $name; refusing conversion or replacement\" }",
    "  if ($null -ne $Record) {",
    "    if ($Record.registration -ine $Registration.PSChildName -or",
    "        (Normalize-WinixWslPath $Record.location) -ine (Normalize-WinixWslPath $Registration.BasePath)) {",
    "      throw \"Tracked WSL registration changed for $name; refusing replacement\"",
    "    }",
    "    if ($Record.adopted) {",
    "      if ($Record.host -cne $expectedHostname) { throw \"Adopted WSL hostname declaration changed for $name; refusing relink\" }",
    "      Assert-WinixWslIdentity",
    "      return 'adopted'",
    "    }",
    "  }",
    "  $existingMarker = Join-Path $Registration.BasePath '.winix-wsl.json'",
    "  if (Test-Path -LiteralPath $existingMarker) {",
    "    Assert-WinixWslLocation $Registration",
    "    $legacy = [IO.File]::ReadAllText($existingMarker) | ConvertFrom-Json",
    "    if ($legacy.version -ne 1 -or $legacy.source -ne 'nixos-wsl' -or $legacy.name -ine $name -or $legacy.registration -ine $Registration.PSChildName) {",
    "      throw \"WSL ownership marker does not match registration for $name\"",
    "    }",
    "    return 'created'",
    "  }",
    "  if ($null -ne $Record) { throw \"Winix-created WSL distro $name has lost its ownership marker; refusing adoption\" }",
    "  if (Test-Path -LiteralPath $marker) { throw \"Conflicting WSL registration for $name; the configured location already has a Winix marker\" }",
    "  Assert-WinixWslIdentity",
    "  return 'adopted'",
    "}",
    "function Register-WinixWsl($Registration, [bool]$Adopted) {",
    "  $current = Get-WinixWslRegistration",
    "  if ($null -eq $current -or $current.PSChildName -ine $Registration.PSChildName -or",
    "      (Normalize-WinixWslPath $current.BasePath) -ine (Normalize-WinixWslPath $Registration.BasePath) -or $current.Version -ne 2) {",
    "    throw 'WSL registration changed during validation; refusing to record it'",
    "  }",
    "  [IO.Directory]::CreateDirectory($trackingDirectory) | Out-Null",
    "  $record = @{ version = 1; source = 'nixos-wsl'; name = $name; registration = $Registration.PSChildName;",
    "    location = Normalize-WinixWslPath $Registration.BasePath; adopted = $Adopted; host = $expectedHostname }",
    "  $stream = [IO.File]::Open($tracking, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)",
    "  $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))",
    "  try { $writer.Write(($record | ConvertTo-Json -Compress)) } finally { $writer.Dispose() }",
    "}",
    "function Test-WinixWslDefault($Registration) {",
    "  if (-not $makeDefault) { return $true }",
    "  return (Get-ItemProperty -LiteralPath $lxss).DefaultDistribution -ieq $Registration.PSChildName",
    "}",
    "function Invoke-WinixWsl([string[]]$Arguments) {",
    "  $output = @(& wsl.exe @Arguments)",
    "  if ($LASTEXITCODE -ne 0) { throw \"WSL command failed ($LASTEXITCODE): $($Arguments -join ' ') $($output -join ' ')\" }",
    "}",
  ];
  const identity = wslIdentityProbe(distro.host ?? distro.setup?.host ?? "");
  prelude.push(...wslScriptInvocation("Invoke-WinixWslIdentity", identity, identity, "WSL identity validation"));
  if (distro.setup) {
    const pin = repositories[wslRepositoryKey(distro.setup)];
    if (!pin) throw new Error("Missing WSL setup repository pin. Run winix update --windows wsl-setup.");
    prelude.push(...wslSetupPrelude(distro.setup, pin));
  }
  return {
    getScript: [
      ...prelude,
      "$registration = Get-WinixWslRegistration",
      "$record = Get-WinixWslTracking",
      "if ($null -eq $registration -and $null -ne $record) { throw 'Tracked WSL registration is missing; inspect tracking before creating a replacement' }",
      "if ($null -ne $registration) { [void](Get-WinixWslKind $registration $record) }",
      "$registration | Select-Object DistributionName,BasePath,Version",
    ].join("\n"),
    testScript: [
      ...prelude,
      "$registration = Get-WinixWslRegistration",
      "$record = Get-WinixWslTracking",
      "if ($null -eq $registration -and $null -ne $record) { throw 'Tracked WSL registration is missing; inspect tracking before creating a replacement' }",
      "if ($null -eq $registration) { return $false }",
      "$kind = Get-WinixWslKind $registration $record",
      "if ($null -eq $record) { return $false }",
      "if ($kind -eq 'adopted') { return $true }",
      ...(distro.setup ? ["if (-not (Invoke-WinixWslSetup $true)) { return $false }"] : []),
      "Test-WinixWslDefault $registration",
    ].join("\n"),
    setScript: [
      ...prelude,
      "$registration = Get-WinixWslRegistration",
      "$record = Get-WinixWslTracking",
      "if ($null -eq $registration -and $null -ne $record) { throw 'Tracked WSL registration is missing; inspect tracking before creating a replacement' }",
      "if ($null -ne $registration) { $kind = Get-WinixWslKind $registration $record } else {",
      "  if ((Test-Path -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Component Based Servicing\\RebootPending') -or",
      "      (Test-Path -LiteralPath 'HKLM:\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\WindowsUpdate\\Auto Update\\RebootRequired')) {",
      "    throw 'WINIX_REBOOT_REQUIRED: Restart Windows yourself, then rerun winix switch before registering WSL.'",
      "  }",
      "  if (Test-Path -LiteralPath $location) { throw \"WSL install location already exists; refusing to overwrite: $location\" }",
      "  $architecture = [Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()",
      "  if (-not $images.ContainsKey($architecture)) { throw \"Unsupported WSL image architecture: $architecture\" }",
      "  $image = $images[$architecture]",
      "  $temporary = Join-Path ([IO.Path]::GetTempPath()) ('winix-wsl-' + [guid]::NewGuid().ToString('N'))",
      "  [IO.Directory]::CreateDirectory($temporary) | Out-Null",
      "  try {",
      "    $archive = Join-Path $temporary 'nixos.wsl'",
      "    Invoke-WebRequest -Uri $image.Url -OutFile $archive -ErrorAction Stop",
      "    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $image.Sha256) {",
      "      throw 'NixOS-WSL download checksum mismatch; refusing registration'",
      "    }",
      "    [IO.Directory]::CreateDirectory((Split-Path -Parent $location)) | Out-Null",
      "    Invoke-WinixWsl @('--import', $name, $location, $archive, '--version', '2')",
      "    $registration = Get-WinixWslRegistration",
      "    if ($null -eq $registration) { throw 'WSL import returned success without registering the requested distro' }",
      "    Assert-WinixWslLocation $registration",
      "    $markerRecord = @{ version = 1; source = 'nixos-wsl'; name = $name; registration = $registration.PSChildName; imageVersion = $image.Version; sha256 = $image.Sha256 }",
      "    $stream = [IO.File]::Open($marker, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)",
      "    $writer = [IO.StreamWriter]::new($stream, [Text.UTF8Encoding]::new($false))",
      "    try { $writer.Write(($markerRecord | ConvertTo-Json -Compress)) } finally { $writer.Dispose() }",
      "  } finally { Remove-Item -LiteralPath $temporary -Recurse -Force }",
      "  $kind = 'created'",
      "}",
      "if ($null -eq $record) { Register-WinixWsl $registration ($kind -eq 'adopted') }",
      "if ($kind -eq 'adopted') { Write-Host 'Existing NixOS WSL distro linked; Linux activation remains manual.'; return }",
      ...(distro.setup ? ["[void](Invoke-WinixWslSetup $false)"] : []),
      "if (-not (Test-WinixWslDefault $registration)) { Invoke-WinixWsl @('--set-default', $name) }",
      "if (-not (Test-WinixWslDefault $registration)) { throw 'WSL default distribution verification failed' }",
    ].join("\n"),
  };
}
