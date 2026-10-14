<#
  Removes the ericlau.io downloader agent: stops it, deletes the scheduled
  task and %LOCALAPPDATA%\EricLauDownloader. Downloaded files in the
  "Web Downloads" folder are left alone. ASCII-only (see install.ps1).

  The start-at-boot task is created with admin rights, so removing it needs
  them too: run normally, this relaunches itself elevated, passing the
  install folder along in case the admin account is a different user.
#>
param([string]$App = (Join-Path $env:LOCALAPPDATA "EricLauDownloader"))

$ErrorActionPreference = "Stop"
$TaskName = "EricLau Downloader Agent"
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
  try {
    Start-Process -FilePath "powershell.exe" -Verb RunAs -Wait -ArgumentList @(
      "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "`"$PSCommandPath`"", "-App", "`"$App`"") | Out-Null
    if (-not (Test-Path $App)) {
      Write-Host "Uninstalled. Disconnect the PC on the downloader page to revoke its key." -ForegroundColor Green
      exit 0
    }
    Write-Host "Uninstall didn't finish: see the message in the admin window." -ForegroundColor Red
    exit 1
  } catch {
    Write-Host "No admin approval: removing what this account can." -ForegroundColor Yellow
  }
}

try {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  # Match on executable path (see install.ps1): the Uninstall.cmd window has
  # "EricLauDownloader" in its command line too.
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$App\", [StringComparison]::OrdinalIgnoreCase) } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  # This script may live inside $App itself; Windows lets us delete it while it runs.
  Remove-Item -Recurse -Force $App -ErrorAction SilentlyContinue
  Write-Host "Uninstalled. Disconnect the PC on the downloader page to revoke its key." -ForegroundColor Green
  if ($isAdmin) { Start-Sleep -Seconds 3 }  # the elevated window closes as soon as this exits
  exit 0
} catch {
  Write-Host "Uninstall failed: $($_.Exception.Message)" -ForegroundColor Red
  Start-Sleep -Seconds 6
  exit 1
}
