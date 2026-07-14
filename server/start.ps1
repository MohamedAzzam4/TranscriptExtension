param(
  [string]$Model = "",
  [string]$Language = "",
  [string]$Backend = "",
  [string]$Policy = "",
  [string]$Device = "",
  [int]$Port = 0
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WhisperLiveKit = Join-Path $ProjectRoot ".venv\Scripts\wlk.exe"
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$WhisperLiveKitRunner = Join-Path $PSScriptRoot "run-wlk.py"
$ModelCache = Join-Path $ProjectRoot ".model-cache"
$CudaRuntime = Join-Path $ProjectRoot ".runtime\cuda"
$ConfigPath = Join-Path $ProjectRoot ".runtime\user-settings.json"

$Config = $null
if (Test-Path $ConfigPath) {
  try {
    $Config = Get-Content -LiteralPath $ConfigPath -Raw | ConvertFrom-Json
  } catch {
    throw "The local setup configuration is invalid: $ConfigPath"
  }
}

if (-not $Model) { $Model = if ($Config.model) { [string]$Config.model } else { "base" } }
if (-not $Language) { $Language = if ($Config.language) { [string]$Config.language } else { "de" } }
if (-not $Backend) { $Backend = if ($Config.backend) { [string]$Config.backend } else { "faster-whisper" } }
if (-not $Policy) { $Policy = if ($Config.policy) { [string]$Config.policy } else { "localagreement" } }
if (-not $Device) { $Device = if ($Config.device) { [string]$Config.device } else { "cpu" } }
if ($Port -le 0) { $Port = if ($Config.port) { [int]$Config.port } else { 8000 } }

if ($Policy -notin @("localagreement", "simulstreaming")) {
  throw "Unsupported streaming policy '$Policy'."
}
if ($Device -notin @("cpu", "auto")) {
  throw "Unsupported device '$Device'. Use 'cpu' or 'auto'."
}
if ($Port -lt 1 -or $Port -gt 65535) {
  throw "Invalid recognizer port: $Port"
}
if ($Config.modelCache) {
  $ConfiguredModelCache = [System.IO.Path]::GetFullPath((Join-Path $ProjectRoot ([string]$Config.modelCache)))
  if (-not $ConfiguredModelCache.StartsWith([System.IO.Path]::GetFullPath($ProjectRoot), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "The configured model cache must stay inside the project folder."
  }
  New-Item -ItemType Directory -Force -Path $ConfiguredModelCache | Out-Null
  $env:HF_HOME = $ConfiguredModelCache
}

if (-not (Test-Path $WhisperLiveKit) -or -not (Test-Path $Python)) {
  throw "WhisperLiveKit is not installed. Run .\server\setup.cmd first."
}

New-Item -ItemType Directory -Force -Path $ModelCache | Out-Null
if ($Device -eq "cpu") {
  # CTranslate2 otherwise selects the detected NVIDIA GPU and fails when the
  # separate CUDA 12 runtime DLLs are not installed on Windows.
  $env:CUDA_VISIBLE_DEVICES = "-1"
} elseif (Test-Path $CudaRuntime) {
  $env:CUDA_VISIBLE_DEVICES = "0"
  $env:PATH = "$CudaRuntime;$env:PATH"
} else {
  Write-Warning "The NVIDIA runtime is not installed. Falling back to CPU mode."
  $env:CUDA_VISIBLE_DEVICES = "-1"
  $Device = "cpu"
}
Write-Host "Starting device '$Device', policy '$Policy', backend '$Backend', model '$Model', language '$Language' on ws://127.0.0.1:$Port/asr"
$WhisperLiveKitArgs = @(
  "--pcm-input",
  "--backend-policy", $Policy,
  "--backend", $Backend,
  "--model", $Model,
  "--language", $Language,
  "--host", "127.0.0.1",
  "--port", $Port
)

# SimulStreaming can use an additional native Whisper checkpoint. Keep its
# explicit cache inside the project as well; LocalAgreement follows HF_HOME
# when the guided installer has configured a project-local Hugging Face cache.
if ($Policy -eq "simulstreaming") {
  $WhisperLiveKitArgs += @("--model_cache_dir", $ModelCache)
}

$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Python $WhisperLiveKitRunner @WhisperLiveKitArgs
$WhisperLiveKitExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference
if ($WhisperLiveKitExitCode -ne 0) { throw "WhisperLiveKit exited with code $WhisperLiveKitExitCode." }
