<#
  Writes growatt-poller.config.json correctly.

  Hand-editing the JSON is error-prone: pasting a secret over the placeholder
  usually swallows the surrounding quotes too, and PowerShell then reports
  "Invalid JSON primitive" with the secret echoed into the error. Prompting and
  letting ConvertTo-Json do the quoting removes both problems.

  Run from the folder holding growatt-poller.ps1:

      powershell -NoProfile -ExecutionPolicy Bypass -File .\write-growatt-config.ps1
#>

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$token = (Read-Host 'Growatt API token').Trim()
$secret = (Read-Host 'Ingest secret').Trim()
if (-not $token -or -not $secret) { throw 'Both values are required.' }

[ordered]@{
    GrowattToken = $token
    PlantId      = '549780'
    IngestSecret = $secret
    SiteUrl      = 'https://ericlau.io'
} | ConvertTo-Json | Set-Content -Path (Join-Path $here 'growatt-poller.config.json') -Encoding UTF8

Write-Host 'Wrote growatt-poller.config.json.'
