@echo off
rem Double-click to remove the ericlau.io downloader agent from this PC.
setlocal
set "SCRIPT=%~dp0uninstall.ps1"
if not exist "%SCRIPT%" set "SCRIPT=%LOCALAPPDATA%\EricLauDownloader\uninstall.ps1"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
echo.
pause
