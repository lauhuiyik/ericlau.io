<#
  Growatt poller — runs on a Windows machine on Eric's home network.

  Growatt's open API refuses datacenter IPs with "10011 error_permission_denied".
  Verified with the same token, plant and minute: a home connection returns
  error_code 0, while both the Cloudflare Worker and GitHub Actions are refused,
  and retrying doesn't help. So this one call has to come from the house; the
  rest of the pipeline is unchanged.

  Reads its settings from growatt-poller.config.json sitting next to this file:

      {
        "GrowattToken": "...",
        "PlantId": "549780",
        "IngestSecret": "...",
        "SiteUrl": "https://ericlau.io"
      }

  Deliberately uses only built-in PowerShell — no Python, no modules to install.

  Run it by hand once to check it works (-Force skips the schedule check), then
  every 5 minutes via Task Scheduler. It only reports when a reading is due:
  hourly, or every run while the dashboard's Live mode is on.
#>

param([switch]$Force)

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$configPath = Join-Path $here 'growatt-poller.config.json'
$logPath = Join-Path $here 'growatt-poller.log'

function Write-Log($message) {
    $line = "{0}  {1}" -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $message
    Write-Host $line
    # Keep the log from growing without bound: trim to the last 500 lines
    # whenever it gets long. This runs every 5 minutes, forever.
    Add-Content -Path $logPath -Value $line
    if ((Get-Item $logPath -ErrorAction SilentlyContinue).Length -gt 200KB) {
        $tail = Get-Content $logPath -Tail 500
        Set-Content -Path $logPath -Value $tail
    }
}

if (-not (Test-Path $configPath)) {
    Write-Log "ERROR: no config at $configPath"
    exit 1
}
try {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
} catch {
    # Overwhelmingly the cause is pasting a value over the quotes as well as the
    # placeholder, leaving  "GrowattToken": abc123  instead of  "abc123".
    Write-Log "ERROR: $configPath is not valid JSON. Every value must stay wrapped in double quotes."
    Write-Log "       Rebuild it with:  .\write-growatt-config.ps1"
    Write-Log "       (parser said: $($_.Exception.Message))"
    exit 1
}

foreach ($key in 'GrowattToken', 'PlantId', 'IngestSecret', 'SiteUrl') {
    if (-not $cfg.$key) { Write-Log "ERROR: config is missing $key"; exit 1 }
}

# --- 0. Is a reading due? -------------------------------------------------
# The collector runs hourly unless Live mode is on (the dashboard's "Go live"),
# and /api/ingest only merges a Growatt snapshot under 15 minutes old. So this
# reports in the two runs before each hour's collection (:55 to :05), and
# before the 23:50 closing run, and every run while Live mode is on. The Live
# flag is a public file on media.ericlau.io, served by R2, so checking it
# costs the site nothing. Unreadable = not live.
$now = Get-Date
$due = ($now.Minute -ge 55) -or ($now.Minute -lt 5) -or ($now.Hour -eq 23 -and $now.Minute -ge 40)
if (-not $due -and -not $Force) {
    $live = $false
    try {
        $t = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
        $flag = Invoke-RestMethod -Uri "https://media.ericlau.io/status/energy.json?t=$t" -TimeoutSec 10 -Headers @{ 'Cache-Control' = 'no-cache' }
        $live = [double]$flag.liveUntil -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
    } catch {}
    if (-not $live) {
        # Overwritten, not appended, so the log isn't filled with skips; the
        # installer checks this file to prove the scheduled task runs.
        Set-Content -Path (Join-Path $here 'growatt-poller.last-check') -Value ("{0}  idle: reports between :55 and :05, or every run in Live mode" -f ($now.ToString('yyyy-MM-dd HH:mm:ss')))
        exit 0
    }
}

# --- 1. Ask Growatt -------------------------------------------------------
$url = "https://openapi.growatt.com/v1/plant/data?plant_id=$($cfg.PlantId)"
try {
    $resp = Invoke-RestMethod -Uri $url -Headers @{
        token         = $cfg.GrowattToken
        'user-agent'  = 'ericlau-energy-home/1.0'
    } -TimeoutSec 30
} catch {
    Write-Log "ERROR: Growatt request failed: $($_.Exception.Message)"
    exit 1
}

if ($resp.error_code -ne 0) {
    # 10011 here would mean this machine's IP is refused too; 10012 is the
    # rate limit and is harmless to see occasionally.
    Write-Log "ERROR: Growatt error_code=$($resp.error_code) msg=$($resp.error_msg)"
    exit 1
}

$kw = [double]$resp.data.current_power
$kwh = [double]$resp.data.today_energy
$lastUpdate = [string]$resp.data.last_update_time

# --- 2. Hand it to the site ----------------------------------------------
$payload = @{
    solar_old_kw        = $kw
    solar_old_kwh_today = $kwh
    last_update_time    = $lastUpdate
} | ConvertTo-Json -Compress

try {
    $post = Invoke-RestMethod -Method Post -Uri "$($cfg.SiteUrl)/api/ingest/growatt" -Headers @{
        authorization  = "Bearer $($cfg.IngestSecret)"
        'content-type' = 'application/json'
    } -Body $payload -TimeoutSec 30
} catch {
    Write-Log "ERROR: posting to site failed: $($_.Exception.Message)"
    exit 1
}

if (-not $post.ok) {
    Write-Log "ERROR: site rejected the snapshot: $($post | ConvertTo-Json -Compress)"
    exit 1
}

Write-Log ("OK  {0} kW  {1} kWh today  (inverter last reported {2})" -f $kw, $kwh, $lastUpdate)
