#Requires -Version 5.1
<#
.SYNOPSIS
Checks/installs Winix prerequisites, or prepares a trusted repository and confirms host activation.
.PARAMETER Check
Only inspect prerequisites. No installation or configuration enablement is performed.
.PARAMETER Yes
Accept prerequisite installation and WinGet configuration enablement without prompting.
.PARAMETER UseNvm
Install/select Node LTS through NVM for Windows instead of standalone Node.js.
.PARAMETER Standalone
Check/install only native prerequisites for the Winix executable; Node.js/npm are not needed.
.PARAMETER Repository
Opt into HTTPS repository bootstrap. The checkout's exact SDK pin selects the executable.
.PARAMETER HostName
Declared Winix target for repository mode; does not rename Windows.
.PARAMETER PrepareOnly
Prepare prerequisites/runtime and validate/preview the repository without activating a host.
.PARAMETER DryRun
Describe repository bootstrap without downloads, installation, cloning or config evaluation.
#>
[CmdletBinding()]
param(
    [switch]$Check,
    [switch]$Yes,
    [switch]$UseNvm,
    [switch]$Standalone,
    [string]$Repository,
    [string]$Ref = 'main',
    [string]$Destination = (Join-Path $HOME 'dotfiles'),
    [string]$ConfigDirectory = 'winix',
    [string]$HostName,
    [switch]$PrepareOnly,
    [switch]$DryRun
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
        $ready = $null -ne $version -and $version -ge [version]$tool.Minimum
        if ($tool.Command -eq 'node.exe' -and $ready -and $version.Major -notin @(22, 24, 26)) { $ready = $false }
        [pscustomobject]@{
            Id = $tool.Id
            Command = $tool.Command
            Path = $path
            Version = $version
            Ready = $ready
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
        $nodeVersion = (Invoke-WinixBootstrapNative $node @('--version')) -join ''
        if ($nodeVersion -notmatch '^v?(22|24|26)\.') { throw 'Winix npm supports stable Node 22.13+, 24.x or 26.x.' }
        $nodeArgs = @(
            '--no-warnings', '--input-type=module', '--eval',
            "import { stripTypeScriptTypes } from 'node:module'; stripTypeScriptTypes('const x: number = 1');"
        )
        if ([int]$Matches[1] -lt 26) { $nodeArgs = @('--experimental-transform-types') + $nodeArgs }
        Invoke-WinixBootstrapNative $node $nodeArgs | Out-Null
    }
    $pwsh = Get-WinixBootstrapApplication 'pwsh.exe'
    $script = @'
$ErrorActionPreference = 'Stop'
Get-Command Find-PSResource, Install-PSResource -ErrorAction Stop | Out-Null
Get-Command Get-PSResourceRepository, Register-PSResourceRepository -ErrorAction Stop | Out-Null
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
    Write-Host 'OK: PSResourceGet and required DSC resources (repository selection belongs to the host config).'
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

function Assert-WinixBootstrapDirectory {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Unsafe bootstrap directory (not a directory or is a link): $current"
            }
        }
        $parent = Split-Path $current -Parent
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

function Get-WinixCheckoutVersion {
    param([string]$Directory)
    $package = Get-Content -LiteralPath (Join-Path $Directory 'package.json') -Raw | ConvertFrom-Json
    $spec = $package.dependencies.'@adrifer/winix'
    if (-not $spec) { $spec = $package.devDependencies.'@adrifer/winix' }
    if ($spec -isnot [string]) { throw 'Checkout must declare a string-valued exact @adrifer/winix dependency.' }
    if ($spec -match '^\d+\.\d+\.\d+(?:-preview\.\d+)?$') { return $spec }
    if ($spec -match '^https://github\.com/adrifer/winix/releases/download/v(\d+\.\d+\.\d+(?:-preview\.\d+)?)/adrifer-winix-\1\.tgz$') {
        return $Matches[1]
    }
    throw 'Checkout must pin an exact @adrifer/winix version or matching official GitHub release SDK URL.'
}

function Invoke-WinixBootstrapHost {
    param([string]$Binary, [string[]]$Arguments)
    & $Binary @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Winix bootstrap failed (exit $LASTEXITCODE). Resolve the error and rerun; no checkout reset/reboot is performed." }
}

