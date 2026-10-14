<#
  Installs the ericlau.io downloader agent for the current Windows user.

  Everything goes in %LOCALAPPDATA%\EricLauDownloader (no admin rights):
    python\   Python embeddable package (private copy, pinned + checksum-verified)
    bin\      yt-dlp.exe, ffmpeg.exe, ffprobe.exe, deno.exe (checksum-verified)
    dl_agent.py, config.json (server + connection key), agent.log

  A scheduled task starts the agent hidden at logon and restarts it if it
  crashes. Re-running this script upgrades in place and keeps the key.

  Keep this file ASCII-only: Windows PowerShell 5.1 reads BOM-less scripts
  as ANSI, so a stray Unicode character breaks parsing.
#>
param(
  [string]$Key = "",
  [string]$Server = "https://ericlau.io",
  # Re-download ffmpeg and deno even if they're already installed.
  [switch]$Refresh
)

$ErrorActionPreference = "Stop"
# Invoke-WebRequest is many times slower with the progress bar on in PS 5.1.
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$AppName  = "EricLauDownloader"
$TaskName = "EricLau Downloader Agent"
$App      = Join-Path $env:LOCALAPPDATA $AppName
$Bin      = Join-Path $App "bin"
$Py       = Join-Path $App "python"
$Here     = Split-Path -Parent $MyInvocation.MyCommand.Path
$Tmp      = Join-Path $env:TEMP "$AppName-setup"

$PythonVersion = "3.13.16"
$PythonSha256  = "97dae5274cc54867065e8d5a3226e48c35017ed332a0fdb0e27d5b5821961297"

function Step([string]$Msg) { Write-Host ""; Write-Host "==> $Msg" -ForegroundColor Cyan }
function Ok([string]$Msg) { Write-Host "    $Msg" -ForegroundColor Green }
function Note([string]$Msg) { Write-Host "    $Msg" -ForegroundColor Yellow }

function Get-File([string]$Url, [string]$OutFile) {
  for ($i = 1; $i -le 3; $i++) {
    try {
      Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
      return
    } catch {
      if ($i -eq 3) { throw "Download failed: $Url ($($_.Exception.Message))" }
      Start-Sleep -Seconds (3 * $i)
    }
  }
}

# Finds FileName's SHA-256 in a checksum list ("<hash>  <name>" lines), or
# the only hash in the file (Deno publishes one per asset).
function Get-ExpectedHash([string]$SumsText, [string]$FileName) {
  foreach ($line in ($SumsText -split "`r?`n")) {
    if ($line -match '^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$') {
      if ((Split-Path -Leaf $Matches[2]) -eq $FileName) { return $Matches[1].ToLower() }
    }
  }
  $all = [regex]::Matches($SumsText, '[0-9a-fA-F]{64}')
  if ($all.Count -eq 1) { return $all[0].Value.ToLower() }
  throw "No checksum listed for $FileName"
}

function Assert-Hash([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -Algorithm SHA256 -Path $Path).Hash.ToLower()
  if ($actual -ne $Expected.ToLower()) {
    throw "Checksum mismatch for $(Split-Path -Leaf $Path): the download may be corrupt. Run Install.cmd again."
  }
}

# Downloads Url + its checksum list, verifies, returns the local path.
function Get-Verified([string]$Url, [string]$SumsUrl, [string]$FileName) {
  $sumsPath = Join-Path $Tmp "$FileName.sums"
  Get-File $SumsUrl $sumsPath
  $expected = Get-ExpectedHash (Get-Content -Raw -Path $sumsPath) $FileName
  $out = Join-Path $Tmp $FileName
  Get-File $Url $out
  Assert-Hash $out $expected
  return $out
}

function Get-DownloadsFolder {
  try {
    $p = (New-Object -ComObject Shell.Application).NameSpace("shell:Downloads").Self.Path
    if ($p -and (Test-Path $p)) { return $p }
  } catch {}
  return (Join-Path $env:USERPROFILE "Downloads")
}

