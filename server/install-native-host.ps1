param(
  [string]$ExtensionId = "dnllioiahdlnncdojpgjaeklbkfkcbnk",
  [string]$Executable = ""
)

$ErrorActionPreference = "Stop"
$HostName = "com.dub_transcript_lab.recognizer"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
if (-not $Executable) { $Executable = Join-Path $PSScriptRoot "native-host.exe" }
$Executable = [System.IO.Path]::GetFullPath($Executable)
$RuntimeDirectory = Join-Path $ProjectRoot ".runtime\native-host"
$ManifestPath = Join-Path $RuntimeDirectory "$HostName.json"

if ($ExtensionId -notmatch '^[a-p]{32}$') { throw "Invalid Chrome/Edge extension ID: $ExtensionId" }
if (-not (Test-Path $Executable)) { throw "Build native-host.exe before installing the host." }
New-Item -ItemType Directory -Force -Path $RuntimeDirectory | Out-Null

$Manifest = [ordered]@{
  name = $HostName
  description = "Starts the local Dub Transcript Lab recognizer"
  path = $Executable
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtensionId/")
}
$ManifestJson = $Manifest | ConvertTo-Json -Depth 4
[System.IO.File]::WriteAllText(
  $ManifestPath,
  $ManifestJson,
  (New-Object System.Text.UTF8Encoding($false))
)

$RegistryKeys = @(
  "HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\$HostName",
  "HKCU:\Software\Google\Chrome\NativeMessagingHosts\$HostName"
)
foreach ($RegistryKey in $RegistryKeys) {
  New-Item -Path $RegistryKey -Force | Out-Null
  Set-Item -Path $RegistryKey -Value $ManifestPath
}

Write-Host "Registered $HostName for extension $ExtensionId in Edge and Chrome."
