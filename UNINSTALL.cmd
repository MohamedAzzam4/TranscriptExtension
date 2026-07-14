@echo off
setlocal
title Dub Transcript Lab - Uninstall
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\uninstall.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
pause
exit /b %RESULT%
