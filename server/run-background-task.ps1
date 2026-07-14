$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$LogRoot = Join-Path $ProjectRoot ".runtime\logs"
$LogPath = Join-Path $LogRoot "recognizer-task.log"
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

try {
  "[$(Get-Date -Format o)] Scheduled recognizer starting." | Add-Content -Encoding UTF8 $LogPath
  $ErrorActionPreference = "Continue"
  & (Join-Path $PSScriptRoot "start.ps1") *>> $LogPath
  $RecognizerExitCode = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($RecognizerExitCode -ne 0) { throw "Recognizer exited with code $RecognizerExitCode." }
} catch {
  "[$(Get-Date -Format o)] ERROR: $($_.Exception.Message)" | Add-Content -Encoding UTF8 $LogPath
  throw
}
