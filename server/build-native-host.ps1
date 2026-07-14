$ErrorActionPreference = "Stop"

$Compiler = "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
$Source = Join-Path $PSScriptRoot "native-host.cs"
$Output = Join-Path $PSScriptRoot "native-host.exe"
if (-not (Test-Path $Compiler)) { throw "The Windows .NET Framework C# compiler was not found." }

& $Compiler /nologo /target:exe /optimize+ /reference:System.Web.Extensions.dll "/out:$Output" $Source
if ($LASTEXITCODE -ne 0) { throw "Compiling the native messaging host failed with code $LASTEXITCODE." }
Write-Host "Built $Output"