function Get-WinixBootstrapSha256 {
    param([string]$Path)
    $stream = [IO.File]::OpenRead($Path)
    $algorithm = [Security.Cryptography.SHA256]::Create()
    try { return [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '') }
    finally { $algorithm.Dispose(); $stream.Dispose() }
}

function Save-WinixVerifiedDownload {
    param([string]$Url, [string]$ChecksumUrl, [string]$Asset, [string]$Destination)
    if (Test-Path -LiteralPath $Destination) {
        if ((Get-Item -LiteralPath $Destination -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
            throw "Refusing linked download destination: $Destination"
        }
    }
    $temporary = "$Destination.$([guid]::NewGuid().ToString('N')).download"
    try {
        $sums = (Invoke-WebRequest -UseBasicParsing -Uri $ChecksumUrl -TimeoutSec 90).Content
        if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
        $entries = @($sums -split '\r?\n' | Where-Object { $_ -match ('^[a-fA-F0-9]{64}\s+\*?' + [regex]::Escape($Asset) + '$') })
        if ($entries.Count -ne 1) { throw "Release checksum missing or duplicated for $Asset" }
        $expected = ($entries[0] -split '\s+')[0]
        if ((Test-Path -LiteralPath $Destination) -and (Get-WinixBootstrapSha256 $Destination) -eq $expected) {
            return
        }
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary -TimeoutSec 90
        if ((Get-WinixBootstrapSha256 $temporary) -ne $expected) {
            throw "Release checksum mismatch for $Asset; nothing was executed"
        }
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

function Invoke-WinixRepositoryBootstrap {
    param(
        [string]$Repository, [string]$Ref = 'main', [string]$Destination = (Join-Path $HOME 'dotfiles'), [string]$ConfigDirectory = 'winix',
        [string]$HostName, [switch]$Yes, [switch]$PrepareOnly, [switch]$DryRun
    )
    $ErrorActionPreference = 'Stop'
    $uri = $null
    if (-not [uri]::TryCreate($Repository, [UriKind]::Absolute, [ref]$uri) -or
        $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
        throw 'Repository must be HTTPS without credentials, query, or fragment.'
    }
    if (-not $HostName -or $HostName.StartsWith('-') -or $HostName -match '[\x00\r\n]') { throw '-HostName requires a declared host name, not a Windows rename.' }
    if (-not $Ref -or $Ref.StartsWith('-') -or $Ref -match '[\x00\r\n]') { throw 'Invalid repository ref.' }
    if ([IO.Path]::IsPathRooted($ConfigDirectory) -or $ConfigDirectory -match '(^|[\\/])\.\.([\\/]|$)' -or $ConfigDirectory -match '[:\x00\r\n]') {
        throw 'ConfigDirectory must be inside the checkout.'
    }
    $Destination = [IO.Path]::GetFullPath($Destination)
    Assert-WinixBootstrapDirectory $Destination
    $config = [IO.Path]::GetFullPath((Join-Path $Destination $ConfigDirectory))
    if ($DryRun) {
        Write-Host "Would ensure Git, clone/validate $Repository ($Ref) at $Destination, read its Winix pin, verify downloads, prepare prerequisites and preview host $HostName. No changes or config evaluation performed."
        return
    }
    Write-Host "Repository: $Repository ($Ref), checkout: $Destination, config: $config, host: $HostName"
    if (-not $Yes) {
        if ([Console]::IsInputRedirected) { throw 'Noninteractive repository bootstrap requires -Yes.' }
        if ((Read-Host 'Trust this repository and allow bootstrap downloads/prerequisite installation? [y/N]').Trim() -notmatch '^(?i:y|yes)$') {
            throw 'Bootstrap cancelled.'
        }
    }
    Update-WinixBootstrapPath
    $git = Get-WinixBootstrapApplication 'git.exe'
    if (-not $git) {
        $winget = Get-WinixBootstrapApplication 'winget.exe'
        if (-not $winget) { throw 'WinGet is unavailable. Install App Installer, open a new terminal, and rerun.' }
        Invoke-WinixBootstrapNative $winget @('install', '--id', 'Git.Git', '--exact', '--source', 'winget',
            '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity') | ForEach-Object { Write-Host $_ }
        Update-WinixBootstrapPath
        $git = Get-WinixBootstrapApplication 'git.exe'
        if (-not $git) { throw 'Git is not ready. Open a new terminal or restart if requested, then rerun the same bootstrap.' }
    }
    if (-not (Test-Path -LiteralPath $Destination)) {
        Invoke-WinixBootstrapNative $git @('clone', '--origin', 'origin', '--', $Repository, $Destination) | ForEach-Object { Write-Host $_ }
        # A normal clone retains history; branch selection never advances on a later bootstrap.
        if ($Ref -ne 'main' -or (Invoke-WinixBootstrapNative $git @('-C', $Destination, 'branch', '--show-current')) -ne 'main') {
            Invoke-WinixBootstrapNative $git @('-C', $Destination, 'checkout', $Ref) | ForEach-Object { Write-Host $_ }
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git') -PathType Container)) { throw 'Existing destination is not a regular Git checkout; refusing adoption.' }
    Assert-WinixBootstrapDirectory (Join-Path $Destination '.git')
    if (((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'remote', 'get-url', 'origin')) -join '').Trim() -ne $Repository) {
        throw 'Existing checkout has a different origin; refusing to change it.'
    }
    if ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'status', '--porcelain', '--untracked-files=normal'))) {
        throw 'Checkout has local changes. Commit/stash them explicitly; bootstrap never resets or cleans files.'
    }
    $head = ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'rev-parse', 'HEAD')) -join '').Trim()
    $wanted = ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'rev-parse', '--verify', "$Ref^{commit}")) -join '').Trim()
    if ($head -ne $wanted) { throw 'Existing checkout is not at the requested local ref; switch it explicitly. Bootstrap never pulls or resets.' }
    Assert-WinixBootstrapDirectory $config
    $version = Get-WinixCheckoutVersion $config
    $architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture.ToUpperInvariant()) {
        'AMD64' { $asset = 'winix-windows-x64.exe' }
        'ARM64' { $asset = 'winix-windows-arm64.exe' }
        default { throw "Unsupported Windows architecture: $architecture" }
    }
    $runtime = Join-Path $config ".winix\runtime\$version"
    Assert-WinixBootstrapDirectory $runtime
    New-Item -ItemType Directory -Path $runtime -Force | Out-Null
    $release = "https://github.com/adrifer/winix/releases/download/v$version"
    $binary = Join-Path $runtime 'winix.exe'
    Save-WinixVerifiedDownload "$release/$asset" "$release/SHA256SUMS" $asset $binary
    $prerequisites = Join-Path $runtime 'bootstrap-windows.ps1'
    Save-WinixVerifiedDownload "$release/bootstrap-windows.ps1" "$release/bootstrap-windows.ps1.sha256" 'bootstrap-windows.ps1' $prerequisites
    if (((Invoke-WinixBootstrapNative $binary @('--version')) -join '').Trim() -ne $version) { throw 'Downloaded executable version does not match the checkout.' }
    & $prerequisites -Standalone -Yes
    if (-not $?) { throw 'Prerequisites failed; resolve the error/reboot manually, then rerun the same bootstrap.' }
    $arguments = @('bootstrap', '--host', $HostName)
    if ($PrepareOnly) { $arguments += '--prepare-only' }
    if ($Yes) { $arguments += '--yes' }
    Push-Location -LiteralPath $config
    try { Invoke-WinixBootstrapHost $binary $arguments }
    finally { Pop-Location }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        if ($Repository) {
            if ($Check -or $UseNvm) { throw 'Repository mode cannot be combined with -Check or -UseNvm; it always uses standalone prerequisites.' }
            Invoke-WinixRepositoryBootstrap -Repository $Repository -Ref $Ref -Destination $Destination `
                -ConfigDirectory $ConfigDirectory -HostName $HostName -Yes:$Yes -PrepareOnly:$PrepareOnly -DryRun:$DryRun
        } elseif ($DryRun -or $PrepareOnly -or $HostName) {
            throw '-DryRun, -PrepareOnly and -HostName require -Repository. Use -Check for prerequisite-only inspection.'
        } else {
            Invoke-WinixWindowsBootstrap -Check:$Check -Yes:$Yes -UseNvm:$UseNvm -Standalone:$Standalone
        }
    } catch {
        Write-Error $_ -ErrorAction Continue
        exit 1
    }
}
