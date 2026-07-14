@echo off
setlocal
title Dub Transcript Lab - Beginner Setup
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0server\install.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
if not "%RESULT%"=="0" echo Setup did not finish. Read the error above, then run INSTALL.cmd again.
pause
exit /b %RESULT%
