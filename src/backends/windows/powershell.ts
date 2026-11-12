import { execFileSync } from "node:child_process";
import { powerShellLiteral } from "../../helpers/utils.ts";
import type { WinDscProperties, WinPowerShellModule } from "../../types/index.ts";
import type { WindowsLockModule } from "./lockfile.ts";

export type PowerShellGalleryRunner = (script: string) => string;

/** Find-PSResource returns the newest stable release unless -Prerelease is requested. */
export function resolvePowerShellModuleVersion(
  name: string,
  repository: string,
  run: PowerShellGalleryRunner = (script) => execFileSync(
    "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encode(script)],
    { encoding: "utf8" }
  )
): string {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$found = @(Find-PSResource -Name ${powerShellLiteral(name)} -Repository ${powerShellLiteral(repository)} -ErrorAction Stop)`,
    `if ($found.Count -ne 1 -or $found[0].Name -ine ${powerShellLiteral(name)} -or $found[0].Prerelease) { throw 'Expected one stable module release' }`,
    "$found[0].Version.ToString() | ConvertTo-Json -Compress",
  ].join("\n");
  try {
    const version: unknown = JSON.parse(run(script).trim());
    if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(version)) {
      throw new Error("Repository did not return a stable module version");
    }
    return version;
  } catch (error) {
    throw new Error(
      `Failed to resolve PowerShell module "${name}" from "${repository}". ` +
      `PowerShell 7 with PSResourceGet and the registered repository is required: ` +
      (error instanceof Error ? error.message : String(error)),
      { cause: error }
    );
  }
}

function encode(script: string): string {
  return Buffer.from(script, "utf16le").toString("base64");
}

export function powerShellModuleProperties(
  module: WinPowerShellModule,
  pin: WindowsLockModule
): WinDscProperties {
  const variables = [
    `$name = ${powerShellLiteral(module.name)}`,
    `$version = ${powerShellLiteral(pin.version)}`,
  ];
  const present = "@(Get-Module -ListAvailable -Name $name | Where-Object { $_.Version -eq [version]$version -and -not $_.PrivateData.PSData.Prerelease }).Count -gt 0";
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    "if ($PSVersionTable.PSVersion.Major -lt 7) { throw 'PowerShell 7 is required' }",
    ...variables,
  ];
  return {
    getScript: [
      ...prelude,
      "Get-Module -ListAvailable -Name $name | Select-Object Name,@{Name='Version';Expression={$_.Version.ToString()}}",
    ].join("\n"),
    testScript: [...prelude, present].join("\n"),
    setScript: [
      ...prelude,
      `if (${present}) { return }`,
      `Install-PSResource -Name $name -Version $version -Repository ${powerShellLiteral(pin.repository)} -Scope CurrentUser -TrustRepository -AcceptLicense -Reinstall -ErrorAction Stop | Out-Null`,
      `if (-not (${present})) { throw "Module $name $version was not installed" }`,
    ].join("\n"),
  };
}
