@echo off
rem Double-click to install (or upgrade) the ericlau.io downloader agent.
setlocal
if not exist "%~dp0install.ps1" (
  echo.
  echo   Please extract the zip first: right-click it, choose "Extract All",
  echo   then double-click Install.cmd inside the extracted folder.
  echo.
  pause
  exit /b 1
)
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" %*
echo.
pause
