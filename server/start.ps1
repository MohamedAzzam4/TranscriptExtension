param(
  [string]$Model = "small",
  [string]$Language = "de",
  [string]$Backend = "faster-whisper",
  [ValidateSet("localagreement", "simulstreaming")]
  [string]$Policy = "localagreement",
  [ValidateSet("cpu", "auto")]
  [string]$Device = "auto",
  [int]$Port = 8000
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
$WhisperLiveKit = Join-Path $ProjectRoot ".venv\Scripts\wlk.exe"
$Python = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$WhisperLiveKitRunner = Join-Path $PSScriptRoot "run-wlk.py"
$ModelCache = Join-Path $ProjectRoot ".model-cache"
$CudaRuntime = Join-Path $ProjectRoot ".runtime\cuda"

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
  throw "GPU mode needs the project-local CUDA runtime in $CudaRuntime. Use -Device cpu or install CUDA 12 cuBLAS and cuDNN 9."
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

# SimulStreaming downloads a native Whisper checkpoint; keep that optional
# second model inside the project. LocalAgreement reuses the Hugging Face model
# fetched by `wlk pull`, so it must retain WhisperLiveKit's default cache path.
if ($Policy -eq "simulstreaming") {
  $WhisperLiveKitArgs += @("--model_cache_dir", $ModelCache)
}

$PreviousErrorActionPreference = $ErrorActionPreference
$ErrorActionPreference = "Continue"
& $Python $WhisperLiveKitRunner @WhisperLiveKitArgs
$WhisperLiveKitExitCode = $LASTEXITCODE
$ErrorActionPreference = $PreviousErrorActionPreference
if ($WhisperLiveKitExitCode -ne 0) { throw "WhisperLiveKit exited with code $WhisperLiveKitExitCode." }
