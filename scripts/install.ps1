#Requires -Version 5.1
<#
.SYNOPSIS
Installs Winix for this user, or sets this PC up from a Winix repository.
.DESCRIPTION
Without -Repository: installs Git, PowerShell 7 and DSC when missing, then the
latest Winix (or -Version) and a winix command on your PATH. Then run
winix init in a new folder.

With -Repository: also clones it, downloads the Winix version it pins, and
applies the host you choose (or -HostName). A repository without a Winix config
yet gets the latest Winix; run winix init in it.

It asks once, before changing anything.
.PARAMETER Repository
HTTPS URL of a repository with a Winix config.
.PARAMETER Ref
Branch, tag or commit to check out (default: main).
.PARAMETER Destination
Where to clone the repository (default: ~\dotfiles).
.PARAMETER ConfigDirectory
The folder of winix.config.ts inside the repository (default: the root if it holds winix.config.ts, else winix).
.PARAMETER HostName
The declared host this PC is (repository only). Without it, Winix asks and remembers.
.PARAMETER Version
The Winix version to install when no repository pins one (default: the latest release).
.PARAMETER PrepareOnly
With -Repository: prepare and show the plan, without applying it.
.PARAMETER DryRun
Only describe what would happen.
.PARAMETER Yes
Don't ask for confirmation.
#>
[CmdletBinding()]
param(
    [string]$Repository,
    [string]$Ref = 'main',
    [string]$Destination = (Join-Path $HOME 'dotfiles'),
    [string]$ConfigDirectory,
    [string]$HostName,
    [string]$Version,
    [switch]$PrepareOnly,
    [switch]$DryRun,
    [switch]$Yes
)

$WinixReleases = 'https://github.com/adrifer/winix/releases'
$WinixVersionPattern = '^\d+\.\d+\.\d+(?:-preview\.\d+)?$'

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
            throw 'An installer requires a restart. Restart Windows yourself, then rerun this script.'
        }
        throw ("Command failed ({0}, exit {1}): {2}`n{3}" -f $FilePath, $code, ($Arguments -join ' '), ($output -join "`n"))
    }
    return $output
}

function Update-WinixBootstrapPath {
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

# What a Windows host needs: Git for repositories, PowerShell 7 and DSC to apply resources.
function Get-WinixBootstrapTools {
    $tools = @(
        @{ Id = 'Git.Git'; Command = 'git.exe'; Minimum = '2.0.0' }
        @{ Id = 'Microsoft.PowerShell'; Command = 'pwsh.exe'; Minimum = '7.4.0' }
        @{ Id = 'Microsoft.DSC'; Command = 'dsc.exe'; Minimum = '3.2.0' }
    )
    foreach ($tool in $tools) {
        $path = Get-WinixBootstrapApplication $tool.Command
        $version = $null
        if ($path) {
            $text = (Invoke-WinixBootstrapNative $path @('--version')) -join "`n"
            if ($text -notmatch '(\d+\.\d+\.\d+)') { throw "Cannot parse $($tool.Command) version: $text" }
            $version = [version]$Matches[1]
            if ($text -match '(?i)-(preview|rc|alpha|beta)') {
                throw "Prerelease $($tool.Command) is not supported. Install a stable release."
            }
        }
        [pscustomobject]@{
            Id = $tool.Id; Command = $tool.Command; Path = $path; Version = $version
            Ready = $null -ne $version -and $version -ge [version]$tool.Minimum; Minimum = $tool.Minimum
        }
    }
}

function Initialize-WinixBootstrapWinGet {
    param([switch]$Yes)
    if (Get-WinixBootstrapApplication 'winget.exe') { return }
    # A new account often has App Installer (winget) installed but not yet
    # registered for it; registering takes seconds and needs no Store.
    try {
        Add-AppxPackage -RegisterByFamilyName -MainPackage 'Microsoft.DesktopAppInstaller_8wekyb3d8bbwe' -ErrorAction Stop
        Update-WinixBootstrapPath
        if (Get-WinixBootstrapApplication 'winget.exe') { return }
    } catch { }
    if ($Yes -or [Console]::IsInputRedirected) {
        throw 'WinGet is unavailable. Install or update App Installer (Microsoft Store, 9NBLGGH4NNS1), open a new terminal, and rerun.'
    }
    Write-Host 'WinGet is missing. Opening App Installer in Microsoft Store; install or update it.'
    Write-Host 'Without Store access, see https://learn.microsoft.com/windows/package-manager/winget/#install-winget.'
    Start-Process -FilePath 'ms-windows-store://pdp/?ProductId=9NBLGGH4NNS1'
    [void](Read-Host 'Press Enter when App Installer is installed (Ctrl+C to cancel)')
    Update-WinixBootstrapPath
    if (-not (Get-WinixBootstrapApplication 'winget.exe')) {
        throw 'WinGet is still unavailable. Finish installing App Installer, open a new terminal, and rerun.'
    }
}

# Installs or upgrades whatever Get-WinixBootstrapTools reports as not ready.
function Install-WinixPrerequisites {
    param([switch]$Yes)
    Initialize-WinixBootstrapWinGet -Yes:$Yes
    $winget = Get-WinixBootstrapApplication 'winget.exe'
    foreach ($tool in @(Get-WinixBootstrapTools | Where-Object { -not $_.Ready })) {
        $operation = if ($tool.Path) { 'upgrade' } else { 'install' }
        Write-Host "$operation $($tool.Id)"
        Invoke-WinixBootstrapNative $winget @(
            $operation, '--id', $tool.Id, '--exact', '--source', 'winget',
            '--silent', '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
        ) | ForEach-Object { Write-Host $_ }
        Update-WinixBootstrapPath
        $updated = @(Get-WinixBootstrapTools | Where-Object { $_.Id -eq $tool.Id })
        if ($updated.Count -ne 1 -or -not $updated[0].Ready) {
            throw "Installing $($tool.Id) did not make $($tool.Command) ready. Open a new terminal or restart if asked, then rerun."
        }
    }
}

# PowerShell 7 needs PSResourceGet (modules), DSC the resources Winix applies with.
function Test-WinixCapabilities {
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
}

function Assert-WinixBootstrapDirectory {
    param([string]$Path)
    $current = [IO.Path]::GetFullPath($Path)
    while ($current) {
        if (Test-Path -LiteralPath $current) {
            $item = Get-Item -LiteralPath $current -Force
            if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
                throw "Unsafe directory (not a directory, or a link): $current"
            }
        }
        $parent = Split-Path $current -Parent
        if ($parent -eq $current) { break }
        $current = $parent
    }
}

