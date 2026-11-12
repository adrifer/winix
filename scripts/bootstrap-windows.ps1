#Requires -Version 5.1
<#
.SYNOPSIS
Checks or installs the Windows prerequisites for Winix, without activating a host.
.PARAMETER Check
Only inspect prerequisites. No installation or configuration enablement is performed.
.PARAMETER Yes
Accept prerequisite installation and WinGet configuration enablement without prompting.
.PARAMETER UseNvm
Install/select Node LTS through NVM for Windows instead of standalone Node.js.
.PARAMETER Standalone
Check/install only native prerequisites for the Winix executable; Node.js/npm are not needed.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Yes,
    [switch]$UseNvm,
    [switch]$Standalone
)

function Get-WinixBootstrapApplication {
    param([string]$Name)
    $application = Get-Command $Name -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($application) { return $application.Source }
    return $null
}

function Invoke-WinixBootstrapNative {
    param([string]$FilePath, [string[]]$Arguments)
    $output = @(& $FilePath @Arguments)
    $code = $LASTEXITCODE
    if ($code -ne 0) {
        if ($code -eq 3010 -or $code -eq 1641) {
            throw 'An installer requires a restart. Restart Windows yourself, then rerun the bootstrap.'
        }
        throw ("Command failed ({0}, exit {1}): {2}`n{3}" -f $FilePath, $code, ($Arguments -join ' '), ($output -join "`n"))
    }
    return $output
}

function Update-WinixBootstrapPath {
    foreach ($name in @('NVM_HOME', 'NVM_SYMLINK')) {
        $value = [Environment]::GetEnvironmentVariable($name, 'User')
        if (-not $value) { $value = [Environment]::GetEnvironmentVariable($name, 'Machine') }
        if ($value) { [Environment]::SetEnvironmentVariable($name, $value, 'Process') }
    }
    $paths = @(
        $env:Path
        [Environment]::GetEnvironmentVariable('Path', 'Machine')
        [Environment]::GetEnvironmentVariable('Path', 'User')
        (Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'Microsoft\WindowsApps')
    )
    $env:Path = (($paths -join ';').Split(';') |
        Where-Object { $_ } |
        ForEach-Object { [Environment]::ExpandEnvironmentVariables($_.Trim().Trim('"')) } |
        Select-Object -Unique) -join ';'
}

function Get-WinixBootstrapTools {
    param([switch]$Standalone)
    $tools = @(
        @{ Id = 'Git.Git'; Command = 'git.exe'; Minimum = '2.0.0' }
        @{ Id = 'OpenJS.NodeJS.LTS'; Command = 'node.exe'; Minimum = '22.13.0' }
        @{ Id = 'Microsoft.PowerShell'; Command = 'pwsh.exe'; Minimum = '7.4.0' }
        @{ Id = 'Microsoft.DSC'; Command = 'dsc.exe'; Minimum = '3.2.0' }
    )
    foreach ($tool in $tools) {
        if ($Standalone -and $tool.Command -eq 'node.exe') { continue }
        $path = Get-WinixBootstrapApplication $tool.Command
        $version = $null
        if ($path) {
            $text = (Invoke-WinixBootstrapNative $path @('--version')) -join "`n"
            if ($text -notmatch '(\d+\.\d+\.\d+)') {
                throw "Cannot parse $($tool.Command) version: $text"
            }
            $version = [version]$Matches[1]
            if ($text -match '(?i)-(preview|rc|alpha|beta)') {
                throw "Prerelease $($tool.Command) is not supported by this bootstrap. Install a stable release."
            }
        }
        [pscustomobject]@{
            Id = $tool.Id
            Command = $tool.Command
            Path = $path
            Version = $version
            Ready = $null -ne $version -and $version -ge [version]$tool.Minimum
            Minimum = $tool.Minimum
        }
    }
}

