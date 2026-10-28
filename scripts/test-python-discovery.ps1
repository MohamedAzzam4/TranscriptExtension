[CmdletBinding()]
param([string]$Python = '')
$ErrorActionPreference = 'Stop'
$ProjectRoot = Split-Path -Parent $PSScriptRoot
. (Join-Path $ProjectRoot 'server\python-discovery.ps1')
if (-not $Python) { $Python = Join-Path $ProjectRoot '.venv\Scripts\python.exe' }
function Assert-True($Condition, [string]$Message) { if (-not $Condition) { throw $Message } }
function Assert-Rejected([scriptblock]$Action, [string]$Pattern) {
  $Caught = $null
  try { & $Action | Out-Null } catch { $Caught = $_.Exception.Message }
  Assert-True ($Caught -and $Caught -match $Pattern) "Expected rejection matching $Pattern; got $Caught"
}
foreach ($File in @('server\python-discovery.ps1', 'server\install.ps1')) {
  $Tokens = $null; $ParseErrors = $null
  $null = [System.Management.Automation.Language.Parser]::ParseFile((Join-Path $ProjectRoot $File), [ref]$Tokens, [ref]$ParseErrors)
  Assert-True (-not $ParseErrors.Count) "PowerShell parser failed: $File"
}
$Selected = Get-CompatiblePython -Requested $Python
Assert-True ($Selected.Version -ge [version]'3.11' -and $Selected.Version -lt [version]'3.14') 'Actual project Python must be supported'
Assert-True ((Get-CompatiblePython -Requested ('"' + (Split-Path $Python) + '"')).Path -eq $Selected.Path) 'Quoted folder path must resolve to python.exe'
$Failure = Invoke-PythonDiscoveryProcess -Executable "$env:SystemRoot\System32\cmd.exe" -Arguments '/d /c "echo missing runtime 1>&2 & exit /b 1"'
Assert-True ($Failure.ExitCode -eq 1) 'Native stderr/nonzero exit must not terminate Windows PowerShell discovery'
$Timeout = Invoke-PythonDiscoveryProcess -Executable "$PSHOME\powershell.exe" -Arguments '-NoProfile -NonInteractive -Command "Start-Sleep -Seconds 5"' -TimeoutMilliseconds 100
Assert-True ($Timeout.Reason -match 'timed out') 'Hanging discovery must be bounded'
$RealProbe = ${function:Invoke-PythonDiscoveryProcess}
$RealDirectories = ${function:Get-PythonDirectoryCandidates}
$RealRegistry = ${function:Get-PythonRegistryCandidates}
$RealPath = ${function:Get-PythonPathCandidates}
$RealLauncher = ${function:Get-PythonLauncherCandidates}
try {
  # Auto discovery must work with no PATH or launcher, using a registered path.
  function Get-PythonRegistryCandidates { $Python }
  function Get-PythonDirectoryCandidates { }
  function Get-PythonPathCandidates { }
  function Get-PythonLauncherCandidates { }
  Assert-True ((Get-CompatiblePython).Path -eq $Selected.Path) 'Registered Python must work without PATH/launcher'
  function Get-PythonRegistryCandidates { Join-Path $ProjectRoot 'missing-python.exe' }
  function Get-PythonDirectoryCandidates { $Python }
  Assert-True ((Get-CompatiblePython).Path -eq $Selected.Path) 'Failed candidate must not prevent a later common-folder candidate'

  function Invoke-PythonDiscoveryProcess {
    param($Executable, $Arguments)
    if ($Executable -eq 'bad-json') { return [pscustomobject]@{ ExitCode = 0; Output = 'invalid'; Reason = '' } }
    $Version = if ($Executable -eq 'new-python') { @(3,14,1) } else { @(3,12,8) }
    $Bits = if ($Executable -eq '32-bit-python') { 32 } else { 64 }
    return [pscustomobject]@{ ExitCode = 0; Output = (@{ path = $Executable; version = $Version; bits = $Bits } | ConvertTo-Json -Compress); Reason = '' }
  }
  Assert-Rejected { Get-CompatiblePython -Requested 'new-python' } 'Found Python 3.14.1'
  Assert-Rejected { Get-CompatiblePython -Requested '32-bit-python' } '32-bit Python'
  Assert-Rejected { Get-CompatiblePython -Requested 'bad-json' } 'invalid version information'
  Assert-Rejected { Get-CompatiblePython -Requested 'C:\Users\Test\Microsoft\WindowsApps\python.exe' } 'app-execution alias'
  function Get-PythonRegistryCandidates { 'new-python'; '32-bit-python'; 'valid-python' }
  function Get-PythonDirectoryCandidates { }
  Assert-True ((Get-CompatiblePython).Path -eq 'valid-python') 'Unsupported or32-bit default must not hide compatible Python'
} finally {
  Set-Item Function:Invoke-PythonDiscoveryProcess $RealProbe
  Set-Item Function:Get-PythonDirectoryCandidates $RealDirectories
  Set-Item Function:Get-PythonRegistryCandidates $RealRegistry
  Set-Item Function:Get-PythonPathCandidates $RealPath
  Set-Item Function:Get-PythonLauncherCandidates $RealLauncher
}
# Verify the actual folder and PEP514 registry adapters without registry writes.
$TestRoot = Join-Path $ProjectRoot 'test-artifacts\python-discovery\fixture'
$CommonFolder = Join-Path $TestRoot 'Programs\Python\Python312'
New-Item -ItemType Directory -Force -Path $CommonFolder | Out-Null
$PreviousLocalAppData = $env:LOCALAPPDATA
try {
  $env:LOCALAPPDATA = $TestRoot
  Assert-True (@(Get-PythonDirectoryCandidates) -contains (Join-Path $CommonFolder 'python.exe')) 'Standard per-user install folder must be searched'
} finally { $env:LOCALAPPDATA = $PreviousLocalAppData }
try {
  function Get-ChildItem { param($LiteralPath, $ErrorAction) [pscustomobject]@{ PSPath = 'C:\fixture\PythonCore\3.12' } }
  function Get-ItemProperty { param($LiteralPath, $ErrorAction) [pscustomobject]@{ ExecutablePath = $Python; '(default)' = (Split-Path $Python) } }
  Assert-True (@(Get-PythonRegistryCandidates) -contains $Python) 'PEP514 executable/install paths must be read'
} finally {
  Remove-Item Function:Get-ChildItem, Function:Get-ItemProperty
}
try {
  function Get-Command { param($Name, $CommandType, $ErrorAction) [pscustomobject]@{ Source = 'missing-launcher' } }
  function Invoke-PythonDiscoveryProcess { param($Executable, $Arguments) [pscustomobject]@{ ExitCode = 1; Output = ''; Reason = 'Missing runtime' } }
  Assert-True (@(Get-PythonLauncherCandidates).Count -eq 0) 'Broken launcher listing must be ignored'
  function Invoke-PythonDiscoveryProcess { param($Executable, $Arguments) [pscustomobject]@{ ExitCode = 0; Output = " -V:3.12 * C:\Program Files\Python312\python.exe`n"; Reason = '' } }
  Assert-True (@(Get-PythonLauncherCandidates) -contains 'C:\Program Files\Python312\python.exe') 'Launcher list must preserve spaces in executable paths'
} finally {
  Remove-Item Function:Get-Command
  Set-Item Function:Invoke-PythonDiscoveryProcess $RealProbe
}
try {
  function Read-Host { param($Prompt) '"' + $Python + '"' }
  Assert-True ((Get-CompatiblePython -Requested (Join-Path $ProjectRoot 'missing-python.exe') -AllowPrompt).Path -eq $Selected.Path) 'Interactive paste-path recovery must succeed without reinstalling'
} finally { Remove-Item Function:Read-Host }
Write-Host 'Python discovery: real 64-bit interpreter, quoted/custom path, registry/common folders without PATH, failed launcher/probe, timeout, versions/architecture, Windows alias and paste-path recovery checks passed.'