# The version a config pins, or $null when the folder has no Winix config yet.
function Get-WinixCheckoutVersion {
    param([string]$Directory)
    $file = Join-Path $Directory 'package.json'
    if (-not (Test-Path -LiteralPath (Join-Path $Directory 'winix.config.ts')) -or -not (Test-Path -LiteralPath $file)) { return $null }
    $package = Get-Content -LiteralPath $file -Raw | ConvertFrom-Json
    $spec = $package.dependencies.'@adrifer/winix'
    if (-not $spec) { $spec = $package.devDependencies.'@adrifer/winix' }
    if ($spec -isnot [string]) { throw "$file must pin an exact @adrifer/winix version." }
    if ($spec -match $WinixVersionPattern) { return $spec }
    if ($spec -match '^https://github\.com/adrifer/winix/releases/download/v(\d+\.\d+\.\d+(?:-preview\.\d+)?)/adrifer-winix-\1\.tgz$') {
        return $Matches[1]
    }
    throw "$file must pin an exact @adrifer/winix version or its official GitHub release tarball."
}

function Get-WinixLatestVersion {
    $release = Invoke-RestMethod -UseBasicParsing -Uri 'https://api.github.com/repos/adrifer/winix/releases/latest' -TimeoutSec 60
    $tag = ([string]$release.tag_name).TrimStart('v')
    if ($tag -notmatch $WinixVersionPattern) { throw "Unexpected latest Winix release: $($release.tag_name)" }
    return $tag
}

function Invoke-WinixExecutable {
    param([string]$Binary, [string[]]$Arguments)
    & $Binary @Arguments
    if ($LASTEXITCODE -ne 0) { throw "winix $($Arguments[0]) failed (exit $LASTEXITCODE). Fix the error above and rerun; nothing is reset." }
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
    # Windows PowerShell's download progress block covers the console and slows large downloads.
    $ProgressPreference = 'SilentlyContinue'
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
        Write-Host "Downloading $Asset (checksum-verified)..."
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary -TimeoutSec 90
        if ((Get-WinixBootstrapSha256 $temporary) -ne $expected) {
            throw "Release checksum mismatch for $Asset; nothing was executed"
        }
        Move-Item -LiteralPath $temporary -Destination $Destination -Force
    } finally {
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
    }
}

