#Requires -Version 5.1
$ErrorActionPreference = "Continue"
$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root "services\baserow\.liangce-run\pids.json"

if (-not (Test-Path $PidFile)) {
  Write-Host "No pid file found."
  exit 0
}

$items = Get-Content $PidFile -Raw | ConvertFrom-Json
foreach ($item in @($items)) {
  try {
    $p = Get-Process -Id $item.pid -ErrorAction Stop
    Write-Host "Stopping $($item.name) pid=$($item.pid)"
    Stop-Process -Id $item.pid -Force
  } catch {
    Write-Host "Already stopped $($item.name) pid=$($item.pid)"
  }
}

Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
Write-Host "Stopped." -ForegroundColor Green
