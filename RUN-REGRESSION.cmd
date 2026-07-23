@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\run-regression.ps1"
if errorlevel 1 (
  echo.
  echo Regression checks failed.
  pause
  exit /b 1
)
echo.
echo Regression checks passed. Complete the manual browser checklist before release.
pause
