param(
  [string]$Python = ""
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$Venv = Join-Path $ProjectRoot ".venv"

if (-not $Python) {
  $PythonCommand = Get-Command python -ErrorAction SilentlyContinue
  if ($PythonCommand) {
    $Python = $PythonCommand.Source
  } else {
    throw "Python 3.10+ was not found. Pass its executable path with -Python."
  }
}

Write-Host "Creating the local environment with $Python"
& $Python -m venv $Venv
if ($LASTEXITCODE -ne 0) { throw "Creating the Python virtual environment failed with exit code $LASTEXITCODE." }
$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Upgrading pip failed with exit code $LASTEXITCODE." }
& $VenvPython -m pip install whisperlivekit yt-dlp
if ($LASTEXITCODE -ne 0) { throw "Installing WhisperLiveKit failed with exit code $LASTEXITCODE." }

Write-Host "WhisperLiveKit is installed in $Venv"
Write-Host "Start it with: .\server\start.cmd"
