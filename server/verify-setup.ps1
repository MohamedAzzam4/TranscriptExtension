[CmdletBinding()]
param(
  [ValidateRange(0, 900)]
  [int]$WaitSeconds = 120,
  [switch]$NoStart
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ConfigPath = Join-Path $ProjectRoot ".runtime\user-settings.json"
$ManifestPath = Join-Path $ProjectRoot ".runtime\native-host\com.dub_transcript_lab.recognizer.json"
$ExpectedNativeHosts = @(
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "native-host.exe")),
  [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot "native-host-prebuilt.exe"))
)
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$HealthUrl = "http://127.0.0.1:8000/health"
$Failures = New-Object System.Collections.Generic.List[string]

function Report([bool]$Passed, [string]$Label, [string]$Details = "") {
  $Marker = if ($Passed) { "PASS" } else { "FAIL" }
  $Color = if ($Passed) { "Green" } else { "Red" }
  Write-Host ("[{0}] {1}" -f $Marker, $Label) -ForegroundColor $Color
  if ($Details) { Write-Host "       $Details" }
  if (-not $Passed) { $Failures.Add($Label) | Out-Null }
}

function Get-RecognizerHealth {
  try {
    $Result = Invoke-RestMethod -Uri $HealthUrl -TimeoutSec 2
    return [bool]$Result.ready
  } catch {
    return $false
  }
}

Write-Host ""
Write-Host "Dub Transcript Lab setup check" -ForegroundColor Cyan
Write-Host "Project: $ProjectRoot"
Write-Host ""

$Config = $null
if (Test-Path -LiteralPath $ConfigPath) {
  try { $Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json } catch { }
}
Report ($null -ne $Config) "Local setup configuration" $ConfigPath

$PythonReady = Test-Path -LiteralPath $Python
if ($PythonReady) {
  & $Python -c "import faster_whisper, whisperlivekit, yt_dlp" 2>$null
  $PythonReady = $LASTEXITCODE -eq 0
}
Report $PythonReady "Python environment and recognizer packages" $Python

$ManifestReady = $false
if (Test-Path -LiteralPath $ManifestPath) {
  try {
    $Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
    $ExpectedOrigin = if ($Config.extensionId) { "chrome-extension://$($Config.extensionId)/" } else { "" }
    $RegisteredExecutable = [System.IO.Path]::GetFullPath([string]$Manifest.path)
    $ManifestReady = $Manifest.name -eq "com.dub_transcript_lab.recognizer" -and
      ($ExpectedNativeHosts -contains $RegisteredExecutable) -and
      (Test-Path -LiteralPath $RegisteredExecutable) -and
      [bool]$ExpectedOrigin -and
      $Manifest.allowed_origins -contains $ExpectedOrigin
  } catch { }
}
Report $ManifestReady "Extension-to-Windows registration manifest" $ManifestPath

$RegistryReady = $true
foreach ($RegistryPath in @(
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.dub_transcript_lab.recognizer",
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.dub_transcript_lab.recognizer"
)) {
  if (-not (Test-Path $RegistryPath)) {
    $RegistryReady = $false
    continue
  }
  $RegisteredManifestPath = [string](Get-Item -LiteralPath $RegistryPath).GetValue("")
  if (-not $RegisteredManifestPath -or
      [System.IO.Path]::GetFullPath($RegisteredManifestPath) -ne [System.IO.Path]::GetFullPath($ManifestPath)) {
    $RegistryReady = $false
  }
}
Report $RegistryReady "Chrome and Edge native-host registration" $ManifestPath

if ($Config -and $Config.autostart) {
  $Shortcut = Join-Path ([Environment]::GetFolderPath("Startup")) "Dub Transcript Lab Recognizer.lnk"
  Report (Test-Path -LiteralPath $Shortcut) "Recognizer starts automatically after sign-in" $Shortcut
}

$Healthy = Get-RecognizerHealth
if (-not $Healthy -and -not $NoStart -and $PythonReady) {
  Write-Host "[....] Starting the local recognizer; the first start can take a few minutes." -ForegroundColor Yellow
  try { & (Join-Path $PSScriptRoot "start-background.ps1") -Port 8000 } catch { }
  $Deadline = (Get-Date).AddSeconds($WaitSeconds)
  while (-not $Healthy -and (Get-Date) -lt $Deadline) {
    Start-Sleep -Seconds 2
    $Healthy = Get-RecognizerHealth
  }
}
Report $Healthy "Local recognizer health endpoint" $HealthUrl

Write-Host ""
if ($Failures.Count -gt 0) {
  Write-Host "$($Failures.Count) setup check(s) failed." -ForegroundColor Red
  Write-Host "Run INSTALL.cmd again. Logs are in .runtime\logs if the recognizer still fails."
  exit 1
}

Write-Host "Everything required by the extension is ready." -ForegroundColor Green
exit 0
