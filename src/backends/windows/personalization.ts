import type { WinDscProperties, WinWallpaper } from "../../types/windows.ts";
import type { PersonalizationRegistryValue } from "../../helpers/windows-settings.ts";
import { powerShellLiteral as quote } from "../../helpers/utils.ts";
import { filePathExpression, filePathPrelude, resolveWindowsSource } from "../../helpers/windows.ts";
import { windowsSourcePath } from "./paths.ts";

const CLASSIC_CONTEXT_MENU_KEY = "Software\\Classes\\CLSID\\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}";
const CLASSIC_CONTEXT_MENU_SUBKEY = `${CLASSIC_CONTEXT_MENU_KEY}\\InprocServer32`;

export function personalizationProperties(
  values: PersonalizationRegistryValue[],
  extras: { autoHide?: boolean; classicContextMenu?: boolean } = {},
): WinDscProperties {
  const { autoHide, classicContextMenu } = extras;
  const appBar = autoHide === undefined ? "" : `
if (-not ('WinixAppBarNative' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinixAppBarNative {
  [StructLayout(LayoutKind.Sequential)]
  public struct Data { public uint size; public IntPtr hwnd; public uint message; public uint edge;
    public int left; public int top; public int right; public int bottom; public IntPtr param; }
  [DllImport("shell32.dll")] public static extern UIntPtr SHAppBarMessage(uint message, ref Data data);
}
'@
}
$appBar = [WinixAppBarNative+Data]::new()
$appBar.size = [Runtime.InteropServices.Marshal]::SizeOf($appBar)
`;
  const classicMenuTest = classicContextMenu === undefined ? "" : classicContextMenu ? `
  $ctxKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quote(CLASSIC_CONTEXT_MENU_SUBKEY)})
  if ($null -eq $ctxKey) { return $false }
  try {
    if ($ctxKey.GetValueNames() -notcontains '' -or
        $ctxKey.GetValueKind('') -ne [Microsoft.Win32.RegistryValueKind]::String -or
        $ctxKey.GetValue('') -ne '') { return $false }
  } finally { $ctxKey.Dispose() }` : `
  $ctxKey = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey(${quote(CLASSIC_CONTEXT_MENU_KEY)})
  if ($null -ne $ctxKey) { $ctxKey.Dispose(); return $false }`;
  const classicMenuSet = classicContextMenu === undefined ? "" : classicContextMenu ? `
$ctxKey = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey(${quote(CLASSIC_CONTEXT_MENU_SUBKEY)})
try { $ctxKey.SetValue('', '', [Microsoft.Win32.RegistryValueKind]::String) } finally { $ctxKey.Dispose() }` : `
[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree(${quote(CLASSIC_CONTEXT_MENU_KEY)}, $false)`;
  const prelude = `
$ErrorActionPreference = 'Stop'
$values = ConvertFrom-Json ${quote(JSON.stringify(values))}
${appBar}
function Test-WinixPersonalization {
  ${autoHide === undefined ? "" : `if ((([WinixAppBarNative]::SHAppBarMessage(4, [ref]$appBar).ToUInt64() -band 1) -ne 0) -ne $${autoHide}) { return $false }`}${classicMenuTest}
  foreach ($item in $values) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($item.path)
    if ($null -eq $key) { return $false }
    try {
      if ($key.GetValueNames() -notcontains $item.name -or
          $key.GetValueKind($item.name) -ne [Microsoft.Win32.RegistryValueKind]::DWord -or
          ([long]$key.GetValue($item.name) -band 0xffffffffL) -ne [long]$item.value) { return $false }
    } finally { $key.Dispose() }
  }
  return $true
}`;
  return {
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixPersonalization) }`,
    testScript: `${prelude}\nTest-WinixPersonalization`,
    setScript: `${prelude}
