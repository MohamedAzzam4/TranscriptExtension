$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$RuntimeRoot = Join-Path $ProjectRoot ".runtime"
$Downloads = Join-Path $RuntimeRoot "downloads"
$CudaRuntime = Join-Path $RuntimeRoot "cuda"
$Archive = Join-Path $Downloads "cuBLAS.and.cuDNN_CUDA12_win_v2.7z"
$DownloadUrl = "https://github.com/Purfview/whisper-standalone-win/releases/download/libs/cuBLAS.and.cuDNN_CUDA12_win_v2.7z"
$ExpectedBytes = 574616577
$ExpectedSha256 = "89D396373E2781E01FDD58D35A73AADF9B2DBA83D3DCD05A838B9115D50427C3"

New-Item -ItemType Directory -Force -Path $Downloads, $CudaRuntime | Out-Null

if (-not (Test-Path $Archive) -or (Get-Item $Archive).Length -ne $ExpectedBytes) {
  Write-Host "Downloading the Faster-Whisper-recommended Windows CUDA 12 runtime..."
  & curl.exe -L --fail --retry 3 --output $Archive $DownloadUrl
  if ($LASTEXITCODE -ne 0) { throw "CUDA runtime download failed with exit code $LASTEXITCODE." }
}

$Item = Get-Item $Archive
if ($Item.Length -ne $ExpectedBytes) { throw "Unexpected CUDA archive size: $($Item.Length)." }
$Hash = (Get-FileHash -Algorithm SHA256 $Archive).Hash
if ($Hash -ne $ExpectedSha256) { throw "CUDA archive SHA-256 verification failed." }

Write-Host "Extracting CUDA libraries inside the project..."
& tar.exe -xf $Archive -C $CudaRuntime
if ($LASTEXITCODE -ne 0) { throw "CUDA runtime extraction failed with exit code $LASTEXITCODE." }

foreach ($Dll in "cublas64_12.dll", "cudnn_ops64_9.dll") {
  if (-not (Test-Path (Join-Path $CudaRuntime $Dll))) { throw "$Dll is missing after extraction." }
}

Write-Host "Project-local CUDA runtime is ready in $CudaRuntime"

