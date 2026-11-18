import { execFileSync } from "node:child_process";
import { powerShellLiteral } from "../../helpers/utils.ts";
import type { WinDscProperties, WinPowerShellModule } from "../../types/index.ts";
import type { WindowsLockModule } from "./lockfile.ts";
import {
  powerShellModuleVersion, powerShellRepositoryName, powerShellRepositoryUri,
} from "../../helpers/windows-repositories.ts";

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

const galleryUri = "https://www.powershellgallery.com/api/v2";

export async function resolvePowerShellModuleVersion(
  name: string,
  repository: string,
  repositoryUri?: string,
  prerelease = false,
  { run = runPowerShell, fetch: fetchFeed = fetch }: { run?: PowerShellGalleryRunner; fetch?: typeof fetch } = {}
): Promise<string> {
  const isGallery = !repositoryUri && repository.toLowerCase() === "psgallery";
  try {
    if (!powerShellRepositoryName.test(name) || !powerShellRepositoryName.test(repository)) {
      throw new Error("Expected an exact module and repository name without paths or wildcards");
    }
    const uri = repositoryUri === undefined ? undefined : powerShellRepositoryUri(repositoryUri);
    const find = registeredModuleScript(name, repository, uri ?? (isGallery ? galleryUri : undefined), prerelease);
    let version: unknown;
    try {
      version = JSON.parse(run(find).trim());
    } catch (error) {
      if (!uri || !(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
      // An anonymous V3 policy feed can also be resolved without pwsh.
      version = null;
    }
    if (version === null) {
      if (uri) version = await resolveNugetV3Version(name, uri, prerelease, fetchFeed);
      else if (isGallery) version = JSON.parse(run(galleryModuleScript(name, prerelease)).trim());
      else throw new Error("The repository must already be registered for the current user");
    }
    if (typeof version !== "string" || !powerShellModuleVersion.test(version) || (!prerelease && version.includes("-"))) {
      throw new Error("Repository did not return an allowed module version");
    }
    return version;
  } catch (error) {
    const source = repositoryUri === undefined ? (isGallery ? galleryUri : "registered URI") :
      describeRepositoryUri(repositoryUri);
    throw new Error(
      `Failed to resolve PowerShell module "${name}" from "${repository}" (${source}): ` +
      (error instanceof Error ? error.message : String(error)),
      { cause: error }
    );
  }
}

function describeRepositoryUri(value: string): string {
  try { return powerShellRepositoryUri(value); } catch { return "invalid repository URI"; }
}

function registeredModuleScript(name: string, repository: string, uri: string | undefined, prerelease: boolean): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    // Both PSResourceGet cmdlets initialize a missing store. Keep the existing file open read-only
    // and deny deletion on Windows until the lookup completes.
    "$localAppData = [Environment]::GetFolderPath('LocalApplicationData')",
    "if (-not $localAppData) { 'null'; return }",
    "$store = Join-Path $localAppData 'PSResourceGet/PSResourceRepository.xml'",
    "try { $storeHandle = [IO.File]::Open($store, 'Open', 'Read', 'Read') }",
    "catch [IO.FileNotFoundException], [IO.DirectoryNotFoundException] { 'null'; return }",
    "try {",
    `$registeredRepository = @(Get-PSResourceRepository -ErrorAction Stop | Where-Object { $_.Name -ieq ${powerShellLiteral(repository)} })`,
    `if ($registeredRepository.Count -ne 1${uri ? ` -or $registeredRepository[0].Uri.AbsoluteUri.TrimEnd('/') -cne ${powerShellLiteral(uri)}` : ""}) { 'null'; return }`,
    `$found = @(Find-PSResource -Name ${powerShellLiteral(name)} -Repository ${powerShellLiteral(repository)}${prerelease ? " -Prerelease" : ""} -ErrorAction Stop)`,
    `if ($found.Count -ne 1 -or $found[0].Name -ine ${powerShellLiteral(name)}${prerelease ? "" : " -or $found[0].Prerelease"}) { throw 'Expected one matching module release' }`,
    "$version = $found[0].Version.ToString()",
    "if ($found[0].Prerelease) { $version += '-' + $found[0].Prerelease }",
    "$version | ConvertTo-Json -Compress",
    "} finally { $storeHandle.Dispose() }",
  ].join("\n");
}