# Downloads a Winix release into %LOCALAPPDATA%\Winix\runtime\<version> and returns the executable.
function Install-WinixRuntime {
    param([string]$Version)
    $architecture = [Environment]::GetEnvironmentVariable('PROCESSOR_ARCHITEW6432')
    if (-not $architecture) { $architecture = $env:PROCESSOR_ARCHITECTURE }
    switch ($architecture.ToUpperInvariant()) {
        'AMD64' { $asset = 'winix-windows-x64.exe' }
        'ARM64' { $asset = 'winix-windows-arm64.exe' }
        default { throw "Unsupported Windows architecture: $architecture" }
    }
    $folder = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) "Winix\runtime\$Version"
    Assert-WinixBootstrapDirectory $folder
    New-Item -ItemType Directory -Path $folder -Force | Out-Null
    $binary = Join-Path $folder 'winix.exe'
    Save-WinixVerifiedDownload "$WinixReleases/download/v$Version/$asset" "$WinixReleases/download/v$Version/SHA256SUMS" $asset $binary
    if (((Invoke-WinixBootstrapNative $binary @('--version')) -join '').Trim() -ne $Version) {
        throw "The downloaded Winix doesn't report version $Version."
    }
    return $binary
}

# host/owner/repo for HTTPS and SSH Git URLs, so an SSH clone of the same repository is reused.
function Get-WinixRepositoryIdentity([string]$Url) {
    $value = $Url.Trim()
    if ($value -match '^(?:ssh://)?git@([^:/]+)[:/](.+)$') { $hostPart = $Matches[1]; $pathPart = $Matches[2] }
    elseif ($value -match '^https://([^/@?#]+)/(.+)$') { $hostPart = $Matches[1]; $pathPart = $Matches[2] }
    else { return $value }
    $pathPart = $pathPart.TrimEnd('/')
    if ($pathPart.EndsWith('.git')) { $pathPart = $pathPart.Substring(0, $pathPart.Length - 4) }
    return ($hostPart + '/' + $pathPart).ToLowerInvariant()
}

# Clones the repository (or checks an existing checkout) and returns the config directory.
function Initialize-WinixCheckout {
    param([string]$Repository, [string]$Ref, [string]$Destination, [string]$ConfigDirectory)
    $git = Get-WinixBootstrapApplication 'git.exe'
    if (-not (Test-Path -LiteralPath $Destination)) {
        Invoke-WinixBootstrapNative $git @('clone', '--origin', 'origin', '--', $Repository, $Destination) | ForEach-Object { Write-Host $_ }
        if ($Ref -ne 'main' -or (Invoke-WinixBootstrapNative $git @('-C', $Destination, 'branch', '--show-current')) -ne 'main') {
            Invoke-WinixBootstrapNative $git @('-C', $Destination, 'checkout', $Ref) | ForEach-Object { Write-Host $_ }
        }
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Destination '.git') -PathType Container)) { throw 'The destination exists but is not a Git checkout; refusing to use it.' }
    Assert-WinixBootstrapDirectory (Join-Path $Destination '.git')
    $origin = ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'remote', 'get-url', 'origin')) -join '').Trim()
    if ((Get-WinixRepositoryIdentity $origin) -ne (Get-WinixRepositoryIdentity $Repository)) {
        throw "The existing checkout has a different origin ($origin); refusing to change it."
    }
    if ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'status', '--porcelain', '--untracked-files=normal'))) {
        # Linked app settings change in the checkout (Terminal rewrites settings.json), so a rerun after a restart
        # must not stop here. They are left exactly as they are.
        Write-Warning 'The checkout has local changes; continuing without touching them (never reset, cleaned or pulled).'
    }
    $head = ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'rev-parse', 'HEAD')) -join '').Trim()
    $wanted = ((Invoke-WinixBootstrapNative $git @('-C', $Destination, 'rev-parse', '--verify', "$Ref^{commit}")) -join '').Trim()
    if ($head -ne $wanted) { throw "The existing checkout isn't at $Ref; switch it yourself. This script never pulls or resets." }
    if (-not $ConfigDirectory) {
        # The root when it holds the config, else winix\ (or the root for a repository without one yet).
        $ConfigDirectory = if (-not (Test-Path -LiteralPath (Join-Path $Destination 'winix.config.ts') -PathType Leaf) -and
            (Test-Path -LiteralPath (Join-Path (Join-Path $Destination 'winix') 'winix.config.ts') -PathType Leaf)) { 'winix' } else { '.' }
    }
    $config = [IO.Path]::GetFullPath((Join-Path $Destination $ConfigDirectory))
    Assert-WinixBootstrapDirectory $config
    return $config
}

