import type { WinDscProperties } from "../../types/windows.ts";
import type { InputSpiAction, NormalizedInput, NormalizedTime, RegistryDWordEntry } from "../../helpers/windows-settings.ts";
import { powerShellLiteral as quote } from "../../helpers/utils.ts";

const TZ_AUTO_UPDATE_KEY = "SYSTEM\\CurrentControlSet\\Services\\tzautoupdate";

export function timeProperties(time: NormalizedTime): WinDscProperties {
  const autoStart = time.automaticZone === undefined ? undefined : (time.automaticZone ? 3 : 4);
  const autoTest = autoStart === undefined ? "" : `
  $tzKey = [Microsoft.Win32.Registry]::LocalMachine.OpenSubKey(${quote(TZ_AUTO_UPDATE_KEY)})
  if ($null -eq $tzKey) { return $false }
  try {
    if ($tzKey.GetValueNames() -notcontains 'Start' -or
        $tzKey.GetValueKind('Start') -ne [Microsoft.Win32.RegistryValueKind]::DWord -or
        ([long]$tzKey.GetValue('Start') -band 0xffffffffL) -ne ${autoStart}) { return $false }
  } finally { $tzKey.Dispose() }`;
  const zoneTest = time.zone === undefined ? "" : `
  if ((Get-TimeZone).Id -cne ${quote(time.zone)}) { return $false }`;
  const autoSet = autoStart === undefined ? "" : `
$tzKey = [Microsoft.Win32.Registry]::LocalMachine.CreateSubKey(${quote(TZ_AUTO_UPDATE_KEY)})
try {
  $tzKey.SetValue('Start', ${autoStart}, [Microsoft.Win32.RegistryValueKind]::DWord)
} finally { $tzKey.Dispose() }`;
  const zoneSet = time.zone === undefined ? "" : `
$desiredZone = ${quote(time.zone)}
if ((Get-TimeZone).Id -cne $desiredZone) {
  $available = @(Get-TimeZone -ListAvailable | ForEach-Object { $_.Id })
  if ($available -cnotcontains $desiredZone) {
    throw "Invalid Windows time zone ID: $desiredZone"
  }
  Set-TimeZone -Id $desiredZone
}`;
  const prelude = `
$ErrorActionPreference = 'Stop'
function Test-WinixTime {${autoTest}${zoneTest}
  return $true
}`;
  return {
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixTime) }`,
    testScript: `${prelude}\nTest-WinixTime`,
    setScript: `${prelude}
if (Test-WinixTime) { return }${autoSet}${zoneSet}
if (-not (Test-WinixTime)) { throw 'Windows time settings verification failed' }`,
  };
}

export function dwordRegistryProperties(
  hive: "LocalMachine" | "CurrentUser",
  entries: RegistryDWordEntry[],
  failureMessage: string,
): WinDscProperties {
  const prelude = `
$ErrorActionPreference = 'Stop'
$values = @(ConvertFrom-Json ${quote(JSON.stringify(entries))})
function Test-WinixRegistryDWords {
  foreach ($item in $values) {
    $key = [Microsoft.Win32.Registry]::${hive}.OpenSubKey($item.path)
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
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixRegistryDWords) }`,
    testScript: `${prelude}\nTest-WinixRegistryDWords`,
    setScript: `${prelude}
if (Test-WinixRegistryDWords) { return }
foreach ($item in $values) {
  $key = [Microsoft.Win32.Registry]::${hive}.CreateSubKey($item.path)
  try {
    $signed = [BitConverter]::ToInt32([BitConverter]::GetBytes([uint32]$item.value), 0)
    $key.SetValue($item.name, $signed, [Microsoft.Win32.RegistryValueKind]::DWord)
  } finally { $key.Dispose() }
}
if (-not (Test-WinixRegistryDWords)) { throw ${quote(failureMessage)} }`,
  };
}

function spiCall(action: InputSpiAction): string {
  switch (action.kind) {
    case "keyboardDelay":
      return `Invoke-WinixSpi ([WinixInputNative]::SystemParametersInfo(0x0017, ${action.value}, [IntPtr]::Zero, 3)) 'keyboard repeatDelay'`;
    case "keyboardSpeed":
      return `Invoke-WinixSpi ([WinixInputNative]::SystemParametersInfo(0x000B, ${action.value}, [IntPtr]::Zero, 3)) 'keyboard repeatSpeed'`;
    case "mouseSpeed":
      return `Invoke-WinixSpi ([WinixInputNative]::SystemParametersInfo(0x0071, 0, [IntPtr]${action.value}, 3)) 'mouse speed'`;
    case "mouseAcceleration": {
      const tuple = action.enabled ? "6, 10, 1" : "0, 0, 0";
      return `Invoke-WinixSpi ([WinixInputNative]::SystemParametersInfoMouse(0x0004, 0, [int[]]@(${tuple}), 3)) 'mouse enhancePointerPrecision'`;
    }
    case "mouseSwapButtons":
      return `Invoke-WinixSpi ([WinixInputNative]::SystemParametersInfo(0x0021, ${action.enabled ? 1 : 0}, [IntPtr]::Zero, 3)) 'mouse swapButtons'`;
  }
}

export function inputProperties(input: NormalizedInput): WinDscProperties {
  const prelude = `
$ErrorActionPreference = 'Stop'
$checks = @(ConvertFrom-Json ${quote(JSON.stringify(input.checks))})
function Test-WinixInput {
  foreach ($item in $checks) {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($item.path)
    if ($null -eq $key) { return $false }
    try {
      if ($key.GetValueNames() -notcontains $item.name -or
          $key.GetValueKind($item.name) -ne [Microsoft.Win32.RegistryValueKind]::String -or
          [string]$key.GetValue($item.name) -cne [string]$item.value) { return $false }
    } finally { $key.Dispose() }
  }
  return $true
}`;
  return {
    getScript: `${prelude}\n@{ InDesiredState = (Test-WinixInput) }`,
    testScript: `${prelude}\nTest-WinixInput`,
    setScript: `${prelude}
if (Test-WinixInput) { return }
if (-not ('WinixInputNative' -as [type])) {
  Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class WinixInputNative {
  [DllImport("user32.dll", SetLastError = true)]
  public static extern bool SystemParametersInfo(uint uiAction, uint uiParam, IntPtr pvParam, uint fWinIni);
  [DllImport("user32.dll", EntryPoint = "SystemParametersInfo", SetLastError = true)]
  public static extern bool SystemParametersInfoMouse(uint uiAction, uint uiParam, [In] int[] pvParam, uint fWinIni);
}
'@
}
function Invoke-WinixSpi([bool]$Ok, [string]$Label) {
  if (-not $Ok) {
    $err = [System.ComponentModel.Win32Exception]::new([Runtime.InteropServices.Marshal]::GetLastWin32Error())
    throw "Failed to apply \${Label}: $($err.Message)"
  }
}
${input.actions.map(spiCall).join("\n")}
if (-not (Test-WinixInput)) { throw 'Windows input settings verification failed' }`,
  };
}
