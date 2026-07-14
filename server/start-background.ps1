param(
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$StartScript = Join-Path $PSScriptRoot "start.ps1"
$LogRoot = Join-Path $ProjectRoot ".runtime\logs"
$HealthUrl = "http://127.0.0.1:$Port/health"

try {
  $Health = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
  if ($Health.ready) {
    Write-Host "The recognizer is already ready on port $Port."
    exit 0
  }
} catch {
  # A refused health request means the background recognizer should be started.
}

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($Listener) {
  throw "Port $Port is already occupied, but its recognizer health endpoint is not ready."
}

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null
$StandardOutput = Join-Path $LogRoot "recognizer.out.log"
$StandardError = Join-Path $LogRoot "recognizer.err.log"
$Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`" -Port $Port"

$Process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList $Arguments `
  -WindowStyle Hidden `
  -RedirectStandardOutput $StandardOutput `
  -RedirectStandardError $StandardError `
  -PassThru

Write-Host "Recognizer startup requested in the background (PID $($Process.Id))."
Write-Host "The browser extension will wait for it automatically."
