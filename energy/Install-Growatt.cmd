@echo off
title Growatt poller - setup
setlocal EnableExtensions

rem ---------------------------------------------------------------------------
rem  One double-click install for the Growatt home poller.
rem
rem  Growatt's API refuses datacenter IPs (10011 error_permission_denied), so
rem  this one call has to originate from the house. This sets up a machine on
rem  the home network to fetch the reading every 5 minutes and post it to
rem  ericlau.io, which is the only piece the cloud can't do itself.
rem
rem  Self-elevates, fetches the scripts, prompts for the two secrets, does a
rem  test run, then registers the scheduled task.
rem ---------------------------------------------------------------------------

net session >nul 2>&1
if errorlevel 1 (
  echo Administrator rights are needed to register the scheduled task.
  echo Re-launching...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

set "TARGET=C:\energy"
set "BASE=https://raw.githubusercontent.com/lauhuiyik/ericlau.io/main/energy"

if not exist "%TARGET%" mkdir "%TARGET%"
cd /d "%TARGET%"

echo.
echo === 1 of 4  Downloading scripts to %TARGET% ===
for %%F in (growatt-poller.ps1 write-growatt-config.ps1 register-growatt-task.ps1) do (
  curl.exe -fsSL -o "%TARGET%\%%F" "%BASE%/%%F"
  if errorlevel 1 (
    echo    FAILED to download %%F
    goto :fail
  )
  echo    got %%F
)

echo.
echo === 2 of 4  Settings ===
echo Paste the two values from .dev.vars on the Mac.
echo GROWATT_API_TOKEN first, then INGEST_SECRET.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\write-growatt-config.ps1"
if errorlevel 1 goto :fail

echo.
echo === 3 of 4  Test run ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\growatt-poller.ps1"
if errorlevel 1 goto :fail

echo.
echo === 4 of 4  Scheduling it every 5 minutes ===
powershell -NoProfile -ExecutionPolicy Bypass -File "%TARGET%\register-growatt-task.ps1"
if errorlevel 1 goto :fail

echo.
echo ---------------------------------------------------------------
echo  Done. Runs every 5 minutes, including after a reboot.
echo  Log:  %TARGET%\growatt-poller.log
echo ---------------------------------------------------------------
echo.
pause
exit /b 0

:fail
echo.
echo ---------------------------------------------------------------
echo  Stopped on the error above. Nothing further was changed.
echo  Re-run this file once it's sorted.
echo ---------------------------------------------------------------
echo.
pause
exit /b 1
