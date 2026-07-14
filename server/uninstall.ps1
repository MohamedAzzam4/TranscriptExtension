[CmdletBinding()]
param(
  [switch]$RemoveLocalData,
  [switch]$NonInteractive
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeDirectory = Join-Path $ProjectRoot ".runtime"
$EnvironmentDirectory = Join-Path $ProjectRoot ".venv"
$ModelCache = Join-Path $ProjectRoot ".model-cache"
$HealthUrl = "http://127.0.0.1:8000/health"
$HostName = "com.dub_transcript_lab.recognizer"

Write-Host "Dub Transcript Lab uninstall" -ForegroundColor Cyan

$IsRecognizerHealthy = $false
try {
  $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  $IsRecognizerHealthy = [bool]$Health.ready
} catch { }

if ($IsRecognizerHealthy) {
  $Listener = Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
  if ($Listener -and $Listener.OwningProcess) {
    Stop-Process -Id $Listener.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "Stopped the local recognizer."
  }
}

$Shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Dub Transcript Lab Recognizer.lnk"
if (Test-Path -LiteralPath $Shortcut) {
  Remove-Item -LiteralPath $Shortcut -Force
  Write-Host "Removed automatic startup."
}

foreach ($RegistryPath in @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName"
)) {
  if (Test-Path $RegistryPath) { Remove-Item -Path $RegistryPath -Force }
}
Write-Host "Removed the browser-to-Windows registration."

if (-not $RemoveLocalData -and -not $NonInteractive) {
  $Answer = (Read-Host "Also remove downloaded models and the private Python environment? [y/N]").Trim()
  $RemoveLocalData = $Answer -match "^[yY]"
}

if ($RemoveLocalData) {
  foreach ($Directory in $RuntimeDirectory, $EnvironmentDirectory, $ModelCache) {
    $ResolvedParent = [System.IO.Path]::GetFullPath((Split-Path -Parent $Directory))
    if ($ResolvedParent -ne [System.IO.Path]::GetFullPath($ProjectRoot)) {
      throw "Refusing to remove a directory outside the project: $Directory"
    }
    if (Test-Path -LiteralPath $Directory) { Remove-Item -LiteralPath $Directory -Recurse -Force }
  }
  Write-Host "Removed project-local models, logs, configuration, and Python packages."
} else {
  $ManifestDirectory = Join-Path $RuntimeDirectory "native-host"
  if (Test-Path -LiteralPath $ManifestDirectory) {
    Remove-Item -LiteralPath $ManifestDirectory -Recurse -Force
  }
  Write-Host "Kept downloaded models and the Python environment for a future reinstall."
}

Write-Host ""
Write-Host "Windows integration has been removed." -ForegroundColor Green
Write-Host "Remove Dub Transcript Lab manually from chrome://extensions to finish."