function Test-WinixBootstrapCapabilities {
    param([string]$WinGet, [switch]$Standalone)
    $help = (Invoke-WinixBootstrapNative $WinGet @('configure', '--help')) -join "`n"
    if ($help -notmatch '--enable\b') {
        throw 'Update App Installer from Microsoft Store: this WinGet lacks configuration enablement support.'
    }
    if (-not $Standalone) {
        $npm = Get-WinixBootstrapApplication 'npm.cmd'
        if (-not $npm) { throw 'npm.cmd is unavailable. Repair the Node.js installation or open a new terminal, then rerun.' }
        Invoke-WinixBootstrapNative $npm @('--version') | Out-Null
        $node = Get-WinixBootstrapApplication 'node.exe'
        Invoke-WinixBootstrapNative $node @(
            '--experimental-transform-types', '--no-warnings', '--input-type=module', '--eval',
            "import { stripTypeScriptTypes } from 'node:module'; stripTypeScriptTypes('const x: number = 1');"
        ) | Out-Null
    }
    $pwsh = Get-WinixBootstrapApplication 'pwsh.exe'
    $script = @'
$ErrorActionPreference = 'Stop'
Get-Command Find-PSResource, Install-PSResource -ErrorAction Stop | Out-Null
Get-PSResourceRepository -Name PSGallery -ErrorAction Stop | Out-Null
'@
    $encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($script))
    Invoke-WinixBootstrapNative $pwsh @('-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', $encoded) | Out-Null
    $dsc = Get-WinixBootstrapApplication 'dsc.exe'
    foreach ($name in @(
        'Microsoft.WinGet/Package',
        'Microsoft.DSC.Transitional/PowerShellScript',
        'Microsoft.DSC.Transitional/RunCommandOnSet',
        'Microsoft.Windows/Registry'
    )) {
        $lines = @(Invoke-WinixBootstrapNative $dsc @('resource', 'list', $name, '--output-format', 'json'))
        $found = @($lines | Where-Object { $_.Trim() } | ForEach-Object { $_ | ConvertFrom-Json })
        if ($found.Count -ne 1 -or $found[0].type -ne $name) {
            throw "Required DSC resource is unavailable: $name. Update App Installer/DSC, open a new terminal, and rerun."
        }
    }
    if (-not $Standalone) { Write-Host 'OK: npm and Node TypeScript support.' }
    Write-Host 'OK: PSResourceGet/PSGallery and required DSC resources.'
}