if (Test-WinixPersonalization) { return }
${autoHide === undefined ? "" : `
$state = [WinixAppBarNative]::SHAppBarMessage(4, [ref]$appBar).ToUInt64()
$appBar.param = [IntPtr](($state -band 2) -bor ${autoHide ? 1 : 0})
[WinixAppBarNative]::SHAppBarMessage(10, [ref]$appBar) | Out-Null
`}${classicMenuSet}
foreach ($item in $values) {
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($item.path)
  try {
    $signed = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$item.value), 0)
    $key.SetValue($item.name, $signed, [Microsoft.Win32.RegistryValueKind]::DWord)
  } finally { $key.Dispose() }
}
if (-not (Test-WinixPersonalization)) { throw 'Windows personalization verification failed' }
Write-Warning 'Some Explorer/taskbar/theme preferences take effect after signing out. Winix will not restart Explorer.'`,
  };
}

export function wallpaperProperties(wallpaper: WinWallpaper, configDir?: string): WinDscProperties {
  const source = typeof wallpaper.source === "string"
    ? resolveWindowsSource(wallpaper.source, configDir, windowsSourcePath) : wallpaper.source;
  const styles = { Fill: [10, 0], Fit: [6, 0], Stretch: [2, 0], Tile: [0, 1], Center: [0, 0], Span: [22, 0] };
  const [style, tile] = styles[wallpaper.style ?? "Fill"];
  const prelude = `${filePathPrelude().join("\n")}
$ErrorActionPreference = 'Stop'
$source = ${filePathExpression(source)}
if (-not (Test-Path -LiteralPath $source -PathType Leaf)) { throw "Wallpaper image does not exist: $source" }
$hash = (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash
$cache = Join-Path $env:LOCALAPPDATA 'Winix\\wallpapers'
$target = Join-Path $cache ($hash + [IO.Path]::GetExtension($source))
$desktop = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Control Panel\\Desktop')
function Test-WinixWallpaper {
  if ($null -eq $desktop) { return $false }
  $image = [string]$desktop.GetValue('WallPaper', '')
  return (Test-Path -LiteralPath $target -PathType Leaf) -and
    (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -eq $hash -and
    $image -eq $target -and
    [string]$desktop.GetValue('WallpaperStyle', '') -eq '${style}' -and
    [string]$desktop.GetValue('TileWallpaper', '') -eq '${tile}'
}`;
  const dispose = "if ($null -ne $desktop) { $desktop.Dispose() }";
  return {
    getScript: `${prelude}\ntry { @{ InDesiredState = (Test-WinixWallpaper) } } finally { ${dispose} }`,
    testScript: `${prelude}\ntry { Test-WinixWallpaper } finally { ${dispose} }`,
    setScript: `${prelude}
try { $matches = Test-WinixWallpaper } finally { ${dispose} }
if ($matches) { return }
Add-Type -AssemblyName System.Drawing
$image = [System.Drawing.Image]::FromFile($source)
try {
  if ($image.Width -lt 1 -or $image.Height -lt 1) { throw 'Invalid wallpaper image' }
} finally { $image.Dispose() }
New-Item -ItemType Directory -Path $cache -Force | Out-Null
if (-not (Test-Path -LiteralPath $target)) { [IO.File]::Copy($source, $target, $false) }
if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash -ne $hash) { throw 'Wallpaper changed or its cache is corrupt' }
if (-not ('WinixWallpaperNative' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinixWallpaperNative {
  [DllImport("user32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern bool SystemParametersInfo(uint action, uint param, string value, uint flags);
}
'@
}
$key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Control Panel\\Desktop')
try {
  $previousStyle = $key.GetValue('WallpaperStyle', $null)
  $previousTile = $key.GetValue('TileWallpaper', $null)
  $key.SetValue('WallpaperStyle', '${style}', [Microsoft.Win32.RegistryValueKind]::String)
  $key.SetValue('TileWallpaper', '${tile}', [Microsoft.Win32.RegistryValueKind]::String)
} finally { $key.Dispose() }
if (-not [WinixWallpaperNative]::SystemParametersInfo(20, 0, $target, 3)) {
  $failure = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
  $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Control Panel\\Desktop')
  try {
    if ($null -eq $previousStyle) { $key.DeleteValue('WallpaperStyle', $false) }
    else { $key.SetValue('WallpaperStyle', $previousStyle, [Microsoft.Win32.RegistryValueKind]::String) }
    if ($null -eq $previousTile) { $key.DeleteValue('TileWallpaper', $false) }
    else { $key.SetValue('TileWallpaper', $previousTile, [Microsoft.Win32.RegistryValueKind]::String) }
  } finally { $key.Dispose() }
  throw $failure
}`,
  };
}
