<#
  Registers (or replaces) the scheduled task that runs the downloader agent
  hidden, restarting it if it crashes, and starts it now.

    -Mode Boot   start when Windows boots, before anyone logs in, so the PC
                 keeps working after an overnight Windows Update restart.
                 Runs as -User via S4U ("run whether user is logged on or
                 not", no password stored). Needs admin: install.ps1 runs
                 this elevated. Also keeps a logon trigger as a fallback.
    -Mode Logon  start when -User logs in. No admin needed.

  If Windows won't start a Boot task (e.g. the account lacks the "log on as
  a batch job" right), it falls back to Logon. The outcome is written to
  <App>\task-mode.txt (Boot, Logon or Failed) for install.ps1 to read:
  exit codes from an elevated process aren't reliable in PowerShell 5.1.

  ASCII-only (see install.ps1).
#>
param(
  [Parameter(Mandatory = $true)][string]$User,
  [Parameter(Mandatory = $true)][string]$App,
  [string]$Server = "https://ericlau.io",
  [ValidateSet("Boot", "Logon")][string]$Mode = "Boot"
)

$ErrorActionPreference = "Stop"
$TaskName = "EricLau Downloader Agent"
$Pythonw  = Join-Path $App "python\pythonw.exe"
$Agent    = Join-Path $App "dl_agent.py"
$Result   = Join-Path $App "task-mode.txt"

function Get-AgentProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$App\", [StringComparison]::OrdinalIgnoreCase) }
}

function Register-AgentTask([string]$TaskMode) {
  $action = New-ScheduledTaskAction -Execute $Pythonw -Argument "`"$Agent`"" -WorkingDirectory $App
  $triggers = @(New-ScheduledTaskTrigger -AtLogOn -User $User)
  if ($TaskMode -eq "Boot") {
    $triggers = @(New-ScheduledTaskTrigger -AtStartup) + $triggers
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType S4U -RunLevel Limited
  } else {
    $principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited
  }
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers -Settings $settings `
    -Principal $principal -Description "Downloads links queued at $Server/tools/downloader" -Force | Out-Null
}

# Stops any running copy (it may be an older version) and starts the task fresh.
function Restart-Agent {
  Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  Get-AgentProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 1
  Start-ScheduledTask -TaskName $TaskName
  for ($i = 0; $i -lt 12; $i++) {
    Start-Sleep -Seconds 1
    if (Get-AgentProcesses | Where-Object { $_.Name -eq "pythonw.exe" }) { return $true }
  }
  return $false
}

function Set-Result([string]$Value) {
  Set-Content -Path $Result -Value $Value -Encoding ASCII
}

try {
  if ($Mode -eq "Boot") {
    Register-AgentTask "Boot"
    if (Restart-Agent) { Set-Result "Boot"; exit 0 }
    Write-Host "Windows wouldn't start the agent before login; using start-at-login instead."
  }
  Register-AgentTask "Logon"
  if (Restart-Agent) { Set-Result "Logon"; exit 0 }
  Set-Result "Failed"
  exit 1
} catch {
  Write-Host "Couldn't set up the background task: $($_.Exception.Message)" -ForegroundColor Red
  try { Set-Result "Failed" } catch {}
  Start-Sleep -Seconds 6
  exit 1
}