function Invoke-WinixWindowsBootstrap {
    param([switch]$Check, [switch]$Yes, [switch]$UseNvm, [switch]$Standalone)
    $ErrorActionPreference = 'Stop'
    if ($Standalone -and $UseNvm) { throw '-Standalone and -UseNvm cannot be combined.' }
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This bootstrap is for native Windows, not WSL. Run it from Windows PowerShell or PowerShell 7.'
    }
    Update-WinixBootstrapPath
    $winget = Get-WinixBootstrapApplication 'winget.exe'
    if (-not $winget) {
        throw @'
WinGet is unavailable. Install/update App Installer from https://apps.microsoft.com/detail/9nblggh4nns1 and open a new terminal.
If App Installer is already installed but not registered after first sign-in, run:
Add-AppxPackage -RegisterByFamilyName -MainPackage Microsoft.DesktopAppInstaller_8wekyb3d8bbwe
Then rerun this bootstrap. No prerequisites have been installed.
'@
    }
    Write-Host ("WinGet: " + ((Invoke-WinixBootstrapNative $winget @('--version')) -join ' '))
    $tools = @(Get-WinixBootstrapTools -Standalone:$Standalone)
    foreach ($tool in $tools) {
        $installed = if ($tool.Version) { $tool.Version.ToString() } else { 'missing' }
        $status = if ($tool.Ready) { 'OK' } else { 'NEEDED' }
        Write-Host ("{0}: {1} {2} (minimum {3})" -f $status, $tool.Command, $installed, $tool.Minimum)
    }
    $pending = @($tools | Where-Object { -not $_.Ready })
    if ($Check) {
        if ($pending.Count -gt 0) {
            throw 'Prerequisites are missing or too old. Rerun without -Check to install/upgrade the listed packages.'
        }
    } else {
        $node = $pending | Where-Object { $_.Command -eq 'node.exe' }
        $nvm = Get-WinixBootstrapApplication 'nvm.exe'
        if ($node -and $nvm -and -not $UseNvm) {
            throw 'NVM for Windows is already installed. Rerun with -UseNvm; standalone Node would conflict with its symlink.'
        }
        if ($node -and $UseNvm -and $node.Path -and -not $nvm) {
            throw 'Existing Node.js needs upgrading but NVM is absent. Repair/upgrade the existing Node installation or deliberately remove it before choosing -UseNvm.'
        }
        Write-Host 'This will install/upgrade only NEEDED packages and enable WinGet configuration support (requires Store access).'
        if ($node -and $UseNvm) {
            Write-Host 'Node.js will use CoreyButler.NVMforWindows plus nvm install lts / nvm use lts; selecting Node may require elevation.'
        }
        Write-Host 'Installers may request UAC elevation. No host configuration, WSL setup, or reboot is performed.'
        if (-not $Yes) {
            if ([Console]::IsInputRedirected) { throw 'Noninteractive bootstrap requires -Yes; use -Check for inspection only.' }
            $answer = Read-Host 'Continue with bootstrap? [y/N]'
            if ($answer.Trim() -notmatch '^(?i:y|yes)$') { throw 'Bootstrap cancelled. No installation or enablement was performed.' }
        }
        foreach ($tool in $pending) {
            if ($tool.Command -eq 'node.exe' -and $UseNvm) {
                if (-not $nvm) {
                    Invoke-WinixBootstrapNative $winget @(
                        'install', '--id', 'CoreyButler.NVMforWindows', '--exact', '--source', 'winget',
                        '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
                    ) | ForEach-Object { Write-Host $_ }
                    Update-WinixBootstrapPath
                    $nvm = Get-WinixBootstrapApplication 'nvm.exe'
                    if (-not $nvm) { throw 'NVM is not on PATH yet. Open a new terminal and rerun with -UseNvm.' }
                }
                Invoke-WinixBootstrapNative $nvm @('install', 'lts') | ForEach-Object { Write-Host $_ }
                Invoke-WinixBootstrapNative $nvm @('use', 'lts') | ForEach-Object { Write-Host $_ }
            } else {
                $operation = if ($tool.Path) { 'upgrade' } else { 'install' }
                Write-Host "$operation $($tool.Id)"
                Invoke-WinixBootstrapNative $winget @(
                    $operation, '--id', $tool.Id, '--exact', '--source', 'winget',
                    '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
                ) | ForEach-Object { Write-Host $_ }
            }
            Update-WinixBootstrapPath
            $updated = @(Get-WinixBootstrapTools -Standalone:$Standalone | Where-Object { $_.Id -eq $tool.Id })
            if ($updated.Count -ne 1 -or -not $updated[0].Ready) {
                throw "Installation did not make $($tool.Command) ready. Open a new terminal or restart if requested, then rerun."
            }
        }
        Invoke-WinixBootstrapNative $winget @('configure', '--enable') |
            ForEach-Object { Write-Host $_ }
        Update-WinixBootstrapPath
    }
    Test-WinixBootstrapCapabilities $winget -Standalone:$Standalone
    Write-Host 'Prerequisite checks passed. No Winix host was activated.'
    Write-Host 'Open a new PowerShell 7 terminal before preparing the Winix/config checkout and running winix check or switch --dry.'
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Invoke-WinixWindowsBootstrap -Check:$Check -Yes:$Yes -UseNvm:$UseNvm -Standalone:$Standalone
    } catch {
        Write-Error $_ -ErrorAction Continue
        exit 1
    }
}