function Install-Winix {
    param(
        [string]$Repository, [string]$Ref = 'main', [string]$Destination = (Join-Path $HOME 'dotfiles'), [string]$ConfigDirectory,
        [string]$HostName, [string]$Version, [switch]$PrepareOnly, [switch]$DryRun, [switch]$Yes
    )
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne [PlatformID]::Win32NT) {
        throw 'This script is for Windows. In WSL or Linux, use install.sh.'
    }
    if ($Version -and $Version -notmatch $WinixVersionPattern) { throw '-Version takes a release version such as 0.3.2.' }
    if ($Repository) {
        $uri = $null
        if (-not [uri]::TryCreate($Repository, [UriKind]::Absolute, [ref]$uri) -or
            $uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment) {
            throw 'Repository must be HTTPS without credentials, query, or fragment.'
        }
        if ($HostName -and ($HostName.StartsWith('-') -or $HostName -match '[\x00\r\n]')) { throw '-HostName takes a declared host name.' }
        if (-not $Ref -or $Ref.StartsWith('-') -or $Ref -match '[\x00\r\n]') { throw 'Invalid -Ref.' }
        if ($ConfigDirectory -and ([IO.Path]::IsPathRooted($ConfigDirectory) -or $ConfigDirectory -match '(^|[\\/])\.\.([\\/]|$)' -or $ConfigDirectory -match '[:\x00\r\n]')) {
            throw '-ConfigDirectory must be inside the repository.'
        }
        $Destination = [IO.Path]::GetFullPath($Destination)
        Assert-WinixBootstrapDirectory $Destination
    } elseif ($HostName -or $PrepareOnly) {
        throw '-HostName and -PrepareOnly need -Repository.'
    }
    $winix = if ($Version) { "Winix $Version" } else { 'the latest Winix' }
    $target = if ($HostName) { "host $HostName" } else { 'the host you choose' }
    $steps = @('install Git, PowerShell 7 and DSC if missing (installers may ask for administrator approval)')
    if ($Repository) {
        $steps += "clone $Repository ($Ref) to $Destination (or reuse that checkout)"
        $pinnedIn = if ($ConfigDirectory) { "$ConfigDirectory\package.json" } else { "the repository's package.json (next to winix.config.ts at its root or in winix\)" }
        $steps += "download the Winix version pinned in $pinnedIn ($winix if it has no config yet; checksum-verified)"
        $steps += 'run its configuration (TypeScript from this repository; it can run commands)'
        $steps += if ($PrepareOnly) { "show the plan for $target without applying it" } else { "apply it to this PC as $target" }
    } else {
        $steps += "download $winix (checksum-verified) to $([Environment]::GetFolderPath('LocalApplicationData'))\Winix"
    }
    $steps += 'put a winix command on your user PATH'
    if ($DryRun) {
        Write-Host 'This would:'
        $steps | ForEach-Object { Write-Host "  - $_" }
        Write-Host 'Nothing was changed (-DryRun).'
        return
    }
    # The only question: everything after it runs without asking (UAC prompts aside).
    Write-Host ''
    Write-Host 'This will:'
    $steps | ForEach-Object { Write-Host "  - $_" }
    if (-not $Yes) {
        if ([Console]::IsInputRedirected) { throw 'Rerun with -Yes to continue without a terminal.' }
        if ((Read-Host 'Continue? [y/N]').Trim() -notmatch '^(?i:y|yes)$') { throw 'Cancelled. Nothing was changed.' }
    }
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Update-WinixBootstrapPath
    Install-WinixPrerequisites -Yes:$Yes
    $config = $null
    $pinned = $null
    if ($Repository) {
        $config = Initialize-WinixCheckout $Repository $Ref $Destination $ConfigDirectory
        $pinned = Get-WinixCheckoutVersion $config
    }
    $installVersion = if ($pinned) { $pinned } elseif ($Version) { $Version } else { Get-WinixLatestVersion }
    $binary = Install-WinixRuntime $installVersion
    Test-WinixCapabilities
    if ($pinned) {
        # Consent was given above; winix bootstrap asks nothing more (removals and UAC aside).
        $arguments = @('bootstrap', '--confirmed')
        if ($HostName) { $arguments += @('--host', $HostName) }
        if ($PrepareOnly) { $arguments += '--prepare-only' }
        if ($Yes) { $arguments += '--yes' }
        Push-Location -LiteralPath $config
        try { Invoke-WinixExecutable $binary $arguments }
        finally { Pop-Location }
        return
    }
    Invoke-WinixExecutable $binary @('install', 'command')
    Write-Host ''
    if ($Repository) {
        New-Item -ItemType Directory -Path $config -Force | Out-Null
        Write-Host "$config has no Winix config yet. In a new terminal:"
        Write-Host "  cd `"$config`""
        Write-Host '  winix init'
    } else {
        Write-Host "Winix $installVersion is installed. In a new terminal, in a new folder for your config:"
        Write-Host '  winix init'
    }
}

if ($MyInvocation.InvocationName -ne '.') {
    try {
        Install-Winix -Repository $Repository -Ref $Ref -Destination $Destination -ConfigDirectory $ConfigDirectory `
            -HostName $HostName -Version $Version -PrepareOnly:$PrepareOnly -DryRun:$DryRun -Yes:$Yes
    } catch {
        Write-Error $_ -ErrorAction Continue
        exit 1
    }
}
