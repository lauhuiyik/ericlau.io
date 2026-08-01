<#
  Registers the Growatt poller as a scheduled task that runs every 5 minutes,
  including while nobody is logged in.

  Run once, in PowerShell *as Administrator*, from the folder holding
  growatt-poller.ps1:

      .\register-growatt-task.ps1

  To remove it later:

      Unregister-ScheduledTask -TaskName 'Growatt poller' -Confirm:$false
#>

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$script = Join-Path $here 'growatt-poller.ps1'
if (-not (Test-Path $script)) { throw "growatt-poller.ps1 not found in $here" }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$script`""

# Starts at boot and repeats forever. RepetitionDuration of MaxValue means it
# keeps going rather than stopping after a day, which is the default trap here.
$trigger = New-ScheduledTaskTrigger -AtStartup
$trigger.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration ([TimeSpan]::MaxValue)).Repetition

$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -MultipleInstances IgnoreNew `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 5)

Register-ScheduledTask -TaskName 'Growatt poller' -Action $action -Trigger $trigger `
    -Settings $settings -RunLevel Highest -User 'SYSTEM' -Force | Out-Null

Write-Host "Registered. Starting it once now to check it works..."
Start-ScheduledTask -TaskName 'Growatt poller'
Start-Sleep -Seconds 10
Get-Content (Join-Path $here 'growatt-poller.log') -Tail 5
