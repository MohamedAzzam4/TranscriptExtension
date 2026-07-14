$ErrorActionPreference = "Stop"

$StartupFolder = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupFolder "Dub Transcript Lab Recognizer.lnk"
$TaskScript = Join-Path $PSScriptRoot "run-background-task.ps1"
$PowerShell = (Get-Command powershell.exe).Source
$Shell = New-Object -ComObject WScript.Shell
$Shortcut = $Shell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = $PowerShell
$Shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$TaskScript`""
$Shortcut.WorkingDirectory = Split-Path -Parent $PSScriptRoot
$Shortcut.WindowStyle = 7
$Shortcut.Description = "Start the local Dub Transcript Lab recognizer"
$Shortcut.Save()

Write-Host "Installed the per-user recognizer startup shortcut: $ShortcutPath"
