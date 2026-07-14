@echo off
setlocal
title Dub Transcript Lab - Setup Check
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\verify-setup.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
