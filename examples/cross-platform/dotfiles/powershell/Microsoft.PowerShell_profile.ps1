# PowerShell 7 profile, linked by windows.powershell.profile().
Import-Module Terminal-Icons
Invoke-Expression (&starship init powershell)
# Aliases shared with zsh, written by features/cli/shell.ts.
. (Join-Path $HOME '.config\powershell\aliases.ps1')
