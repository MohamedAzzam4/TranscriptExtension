[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot

function Invoke-Checked {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Label,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "$Label failed with exit code $LASTEXITCODE."
    }
    Write-Host "[PASS] $Label" -ForegroundColor Green
}

Write-Host "Dub Transcript Lab regression runner" -ForegroundColor Cyan
Write-Host "Project: $projectRoot"

$syntaxFiles = @(
    "content.js",
    "learning-features.js",
    "media-observer-bridge.js",
    "media-observer-main.js",
    "netflix-research.js",
    "offscreen.js",
    "popup.js",
    "service-worker.js",
    "subtitle-segmentation.js",
    "transcript-groups.js"
)

foreach ($file in $syntaxFiles) {
    $path = Join-Path "extension" $file
    Invoke-Checked "Syntax $path" { node --check $path }
}

$extensionTests = Get-ChildItem "extension" -Filter "test-*.mjs" | Sort-Object Name
foreach ($test in $extensionTests) {
    Invoke-Checked $test.Name { node $test.FullName }
}

$python = if (Test-Path ".venv\Scripts\python.exe") {
    ".venv\Scripts\python.exe"
} else {
    "python"
}
Invoke-Checked "Server unit tests" {
    & $python -m unittest discover -s server -p "test_*.py"
}

Invoke-Checked "Git whitespace check" { git diff --check }

Write-Host ""
Write-Host "Automated regression passed." -ForegroundColor Green
Write-Host "Browser-only checks remain manual:"
Write-Host "  experiments\PHASE1_MANUAL_CHECKLIST.md"
Write-Host "  experiments\PHASE2_MANUAL_CHECKLIST.md"
