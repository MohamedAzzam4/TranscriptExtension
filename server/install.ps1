[CmdletBinding()]
param(
  [ValidateSet("cpu", "gpu")]
  [string]$Mode = "",
  [string]$Python = "",
  [string]$ExtensionId = "",
  [ValidateSet("tiny", "base", "small", "medium", "large-v3-turbo")]
  [string]$Model = "",
  [ValidatePattern("^[a-zA-Z]{2,3}(?:-[a-zA-Z]{2,4})?$")]
  [string]$Language = "de",
  [switch]$SkipModelDownload,
  [switch]$SkipAutostart,
  [switch]$NonInteractive,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ExtensionDirectory = Join-Path $ProjectRoot "extension"
$RuntimeDirectory = Join-Path $ProjectRoot ".runtime"
$ModelCacheDirectory = Join-Path $ProjectRoot ".model-cache\huggingface"
$ConfigPath = Join-Path $RuntimeDirectory "user-settings.json"

function Write-Section([string]$Title) {
  Write-Host ""
  Write-Host "=== $Title ===" -ForegroundColor Cyan
}

function Get-CompatiblePython([string]$Requested) {
  $Candidates = New-Object System.Collections.Generic.List[string]
  if ($Requested) {
    $Candidates.Add($Requested)
  } else {
    $Launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    if ($Launcher) {
      foreach ($Minor in "3.12", "3.11", "3.13") {
        $Resolved = & $Launcher.Source "-$Minor" -c "import sys; print(sys.executable)" 2>$null
        if ($LASTEXITCODE -eq 0 -and $Resolved) { $Candidates.Add([string]$Resolved) }
      }
    }
    foreach ($CommandName in "python.exe", "python3.exe", "python") {
      $Command = Get-Command $CommandName -ErrorAction SilentlyContinue
      if ($Command) { $Candidates.Add($Command.Source) }
    }
  }

  foreach ($Candidate in ($Candidates | Select-Object -Unique)) {
    try {
      $Details = & $Candidate -c "import json,sys; print(json.dumps({'path':sys.executable,'version':list(sys.version_info[:3])}))" 2>$null
      if ($LASTEXITCODE -ne 0 -or -not $Details) { continue }
      $Parsed = $Details | ConvertFrom-Json
      $Version = [version]("{0}.{1}.{2}" -f $Parsed.version[0], $Parsed.version[1], $Parsed.version[2])
      if ($Version -ge [version]"3.11" -and $Version -lt [version]"3.14") {
        return [pscustomobject]@{ Path = [string]$Parsed.path; Version = $Version }
      }
    } catch {
      # Try the next candidate. Windows Store aliases commonly fail here.
    }
  }

  throw @"
Python 3.11, 3.12, or 3.13 was not found.

Install 64-bit Python 3.12 from:
https://www.python.org/downloads/windows/

During installation, enable "Add python.exe to PATH", then run INSTALL.cmd again.
"@
}

function Get-BrowserExecutable {
  $Candidates = @(
    (Join-Path $env:LOCALAPPDATA "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe")
  )
  return $Candidates | Where-Object { $_ -and (Test-Path -LiteralPath $_) } | Select-Object -First 1
}

function Request-ExtensionId {
  Write-Section "Load the browser extension"
  Write-Host "1. Enable Developer mode on the browser extensions page."
  Write-Host "2. Click Load unpacked."
  Write-Host "3. Select this folder:"
  Write-Host "   $ExtensionDirectory" -ForegroundColor Yellow
  Write-Host "4. Copy the 32-character ID shown on the Dub Transcript Lab card."

  try { Set-Clipboard -Value $ExtensionDirectory } catch { }
  try { Start-Process explorer.exe -ArgumentList "`"$ExtensionDirectory`"" } catch { }
  $Browser = Get-BrowserExecutable
  if ($Browser) {
    try { Start-Process -FilePath $Browser -ArgumentList "chrome://extensions" } catch { }
  }

  while ($true) {
    $Value = (Read-Host "Paste the extension ID here").Trim().ToLowerInvariant()
    if ($Value -match "^[a-p]{32}$") { return $Value }
    Write-Host "That ID is not valid. It must contain exactly 32 letters from a to p." -ForegroundColor Yellow
  }
}

if (-not $Mode) {
  if ($NonInteractive -or $DryRun) {
    $Mode = "cpu"
  } else {
    Write-Section "Choose how transcription runs"
    Write-Host "1. CPU compatibility mode - works on almost every Windows PC (recommended first setup)."
    Write-Host "2. NVIDIA GPU mode - much faster, but downloads an additional CUDA package."
    $Choice = (Read-Host "Choose 1 or 2 [1]").Trim()
    $Mode = if ($Choice -eq "2") { "gpu" } else { "cpu" }
  }
}

if (-not $Model) { $Model = if ($Mode -eq "gpu") { "small" } else { "base" } }
$Device = if ($Mode -eq "gpu") { "auto" } else { "cpu" }
$PythonInfo = Get-CompatiblePython $Python

Write-Section "Setup plan"
Write-Host "Python:       $($PythonInfo.Version) ($($PythonInfo.Path))"
Write-Host "Mode:         $Mode"
Write-Host "Live model:   $Model"
Write-Host "Batch model:  small"
Write-Host "Language:     $Language"
Write-Host "Extension:    $ExtensionDirectory"
Write-Host "Privacy:      transcription stays on this PC"
Write-Host "Disk space:   allow several GB for Python packages and speech models"
if ($Mode -eq "gpu") {
  Write-Host "GPU package:  an additional verified download of about 575 MB"
}

if ($DryRun) {
  Write-Host ""
  Write-Host "Dry run complete. No files or system settings were changed." -ForegroundColor Green
  exit 0
}

if (-not $NonInteractive) {
  $Confirmation = (Read-Host "Press Enter to continue, or type Q to cancel").Trim()
  if ($Confirmation -match "^[qQ]") { Write-Host "Setup cancelled."; exit 0 }
}

if (-not $ExtensionId) {
  if ($NonInteractive) { throw "-ExtensionId is required with -NonInteractive." }
  $ExtensionId = Request-ExtensionId
} else {
  $ExtensionId = $ExtensionId.Trim().ToLowerInvariant()
  if ($ExtensionId -notmatch "^[a-p]{32}$") { throw "Invalid Chrome/Edge extension ID: $ExtensionId" }
}

Write-Section "Install local speech recognition"
& (Join-Path $PSScriptRoot "setup.ps1") -Python $PythonInfo.Path

if ($Mode -eq "gpu") {
  Write-Section "Install NVIDIA acceleration"
  & (Join-Path $PSScriptRoot "setup-gpu.ps1")
}

New-Item -ItemType Directory -Force -Path $RuntimeDirectory, $ModelCacheDirectory | Out-Null
$Configuration = [ordered]@{
  schemaVersion = 1
  installedAt = (Get-Date).ToUniversalTime().ToString("o")
  mode = $Mode
  device = $Device
  model = $Model
  batchModel = "small"
  language = $Language.ToLowerInvariant()
  backend = "faster-whisper"
  policy = "localagreement"
  port = 8000
  modelCache = ".model-cache\huggingface"
  extensionId = $ExtensionId
  autostart = -not $SkipAutostart.IsPresent
}
[System.IO.File]::WriteAllText(
  $ConfigPath,
  ($Configuration | ConvertTo-Json -Depth 4),
  (New-Object System.Text.UTF8Encoding($false))
)

if (-not $SkipModelDownload) {
  Write-Section "Download the speech models"
  Write-Host "This is normally the longest setup step and only happens once."
  $env:HF_HOME = $ModelCacheDirectory
  $Wlk = Join-Path $ProjectRoot ".venv\Scripts\wlk.exe"
  foreach ($RequiredModel in @($Model, "small") | Select-Object -Unique) {
    & $Wlk pull "faster-whisper:$RequiredModel"
    if ($LASTEXITCODE -ne 0) {
      throw "Downloading the $RequiredModel speech model failed with exit code $LASTEXITCODE."
    }
  }
}

Write-Section "Connect the extension to Windows"
$NativeHost = Join-Path $PSScriptRoot "native-host.exe"
$FallbackNativeHost = Join-Path $PSScriptRoot "native-host-prebuilt.exe"
$FallbackHashPath = Join-Path $PSScriptRoot "native-host-prebuilt.sha256"
try {
  & (Join-Path $PSScriptRoot "build-native-host.ps1")
} catch {
  if (-not (Test-Path -LiteralPath $FallbackNativeHost) -or -not (Test-Path -LiteralPath $FallbackHashPath)) { throw }
  $ExpectedFallbackHash = ((Get-Content -LiteralPath $FallbackHashPath -Raw).Trim() -split "\s+")[0]
  $ActualFallbackHash = (Get-FileHash -LiteralPath $FallbackNativeHost -Algorithm SHA256).Hash
  if ($ActualFallbackHash -ne $ExpectedFallbackHash) {
    throw "The included native helper failed its SHA-256 integrity check."
  }
  $NativeHost = $FallbackNativeHost
  Write-Warning "The native helper could not be rebuilt, so setup will use the verified included build. $($_.Exception.Message)"
}
try { Unblock-File -LiteralPath $NativeHost } catch { }
& (Join-Path $PSScriptRoot "install-native-host.ps1") -ExtensionId $ExtensionId -Executable $NativeHost

if (-not $SkipAutostart) {
  & (Join-Path $PSScriptRoot "install-autostart.ps1")
}

Write-Section "Start and verify"
& (Join-Path $PSScriptRoot "start-background.ps1") -Port 8000
& (Join-Path $PSScriptRoot "verify-setup.ps1") -WaitSeconds 600

Write-Section "Ready"
Write-Host "Dub Transcript Lab is installed." -ForegroundColor Green
Write-Host "Refresh any video page, click the extension, and choose Analyze automatically."
Write-Host "If something later stops working, double-click CHECK-SETUP.cmd."
