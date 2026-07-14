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
    throw "Python 3.11, 3.12, or 3.13 was not found. Pass its executable path with -Python."
  }
}

$VersionText = & $Python -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}')"
if ($LASTEXITCODE -ne 0) { throw "The selected Python executable could not be started: $Python" }
$Version = [version]$VersionText.Trim()
if ($Version -lt [version]"3.11") {
  throw "Python 3.11 or newer is required. The selected executable is Python $Version."
}
if ($Version -ge [version]"3.14") {
  throw "Python $Version is newer than this tested ML dependency set. Install Python 3.12 or 3.13, then pass its executable with -Python."
}

Write-Host "Creating the local environment with Python $Version at $Python"
& $Python -m venv $Venv
if ($LASTEXITCODE -ne 0) { throw "Creating the Python virtual environment failed with exit code $LASTEXITCODE." }
$VenvPython = Join-Path $Venv "Scripts\python.exe"
& $VenvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw "Upgrading pip failed with exit code $LASTEXITCODE." }
$Requirements = Join-Path $PSScriptRoot "requirements.txt"
& $VenvPython -m pip install --requirement $Requirements
if ($LASTEXITCODE -ne 0) { throw "Installing the local recognizer dependencies failed with exit code $LASTEXITCODE." }

Write-Host "WhisperLiveKit is installed in $Venv"
Write-Host "Start it with: .\server\start.cmd"
