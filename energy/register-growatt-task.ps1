<#
  Registers the Growatt poller to run every 5 minutes.

  Uses schtasks.exe rather than the ScheduledTasks cmdlets. The previous version
  built a New-ScheduledTaskTrigger -AtStartup trigger with a repetition grafted
  onto it, which looks right and silently doesn't work: the repetition only
  begins once the startup trigger fires, so nothing runs until the next reboot.
  Registration "succeeded", the manual test run "succeeded", and collection then
  sat dead for 23 minutes looking like a Growatt outage.

  schtasks /SC MINUTE /MO 5 starts immediately, repeats indefinitely, and
  resumes on its own after a reboot.

  Run as Administrator from the folder holding growatt-poller.ps1.
  To remove:  schtasks /Delete /TN "Growatt poller" /F
#>

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'growatt-poller.ps1'
if (-not (Test-Path $script)) { throw "growatt-poller.ps1 not found in $here" }

$taskName = 'Growatt poller'
$run = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

schtasks /Create /TN $taskName /TR $run /SC MINUTE /MO 5 /RU SYSTEM /RL HIGHEST /F | Out-Null
if ($LASTEXITCODE -ne 0) { throw "schtasks failed with exit code $LASTEXITCODE" }
Write-Host "Registered '$taskName' - every 5 minutes, as SYSTEM, survives reboot."

# Prove it actually runs. Registration succeeding is not evidence that the
# schedule works, which is exactly how the previous version slipped through.
$logPath = Join-Path $here 'growatt-poller.log'
$before = if (Test-Path $logPath) { (Get-Item $logPath).LastWriteTimeUtc } else { [datetime]::MinValue }

Write-Host 'Running it once now to verify...'
schtasks /Run /TN $taskName | Out-Null

$deadline = (Get-Date).AddSeconds(60)
while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 3
    if ((Test-Path $logPath) -and (Get-Item $logPath).LastWriteTimeUtc -gt $before) {
        Write-Host ''
        Get-Content $logPath -Tail 3
        if ((Get-Content $logPath -Tail 1) -match 'OK') {
            Write-Host ''
            Write-Host 'Working. Next run within 5 minutes.'
        } else {
            Write-Host ''
            Write-Host 'It ran but reported a problem - see the line above.'
        }
        exit 0
    }
}

Write-Warning "Registered, but no log appeared within 60s. Check with: schtasks /Query /TN `"$taskName`" /V /FO LIST"
