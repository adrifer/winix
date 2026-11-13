import { execFileSync } from "node:child_process";
import { powerShellLiteral } from "../../helpers/utils.ts";
import type { WinDscProperties, WinPowerShellModule } from "../../types/index.ts";
import type { WindowsLockModule } from "./lockfile.ts";
import { powerShellModuleVersion } from "../../helpers/windows-repositories.ts";

export function powerShellRepositoryScripts(name: string, uri: string): { get: string; test: string; set: string } {
  const prelude = [
    "$ErrorActionPreference = 'Stop'",
    `$repositoryName = ${powerShellLiteral(name)}`,
    `$repositoryUri = ${powerShellLiteral(uri)}`,
    "$registeredRepository = @(Get-PSResourceRepository -ErrorAction Stop | Where-Object { $_.Name -ieq $repositoryName })",
    `if ($registeredRepository.Count -gt 0 -and $registeredRepository[0].Uri.AbsoluteUri.TrimEnd('/') -cne $repositoryUri) { throw "PowerShell repository $repositoryName is already registered with a different URI; resolve the registration conflict explicitly" }`,
  ];
  return {
    get: [...prelude, "$registeredRepository | Select-Object Name,Uri"].join("\n"),
    test: [...prelude, "$registeredRepository.Count -eq 1"].join("\n"),
    set: [
      ...prelude,
      "if ($registeredRepository.Count -eq 0) { Register-PSResourceRepository -Name $repositoryName -Uri $repositoryUri -ErrorAction Stop }",
    ].join("\n"),
  };
}

export type PowerShellGalleryRunner = (script: string) => string;

/** Find-PSResource returns the newest stable release unless -Prerelease is requested. */
export function resolvePowerShellModuleVersion(
  name: string,
  repository: string,
  repositoryUriOrRunner?: string | PowerShellGalleryRunner,
  prereleaseOrRunner: boolean | PowerShellGalleryRunner = false,
  runner?: PowerShellGalleryRunner
): string {
  const repositoryUri = typeof repositoryUriOrRunner === "string" ? repositoryUriOrRunner : undefined;
  const prerelease = prereleaseOrRunner === true;
  const run = (typeof repositoryUriOrRunner === "function" ? repositoryUriOrRunner :
    typeof prereleaseOrRunner === "function" ? prereleaseOrRunner : runner) ??
    ((script: string) => execFileSync(
      "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encode(script)],
      { encoding: "utf8" }
    ));
  const script = [
    "$ErrorActionPreference = 'Stop'",
    ...(repositoryUri ? [powerShellRepositoryScripts(repository, repositoryUri).set] : []),
    `$found = @(Find-PSResource -Name ${powerShellLiteral(name)} -Repository ${powerShellLiteral(repository)}${prerelease ? " -Prerelease" : ""} -ErrorAction Stop)`,
    `if ($found.Count -ne 1 -or $found[0].Name -ine ${powerShellLiteral(name)}${prerelease ? "" : " -or $found[0].Prerelease"}) { throw 'Expected one matching module release' }`,
    "$version = $found[0].Version.ToString()",
    "if ($found[0].Prerelease) { $version += '-' + $found[0].Prerelease }",
    "$version | ConvertTo-Json -Compress",
  ].join("\n");
  try {
    const version: unknown = JSON.parse(run(script).trim());
    if (typeof version !== "string" || !powerShellModuleVersion.test(version) || (!prerelease && version.includes("-"))) {
      throw new Error("Repository did not return an allowed module version");
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
  if (!powerShellModuleVersion.test(pin.version) || (!module.prerelease && pin.version.includes("-"))) {
    throw new Error(`Module ${module.name} has an invalid or disallowed version pin`);
  }
  const [version, prerelease = ""] = pin.version.split(/-(.*)/s);
  const variables = [
    `$name = ${powerShellLiteral(module.name)}`,
    `$version = ${powerShellLiteral(pin.version)}`,
    `$baseVersion = ${powerShellLiteral(version)}`,
    `$prerelease = ${powerShellLiteral(prerelease)}`,
  ];
  const present = "@(Get-Module -ListAvailable -Name $name | Where-Object { $_.Version -eq [version]$baseVersion -and [string]$_.PrivateData.PSData.Prerelease -ceq $prerelease }).Count -gt 0";
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
      `Install-PSResource -Name $name -Version $version -Repository ${powerShellLiteral(pin.repository)}${prerelease ? " -Prerelease" : ""} -Scope CurrentUser -TrustRepository -AcceptLicense -Reinstall -ErrorAction Stop | Out-Null`,
      `if (-not (${present})) { throw "Module $name $version was not installed" }`,
    ].join("\n"),
  };
}