# Processes started from the install folder (pythonw agent, yt-dlp, ffmpeg, deno).
# Matched on the executable's path, not the command line: the installer's own
# window also has "EricLauDownloader" in its command line.
function Get-AgentProcesses {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith("$App\", [StringComparison]::OrdinalIgnoreCase) }
}

function Stop-Agent {
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  }
  Get-AgentProcesses | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Milliseconds 500
}

try {
  Write-Host ""
  Write-Host "EricLau Downloader - home PC agent installer" -ForegroundColor White
  Write-Host "Installs to $App (just for $env:USERNAME, no admin needed)."

  if (-not [Environment]::Is64BitOperatingSystem) { throw "This needs 64-bit Windows 10 or 11." }
  if (-not (Test-Path (Join-Path $Here "dl_agent.py"))) {
    throw "dl_agent.py is missing next to install.ps1. Extract the whole zip first."
  }

  Step "Preparing"
  Stop-Agent
  New-Item -ItemType Directory -Force -Path $App, $Bin | Out-Null
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  Ok "ready"

  # ---- Python (embeddable package: no installer, no PATH changes) ----
  Step "Python $PythonVersion"
  $stamp = Join-Path $Py ".version"
  if ((Test-Path (Join-Path $Py "pythonw.exe")) -and (Test-Path $stamp) -and
      ((Get-Content -Raw $stamp).Trim() -eq $PythonVersion)) {
    Ok "already installed"
  } else {
    $zip = Join-Path $Tmp "python.zip"
    Get-File "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip" $zip
    Assert-Hash $zip $PythonSha256
    Remove-Item -Recurse -Force $Py -ErrorAction SilentlyContinue
    Expand-Archive -Path $zip -DestinationPath $Py -Force
    Set-Content -Path $stamp -Value $PythonVersion -Encoding ASCII
    Ok "installed"
  }

  # ---- yt-dlp (always the latest; the agent also self-updates daily) ----
  Step "yt-dlp"
  $exe = Get-Verified "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe" `
                      "https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS" "yt-dlp.exe"
  Copy-Item $exe (Join-Path $Bin "yt-dlp.exe") -Force
  Ok "installed $(& (Join-Path $Bin 'yt-dlp.exe') --version)"

  # ---- ffmpeg + ffprobe (yt-dlp's own builds) ----
  Step "ffmpeg (about 200 MB, first install only)"
  if (-not $Refresh -and (Test-Path (Join-Path $Bin "ffmpeg.exe")) -and (Test-Path (Join-Path $Bin "ffprobe.exe"))) {
    Ok "already installed"
  } else {
    $name = "ffmpeg-master-latest-win64-gpl.zip"
    $zip = Get-Verified "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/$name" `
                        "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/checksums.sha256" $name
    $dir = Join-Path $Tmp "ffmpeg"
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    foreach ($tool in @("ffmpeg.exe", "ffprobe.exe")) {
      $found = Get-ChildItem -Path $dir -Recurse -Filter $tool | Select-Object -First 1
      if (-not $found) { throw "$tool not found in the ffmpeg download" }
      Copy-Item $found.FullName (Join-Path $Bin $tool) -Force
    }
    Ok "installed"
  }

  # ---- Deno (yt-dlp needs a JavaScript runtime for YouTube) ----
  Step "Deno (for YouTube)"
  if (-not $Refresh -and (Test-Path (Join-Path $Bin "deno.exe"))) {
    Ok "already installed"
  } else {
    $name = "deno-x86_64-pc-windows-msvc.zip"
    $zip = Get-Verified "https://github.com/denoland/deno/releases/latest/download/$name" `
                        "https://github.com/denoland/deno/releases/latest/download/$name.sha256sum" $name
    $dir = Join-Path $Tmp "deno"
    Expand-Archive -Path $zip -DestinationPath $dir -Force
    Copy-Item (Join-Path $dir "deno.exe") (Join-Path $Bin "deno.exe") -Force
    Ok "installed"
  }

  # ---- the agent ----
  Step "Agent"
  Copy-Item (Join-Path $Here "dl_agent.py") (Join-Path $App "dl_agent.py") -Force
  Copy-Item (Join-Path $Here "uninstall.ps1") (Join-Path $App "uninstall.ps1") -Force -ErrorAction SilentlyContinue
  Get-ChildItem -Path $App -Recurse -File | Unblock-File -ErrorAction SilentlyContinue
  Ok "copied"

  # ---- config + connection key ----
  Step "Connection key"
  $cfgPath = Join-Path $App "config.json"
  $old = $null
  if (Test-Path $cfgPath) { $old = Get-Content -Raw $cfgPath | ConvertFrom-Json }
  if (-not $Key -and $old -and $old.key) { $Key = $old.key; Ok "keeping the existing key" }

  $python = Join-Path $Py "python.exe"
  $agent = Join-Path $App "dl_agent.py"
  for ($attempt = 1; ; $attempt++) {
    while (-not $Key) {
      Write-Host ""
      Write-Host "    Open $Server/experiments/downloader, go to PC setup > Create key,"
      Write-Host "    then paste the key here (right-click pastes in this window)."
      $Key = (Read-Host "    Key").Trim()
      if ($Key -notmatch '^dla_[A-Za-z0-9_-]{20,100}$') {
        Note "That doesn't look like a connection key (they start with dla_)."
        $Key = ""
      }
    }

    $cfg = [ordered]@{
      server          = $Server
      key             = $Key
      concurrency     = 2
      save_dir        = (Join-Path (Get-DownloadsFolder) "Web Downloads")
      keep_local_copy = $true
      auto_update     = $true
    }
    if ($old) {
      foreach ($k in @("concurrency", "save_dir", "keep_local_copy", "auto_update")) {
        if ($old.PSObject.Properties[$k]) { $cfg[$k] = $old.$k }
      }
    }
    # UTF-8 without a BOM.
    [IO.File]::WriteAllText($cfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))

    Write-Host ""
    # PS 5.1 turns a native program's stderr into errors under "Stop"; relax it for this call.
    $ErrorActionPreference = "Continue"
    $output = & $python $agent --check 2>&1 | Out-String
    $checkExit = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    $output.TrimEnd() -split "`r?`n" | ForEach-Object { Write-Host "    $_" }
    if ($checkExit -eq 0) { Ok "connected to $Server"; break }
    if ($output -match "REJECTED" -and $attempt -lt 3) {
      Note "The site didn't accept that key. Create a new one on the page and paste it."
      $Key = ""
      continue
    }
    throw "The setup check failed (see above)."
  }

  # ---- start at logon, hidden, restart on crash ----
  Step "Background task"
  $user = "$env:USERDOMAIN\$env:USERNAME"
  $action = New-ScheduledTaskAction -Execute (Join-Path $Py "pythonw.exe") -Argument "`"$agent`"" -WorkingDirectory $App
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
    -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings `
    -Principal $principal -Description "Downloads links queued at $Server/experiments/downloader" -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Start-Sleep -Seconds 4
  $running = Get-AgentProcesses | Where-Object { $_.Name -eq "pythonw.exe" }
  if ($running) { Ok "running (starts automatically when you log in)" }
  else { Note "registered, but it didn't start yet. Check $App\agent.log, or log out and back in." }

  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue

  Write-Host ""
  Write-Host "Done. This PC should now show as online at $Server/experiments/downloader" -ForegroundColor Green
  Write-Host "Copies of finished downloads also go to: $($cfg.save_dir)"
  Write-Host "Log: $App\agent.log    Uninstall: $App\uninstall.ps1"
  exit 0
} catch {
  Write-Host ""
  Write-Host "Install failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
