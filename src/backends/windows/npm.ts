import type { WinDscProperties } from "../../types/windows.ts";
import { powerShellLiteral } from "../../helpers/utils.ts";

export function npmRegistryProperties(entries: Record<string, string>): WinDscProperties {
  const prelude = `
$ErrorActionPreference = 'Stop'
$entries = ConvertFrom-Json -AsHashtable ${powerShellLiteral(JSON.stringify(entries))}
$path = if ($env:NPM_CONFIG_USERCONFIG) {
  [Environment]::ExpandEnvironmentVariables($env:NPM_CONFIG_USERCONFIG)
} else { Join-Path ([Environment]::GetFolderPath('UserProfile')) '.npmrc' }
if (-not [IO.Path]::IsPathFullyQualified($path)) { throw 'npm userconfig must be an absolute path' }
if (Test-Path -LiteralPath $path) {
  if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) {
    throw 'npm userconfig is a symlink; configure its source file explicitly instead'
  }
}
function Read-WinixNpmConfig {
  if (-not (Test-Path -LiteralPath $path)) { return '' }
  return [IO.File]::ReadAllText($path, [Text.UTF8Encoding]::new($false, $true))
}
function Get-WinixNpmKey([string]$line) {
  if ($line -match '^\\s*([^#;=\\s]+)\\s*=') { return $Matches[1] }
  return ''
}
function Test-WinixNpmConfig([string]$text) {
  foreach ($key in $entries.Keys) {
    $matching = @($text -split '\\r?\\n' | Where-Object { (Get-WinixNpmKey $_) -ceq $key })
    if ($matching.Count -ne 1) { return $false }
    if (($matching[0] -split '=', 2)[1].Trim() -cne $entries[$key]) { return $false }
  }
  return $true
}`;
  return {
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixNpmConfig (Read-WinixNpmConfig)) }`,
    testScript: `${prelude}\nTest-WinixNpmConfig (Read-WinixNpmConfig)`,
    setScript: `${prelude}
$original = Read-WinixNpmConfig
if (Test-WinixNpmConfig $original) { return }
$newline = if ($original.Contains("\`r\`n")) { "\`r\`n" } else { "\`n" }
$lines = [Collections.Generic.List[string]]::new()
foreach ($line in ($original -split '\\r?\\n')) {
  if (-not $entries.ContainsKey((Get-WinixNpmKey $line))) { $lines.Add($line) }
}
if ($lines.Count -gt 0 -and $lines[$lines.Count - 1] -eq '') { $lines.RemoveAt($lines.Count - 1) }
foreach ($key in ($entries.Keys | Sort-Object)) { $lines.Add("$key=$($entries[$key])") }
$next = ($lines -join $newline) + $newline
$parent = [IO.Path]::GetDirectoryName($path)
[IO.Directory]::CreateDirectory($parent) | Out-Null
$temporary = Join-Path $parent ('.winix-npm-' + [guid]::NewGuid().ToString() + '.tmp')
try {
  [IO.File]::WriteAllText($temporary, $next, [Text.UTF8Encoding]::new($false))
  if ((Read-WinixNpmConfig) -cne $original) { throw 'npm userconfig changed during activation; rerun' }
  if (Test-Path -LiteralPath $path) {
    if ((Get-Item -LiteralPath $path).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'npm userconfig became a link' }
    [IO.File]::Replace($temporary, $path, [NullString]::Value)
  } else { [IO.File]::Move($temporary, $path, $false) }
} finally {
  if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
}
if (-not (Test-WinixNpmConfig (Read-WinixNpmConfig))) { throw 'npm registry configuration verification failed' }`,
  };
}
