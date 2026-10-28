# Read-only discovery shared by beginner setup and its local regression checks.
function Invoke-PythonDiscoveryProcess {
  param([string]$Executable, [string]$Arguments, [int]$TimeoutMilliseconds = 8000)
  $Process = New-Object System.Diagnostics.Process
  try {
    $Process.StartInfo.FileName = $Executable
    $Process.StartInfo.Arguments = $Arguments
    $Process.StartInfo.UseShellExecute = $false
    $Process.StartInfo.CreateNoWindow = $true
    $Process.StartInfo.RedirectStandardOutput = $true
    $Process.StartInfo.RedirectStandardError = $true
    # Discovery must not opt a launcher into downloading a missing runtime.
    $Process.StartInfo.EnvironmentVariables.Remove('PYLAUNCHER_ALLOW_INSTALL')
    if (-not $Process.Start()) { throw 'The executable could not be started.' }
    $OutputTask = $Process.StandardOutput.ReadToEndAsync()
    $ErrorTask = $Process.StandardError.ReadToEndAsync()
    if (-not $Process.WaitForExit($TimeoutMilliseconds)) {
      $Process.Kill()
      return [pscustomobject]@{ ExitCode = -1; Output = ''; Reason = 'Python check timed out.' }
    }
    $OutputText = $OutputTask.GetAwaiter().GetResult()
    $null = $ErrorTask.GetAwaiter().GetResult()
    return [pscustomobject]@{ ExitCode = $Process.ExitCode; Output = $OutputText; Reason = 'The executable did not return usable Python information.' }
  } catch {
    return [pscustomobject]@{ ExitCode = -1; Output = ''; Reason = 'The executable could not be started.' }
  } finally { $Process.Dispose() }
}

function Get-PythonRegistryCandidates {
  foreach ($Root in @('HKCU:\Software\Python\PythonCore', 'HKLM:\Software\Python\PythonCore', 'HKLM:\Software\WOW6432Node\Python\PythonCore')) {
    foreach ($VersionKey in (Get-ChildItem -LiteralPath $Root -ErrorAction SilentlyContinue)) {
      $Install = Get-ItemProperty -LiteralPath (Join-Path $VersionKey.PSPath 'InstallPath') -ErrorAction SilentlyContinue
      if ($Install.ExecutablePath) { [string]$Install.ExecutablePath }
      if ($Install.'(default)') { Join-Path ([string]$Install.'(default)') 'python.exe' }
    }
  }
}

