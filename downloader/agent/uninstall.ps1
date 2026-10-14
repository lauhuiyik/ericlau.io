<#
  Removes the ericlau.io downloader agent: stops it, deletes the scheduled
  task and %LOCALAPPDATA%\EricLauDownloader. Downloaded files in the
  "Web Downloads" folder are left alone. ASCII-only (see install.ps1).
#>
$ErrorActionPreference = "Stop"
$AppName  = "EricLauDownloader"
$TaskName = "EricLau Downloader Agent"
$App      = Join-Path $env:LOCALAPPDATA $AppName

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
  exit 0
} catch {
  Write-Host "Uninstall failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