function galleryModuleScript(name: string, prerelease: boolean): string {
  const url = new URL(`${galleryUri}/FindPackagesById()`);
  url.searchParams.set("id", `'${name}'`);
  url.searchParams.set("$filter", `Id eq '${name}' and ${prerelease ? "IsAbsoluteLatestVersion" : "IsLatestVersion"} eq true`);
  return [
    "$ErrorActionPreference = 'Stop'",
    `[xml]$feed = (Invoke-WebRequest -Uri ${powerShellLiteral(url.href)} -MaximumRedirection 0 -TimeoutSec 30).Content`,
    "$ns = [Xml.XmlNamespaceManager]::new($feed.NameTable)",
    "$ns.AddNamespace('a', 'http://www.w3.org/2005/Atom')",
    "$ns.AddNamespace('m', 'http://schemas.microsoft.com/ado/2007/08/dataservices/metadata')",
    "$ns.AddNamespace('d', 'http://schemas.microsoft.com/ado/2007/08/dataservices')",
    "$releases = @($feed.SelectNodes('/a:feed/a:entry/m:properties', $ns) |",
    `  Where-Object { $_.SelectSingleNode('d:Id', $ns).InnerText -ieq ${powerShellLiteral(name)} })`,
    "if ($releases.Count -ne 1) { throw 'Expected one matching module release from the PowerShell Gallery' }",
    "$releases[0].SelectSingleNode('d:Version', $ns).InnerText | ConvertTo-Json -Compress",
  ].join("\n");
}

async function resolveNugetV3Version(name: string, uri: string, prerelease: boolean, fetchFeed: typeof fetch): Promise<string> {
  async function getJson(url: string): Promise<unknown> {
    let response: Response;
    try {
      response = await fetchFeed(url, {
        credentials: "omit", redirect: "manual", signal: AbortSignal.timeout(30000),
        headers: { Accept: "application/json" },
      });
    } catch (error) {
      // undici reports only "fetch failed"; the cause names TLS, DNS, proxy or timeout failures.
      const cause = error instanceof Error && error.cause instanceof Error ? error.cause : undefined;
      const code = cause && "code" in cause && typeof cause.code === "string" ? `${cause.code}: ` : "";
      const message = error instanceof Error ? error.message : String(error);
      const detail = ` (${cause ? `${message}: ${code}${cause.message.split("\n")[0]}` : message})`;
      throw new Error(`NuGet request to ${url} failed${detail}. Check network access to the feed.`, { cause: error });
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`NuGet request failed (HTTP ${response.status}) for ${url}`);
    }
    return response.json();
  }

  const index = await getJson(uri).catch((error: unknown) => {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error("Expected a JSON NuGet v3 service index; other feeds require an existing matching PSResourceGet registration", { cause: error });
  });
  const resources = index && typeof index === "object" && "resources" in index ? index.resources : undefined;
  const resource: unknown = Array.isArray(resources) ? resources.find((value: unknown) =>
    value && typeof value === "object" && "@type" in value && value["@type"] === "PackageBaseAddress/3.0.0"
  ) : undefined;
  if (!resource || typeof resource !== "object" || !("@id" in resource) || typeof resource["@id"] !== "string") {
    throw new Error("Expected a NuGet v3 service index with PackageBaseAddress/3.0.0; other feeds require an existing matching PSResourceGet registration");
  }
  const base = powerShellRepositoryUri(resource["@id"]);
  const releases = await getJson(`${base}/${name.toLowerCase()}/index.json`);
  const versions = releases && typeof releases === "object" && "versions" in releases ? releases.versions : undefined;
  if (!Array.isArray(versions) || !versions.every((value: unknown): value is string =>
    typeof value === "string" && powerShellModuleVersion.test(value))) {
    throw new Error("NuGet feed did not return valid module versions");
  }
  const latest = versions.filter((version) => prerelease || !version.includes("-")).sort(compareModuleVersions).at(-1);
  if (!latest) throw new Error(`NuGet feed has no ${prerelease ? "matching" : "stable"} module releases`);
  return latest;
}

function compareModuleVersions(left: string, right: string): number {
  const [leftVersion, leftLabel] = left.toLowerCase().split(/-(.*)/);
  const [rightVersion, rightLabel] = right.toLowerCase().split(/-(.*)/);
  const a = leftVersion.split(".").map(BigInt);
  const b = rightVersion.split(".").map(BigInt);
  for (let i = 0; i < 4; i++) {
    const x = a[i] ?? 0n;
    const y = b[i] ?? 0n;
    if (x !== y) return x < y ? -1 : 1;
  }
  if (!leftLabel || !rightLabel) return Number(!leftLabel) - Number(!rightLabel);
  const leftParts = leftLabel.split(".");
  const rightParts = rightLabel.split(".");
  for (let i = 0; i < Math.min(leftParts.length, rightParts.length); i++) {
    const x = leftParts[i];
    const y = rightParts[i];
    const xNumeric = /^\d+$/.test(x);
    const yNumeric = /^\d+$/.test(y);
    if (xNumeric && yNumeric) {
      if (BigInt(x) !== BigInt(y)) return BigInt(x) < BigInt(y) ? -1 : 1;
    } else if (xNumeric !== yNumeric) return xNumeric ? -1 : 1;
    else if (x !== y) return x < y ? -1 : 1;
  }
  return leftParts.length - rightParts.length;
}

function runPowerShell(script: string): string {
  return execFileSync(
    "pwsh", ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { encoding: "utf8" }
  );
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
