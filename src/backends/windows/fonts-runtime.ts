export const fontInstallPrelude = String.raw`
function Get-WinixFontRegistry {
  return [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\Microsoft\Windows NT\CurrentVersion\Fonts')
}
function Test-WinixFonts {
  if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { return $false }
  $record = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
  if ($record.version -ne 1 -or @($record.fonts).Count -eq 0) { throw 'Invalid Winix font manifest' }
  foreach ($source in $plan) {
    if ($source.path) {
      $path = [Environment]::ExpandEnvironmentVariables($source.path)
      if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Local font does not exist: $path" }
      $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
      if (-not @($record.sources | Where-Object { $_.path -eq $source.path -and $_.sha256 -eq $hash }).Count) { return $false }
    }
    $destination = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
    foreach ($font in $record.fonts) {
      if (-not $font.name -or [IO.Path]::GetFileName($font.name) -ne $font.name -or
          $font.path -ne (Join-Path $destination $font.name) -or $font.sha256 -notmatch '^[a-f0-9]{64}$') {
        throw 'Invalid Winix font manifest entry'
      }
    }
  }
  $registry = Get-WinixFontRegistry
  if ($null -eq $registry) { return $false }
  try {
    foreach ($font in $record.fonts) {
      if (-not (Test-Path -LiteralPath $font.path -PathType Leaf) -or
          (Get-FileHash -LiteralPath $font.path -Algorithm SHA256).Hash -ne $font.sha256 -or
          $registry.GetValue($font.name) -ne $font.path) { return $false }
    }
  } finally { $registry.Dispose() }
  return $true
}
function Get-WinixFontDownload($source) {
  $cache = Join-Path $env:LOCALAPPDATA 'Winix\cache\fonts'
  New-Item -ItemType Directory -Path $cache -Force | Out-Null
  $target = Join-Path $cache ($source.sha256 + '.' + $source.format)
  if (Test-Path -LiteralPath $target -PathType Leaf) {
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $source.sha256) { throw "Corrupt font cache: $target" }
    return $target
  }
  $temporary = Join-Path $cache ([guid]::NewGuid().ToString() + '.download')
  $client = [Net.Http.HttpClient]::new([Net.Http.HttpClientHandler]@{ AllowAutoRedirect = $false })
  $client.Timeout = [TimeSpan]::FromSeconds(60)
  try {
    $uri = [uri]$source.url
    for ($redirect = 0; $redirect -le 5; $redirect++) {
      if ($uri.Scheme -ne 'https' -or $uri.UserInfo) { throw 'Unsafe font download URL' }
      $response = $client.GetAsync($uri, [Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
      if ([int]$response.StatusCode -in @(301,302,303,307,308)) {
        try {
          if ($null -eq $response.Headers.Location) { throw 'Font redirect has no location' }
          $uri = [uri]::new($uri, $response.Headers.Location)
        } finally { $response.Dispose() }
        continue
      }
      try {
        $response.EnsureSuccessStatusCode() | Out-Null
        $inputStream = $response.Content.ReadAsStreamAsync().GetAwaiter().GetResult()
        $outputStream = [IO.File]::Open($temporary, [IO.FileMode]::CreateNew)
        try {
          $buffer = [byte[]]::new(65536)
          $total = 0L
          while (($count = $inputStream.Read($buffer, 0, $buffer.Length)) -gt 0) {
            $total += $count
            if ($total -gt 134217728) { throw 'Font download exceeds 128 MiB' }
            $outputStream.Write($buffer, 0, $count)
          }
        } finally { $outputStream.Dispose(); $inputStream.Dispose() }
      } finally { $response.Dispose() }
      if ((Get-FileHash -LiteralPath $temporary -Algorithm SHA256).Hash -ne $source.sha256) { throw 'Font checksum mismatch' }
      [IO.File]::Move($temporary, $target, $false)
      return $target
    }
    throw 'Too many font redirects'
  } finally {
    $client.Dispose()
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
function Expand-WinixFonts([string]$archive, [string]$destination, $selectors) {
  $zip = [IO.Compression.ZipFile]::OpenRead($archive)
  $result = [Collections.Generic.List[string]]::new()
  try {
    if ($zip.Entries.Count -gt 4096) { throw 'Font archive has too many entries' }
    $total = 0L
    foreach ($entry in $zip.Entries) {
      $name = $entry.FullName
      if ($name.StartsWith('/') -or $name.Contains('\') -or $name.Contains(':') -or
          $name.Contains([char]0) -or ($name.Split('/') -contains '..') -or ($name.Split('/') -contains '.') -or
          (($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw "Unsafe font ZIP entry: $name" }
      if (-not $entry.Name) { continue }
      $total += $entry.Length
      if ($total -gt 268435456) { throw 'Font archive exceeds 256 MiB expanded' }
      if ([IO.Path]::GetExtension($name) -notin @('.ttf','.otf')) { continue }
      $selected = $false
      foreach ($selector in $selectors) {
        if (($selector -eq '**/*.ttf' -and $name.EndsWith('.ttf', [StringComparison]::OrdinalIgnoreCase)) -or
            ($selector -eq '**/*.otf' -and $name.EndsWith('.otf', [StringComparison]::OrdinalIgnoreCase)) -or
            $selector -ceq $name) { $selected = $true }
      }
      if (-not $selected) { continue }
      $path = Join-Path $destination $entry.Name
      if (Test-Path -LiteralPath $path) { throw "Duplicate font filename: $($entry.Name)" }
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $path, $false)
      $result.Add($path)
    }
    if ($result.Count -eq 0) { throw 'Font archive contains no matching TTF/OTF files' }
    foreach ($selector in $selectors) {
      if (-not $selector.StartsWith('**/') -and -not @($zip.Entries | Where-Object { $_.FullName -ceq $selector }).Count) {
        throw "Font ZIP member does not exist: $selector"
      }
    }
    return $result.ToArray()
  } finally { $zip.Dispose() }
}
function Install-WinixFonts {
  $stageRoot = Join-Path $env:LOCALAPPDATA 'Winix\fonts'
  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null
  $stage = Join-Path $stageRoot ([guid]::NewGuid().ToString())
  New-Item -ItemType Directory -Path $stage | Out-Null
  $files = [Collections.Generic.List[string]]::new()
  $localSources = [Collections.Generic.List[object]]::new()
  try {
    foreach ($source in $plan) {
      if ($source.path) {
        $path = [Environment]::ExpandEnvironmentVariables($source.path)
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Font file does not exist: $path" }
        $files.Add($path)
        $localSources.Add(@{ path = $source.path; sha256 = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash })
      } else {
        $download = Get-WinixFontDownload $source
        if ($source.format -eq 'zip') {
          $directory = Join-Path $stage ([guid]::NewGuid().ToString())
          New-Item -ItemType Directory -Path $directory | Out-Null
          foreach ($path in @(Expand-WinixFonts $download $directory $source.files)) { $files.Add($path) }
        } else { $files.Add($download) }
      }
    }
    Add-Type -AssemblyName System.Drawing
    $destination = Join-Path $env:LOCALAPPDATA 'Microsoft\Windows\Fonts'
    $prepared = @{}
    $registry = Get-WinixFontRegistry
    try {
      foreach ($path in $files) {
        $name = [IO.Path]::GetFileName($path)
        $hash = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash
        $target = Join-Path $destination $name
        if ($prepared.ContainsKey($name)) {
          if ($prepared[$name].sha256 -ne $hash) { throw "Conflicting font filename: $name" }
          continue
        }
        if ((Test-Path -LiteralPath $target) -and
            ((Get-Item -LiteralPath $target).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw "Font target is a link: $target" }
        if ((Test-Path -LiteralPath $target) -and
            (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { throw "Font replacement refused: $target" }
        $registered = if ($null -ne $registry) { $registry.GetValue($name) } else { $null }
        if ($null -ne $registered -and $registered -ne $target) { throw "Font registry collision: $name" }
        $collection = [Drawing.Text.PrivateFontCollection]::new()
        try {
          $collection.AddFontFile($path)
          $families = @($collection.Families | ForEach-Object { $_.Name })
          if (-not $families.Count) { throw "Invalid font file: $path" }
        } finally { $collection.Dispose() }
        $prepared[$name] = @{ name = $name; path = $target; source = $path; sha256 = $hash; families = $families }
      }
    } finally { if ($null -ne $registry) { $registry.Dispose() } }
    if (-not ('WinixFontNative' -as [type])) {
      Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinixFontNative {
  [DllImport("gdi32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern int AddFontResourceEx(string path, uint flags, IntPtr reserved);
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern IntPtr SendMessageTimeout(IntPtr hwnd, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
}
'@
    }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null
    $registry = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Windows NT\CurrentVersion\Fonts')
    try {
      foreach ($font in $prepared.Values) {
        if (-not (Test-Path -LiteralPath $font.path)) { [IO.File]::Copy($font.source, $font.path, $false) }
        if ((Get-FileHash -LiteralPath $font.path -Algorithm SHA256).Hash -ne $font.sha256) { throw 'Font changed during installation' }
        $registered = $registry.GetValue($font.name)
        if ($null -ne $registered -and $registered -ne $font.path) { throw "Font registry changed during installation: $($font.name)" }
        if ($null -eq $registered) {
          if ([WinixFontNative]::AddFontResourceEx($font.path, 0, [IntPtr]::Zero) -eq 0) { throw "Windows rejected font: $($font.path)" }
          $registry.SetValue($font.name, $font.path, [Microsoft.Win32.RegistryValueKind]::String)
        }
        Write-Host ("Installed font families: " + ($font.families -join ', '))
      }
    } finally { $registry.Dispose() }
    $result = [IntPtr]::Zero
    if ([WinixFontNative]::SendMessageTimeout([IntPtr]0xffff, 0x001d, [IntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref]$result) -eq [IntPtr]::Zero) {
      Write-Warning 'Font change notification timed out; applications may need restarting.'
    }
    $record = @{ version = 1; fonts = @($prepared.Values | ForEach-Object { @{ name = $_.name; path = $_.path; sha256 = $_.sha256; families = $_.families } }); sources = @($localSources.ToArray()) }
    $pending = Join-Path $stage 'manifest.json'
    $record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $pending -Encoding utf8
    [IO.File]::Move($pending, $manifest, $true)
  } finally { Remove-Item -LiteralPath $stage -Recurse -Force }
}
`;