function Get-PythonDirectoryCandidates {
  $Roots = @()
  if ($env:LOCALAPPDATA) { $Roots += Join-Path $env:LOCALAPPDATA 'Programs\Python' }
  if ($env:USERPROFILE) { $Roots += Join-Path $env:USERPROFILE 'AppData\Local\Programs\Python' }
  if ($env:ProgramFiles) { $Roots += $env:ProgramFiles }
  if (${env:ProgramFiles(x86)}) { $Roots += ${env:ProgramFiles(x86)} }
  if ($env:SystemDrive) { $Roots += "$($env:SystemDrive)\" }
  foreach ($Root in $Roots) {
    foreach ($Folder in (Get-ChildItem -LiteralPath $Root -Directory -Filter 'Python*' -ErrorAction SilentlyContinue)) {
      Join-Path $Folder.FullName 'python.exe'
    }
  }
}

function Get-PythonPathCandidates {
  foreach ($Name in @('python.exe', 'python3.exe', 'python')) {
    foreach ($Command in (Get-Command $Name -CommandType Application -All -ErrorAction SilentlyContinue)) { $Command.Source }
  }
}

function Get-PythonLauncherCandidates {
  $Launcher = Get-Command py.exe -CommandType Application -ErrorAction SilentlyContinue
  if (-not $Launcher) { return }
  # Listing, rather than launching every supported minor version, avoids a
  # missing selector aborting Windows PowerShell's ErrorActionPreference Stop.
  $Listing = Invoke-PythonDiscoveryProcess -Executable $Launcher.Source -Arguments '-0p'
  if ($Listing.ExitCode -ne 0) { return }
  foreach ($Line in ($Listing.Output -split '\r?\n')) {
    if ($Line -match '(?i)([a-z]:\\.*\\python(?:3(?:\.\d+)?)?\.exe)\s*$') { $Matches[1] }
  }
}

function Get-CompatiblePython {
  param([string]$Requested = '', [switch]$AllowPrompt)
  while ($true) {
    $Candidates = @()
    if ($Requested) {
      $Candidate = $Requested.Trim().Trim('"')
      if (Test-Path -LiteralPath $Candidate -PathType Container) { $Candidate = Join-Path $Candidate 'python.exe' }
      $Candidates += $Candidate
    } else {
      $Candidates += @(Get-PythonRegistryCandidates)
      $Candidates += @(Get-PythonDirectoryCandidates)
      $Candidates += @(Get-PythonPathCandidates)
      $Candidates += @(Get-PythonLauncherCandidates)
    }
    $Reasons = New-Object System.Collections.Generic.List[string]
    # Prefer3.12, then the other tested versions, without requiring any of them
    # to be the system default. The executable's own report remains authoritative.
    $Candidates = $Candidates | Select-Object -Unique | Sort-Object @{ Expression = {
      if ($_ -match 'Python312') { 0 } elseif ($_ -match 'Python311') { 1 } elseif ($_ -match 'Python313') { 2 } else { 3 }
    } }
    foreach ($Candidate in $Candidates) {
      if ($Candidate -match '\\Microsoft\\WindowsApps\\') {
        $Reasons.Add('A Windows app-execution alias was skipped; it is not a verified Python installation.')
        continue
      }
      $Probe = Invoke-PythonDiscoveryProcess -Executable $Candidate -Arguments '-I -c "import json,sys,struct; print(json.dumps({''path'':sys.executable,''version'':list(sys.version_info[:3]),''bits'':struct.calcsize(''P'')*8}))"'
      if ($Probe.ExitCode -ne 0) { $Reasons.Add("$Candidate : $($Probe.Reason)"); continue }
      try {
        $Parsed = $Probe.Output | ConvertFrom-Json
        $Version = [version]("{0}.{1}.{2}" -f $Parsed.version[0], $Parsed.version[1], $Parsed.version[2])
        if ($Version -lt [version]'3.11' -or $Version -ge [version]'3.14') {
          $Reasons.Add("Found Python $Version at $Candidate; this recognizer supports 3.11, 3.12 or 3.13.")
          continue
        }
        if ($Parsed.bits -ne 64) { $Reasons.Add("Found $($Parsed.bits)-bit Python $Version at $Candidate; 64-bit Python is required."); continue }
        if (-not $Parsed.path) { throw 'Missing executable path.' }
        return [pscustomobject]@{ Path = [string]$Parsed.path; Version = $Version }
      } catch { $Reasons.Add("$Candidate : Python returned invalid version information.") }
    }
    $Message = "A usable 64-bit Python 3.11, 3.12 or 3.13 was not found. Python 3.12 is recommended."
    if ($Reasons.Count) { $Message += "`n" + (($Reasons | Select-Object -Unique -First 6) -join "`n") }
    $Message += "`nIf Python is already installed, supply its python.exe path with INSTALL.cmd -Python `"C:\path\to\python.exe`". Reinstallation is not required for a missing PATH entry."
    if (-not $AllowPrompt) { throw $Message }
    Write-Host $Message -ForegroundColor Yellow
    $Requested = (Read-Host 'Paste the full path to python.exe (or its folder); press Enter to cancel').Trim()
    if (-not $Requested) { throw 'Python selection cancelled. Install 64-bit Python 3.12 from https://www.python.org/downloads/windows/ if needed.' }
  }
}
