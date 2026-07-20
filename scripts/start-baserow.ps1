#Requires -Version 5.1
<#
.SYNOPSIS
  Start Baserow community edition processes on Windows (no Docker).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BaserowRoot = Join-Path $Root "services\baserow"
$PluginRoot = Join-Path $Root "integrations\baserow\liangce_sso"
$VenvPython = Join-Path $BaserowRoot ".venv\Scripts\python.exe"
$EnvFile = Join-Path $BaserowRoot ".env.liangce"
$LogDir = Join-Path $BaserowRoot ".liangce-run"
$PidFile = Join-Path $LogDir "pids.json"

if (-not (Test-Path $VenvPython)) { throw "Run setup-baserow.ps1 first (missing venv)." }
if (-not (Test-Path $EnvFile)) { throw "Missing $EnvFile" }

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Import-DotEnv([string]$path) {
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim()
    if ($v.StartsWith('"') -and $v.EndsWith('"')) { $v = $v.Substring(1, $v.Length - 2) }
    Set-Item -Path "Env:$k" -Value $v
  }
}

Import-DotEnv $EnvFile

# Merge Liangce backend/.env for shared Postgres + SSO secret if missing
$LiangceEnv = Join-Path $Root "backend\.env"
if (Test-Path $LiangceEnv) {
  $le = @{}
  Get-Content $LiangceEnv | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $le[$line.Substring(0, $i).Trim()] = $line.Substring($i + 1).Trim()
  }
  if ((-not $env:DATABASE_HOST -or $env:DATABASE_HOST -eq "change-me") -and $le["POSTGRES_HOST"]) { $env:DATABASE_HOST = $le["POSTGRES_HOST"] }
  if ((-not $env:DATABASE_PORT -or $env:DATABASE_PORT -eq "change-me") -and $le["POSTGRES_PORT"]) { $env:DATABASE_PORT = $le["POSTGRES_PORT"] }
  if ((-not $env:DATABASE_USER -or $env:DATABASE_USER -eq "change-me") -and $le["POSTGRES_USER"]) { $env:DATABASE_USER = $le["POSTGRES_USER"] }
  if ((-not $env:DATABASE_PASSWORD -or $env:DATABASE_PASSWORD -eq "change-me") -and $le["POSTGRES_PASSWORD"]) { $env:DATABASE_PASSWORD = $le["POSTGRES_PASSWORD"] }
  if (-not $env:DATABASE_NAME) { $env:DATABASE_NAME = "liangce_baserow" }
  if ((-not $env:LIANGCE_SSO_SHARED_SECRET -or $env:LIANGCE_SSO_SHARED_SECRET.StartsWith("change-me")) -and $le["BASEROW_SSO_SHARED_SECRET"]) {
    $env:LIANGCE_SSO_SHARED_SECRET = $le["BASEROW_SSO_SHARED_SECRET"]
  }
  if ((-not $env:DATABASE_URL -or $env:DATABASE_URL.Contains("change-me")) -and $env:DATABASE_HOST -and $env:DATABASE_PASSWORD) {
    $enc = [uri]::EscapeDataString($env:DATABASE_PASSWORD)
    $env:DATABASE_URL = "postgresql://$($env:DATABASE_USER):$enc@$($env:DATABASE_HOST):$($env:DATABASE_PORT)/$($env:DATABASE_NAME)"
  }
}

# Replace example placeholder with a local shared secret.
if (-not $env:LIANGCE_SSO_SHARED_SECRET -or $env:LIANGCE_SSO_SHARED_SECRET.StartsWith("change-me")) {
  $env:LIANGCE_SSO_SHARED_SECRET = -join ((48..57 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
  $envRaw = Get-Content $EnvFile -Raw
  $envRaw = [regex]::Replace(
    $envRaw,
    "(?m)^LIANGCE_SSO_SHARED_SECRET=.*$",
    "LIANGCE_SSO_SHARED_SECRET=$($env:LIANGCE_SSO_SHARED_SECRET)"
  )
  [System.IO.File]::WriteAllText($EnvFile, $envRaw, (New-Object System.Text.UTF8Encoding $false))
}

# Ensure platform .env has matching SSO secret
if ($env:LIANGCE_SSO_SHARED_SECRET -and (Test-Path $LiangceEnv)) {
  $raw = Get-Content $LiangceEnv -Raw
  if ($raw -notmatch "BASEROW_SSO_SHARED_SECRET=") {
    Add-Content -Path $LiangceEnv -Value "`nBASEROW_PUBLIC_URL=http://127.0.0.1:3001`nBASEROW_BACKEND_URL=http://127.0.0.1:8001`nBASEROW_SSO_SHARED_SECRET=$($env:LIANGCE_SSO_SHARED_SECRET)"
  } else {
    $raw = [regex]::Replace(
      $raw,
      "(?m)^BASEROW_SSO_SHARED_SECRET=.*$",
      "BASEROW_SSO_SHARED_SECRET=$($env:LIANGCE_SSO_SHARED_SECRET)"
    )
    [System.IO.File]::WriteAllText($LiangceEnv, $raw, (New-Object System.Text.UTF8Encoding $false))
  }
}

# Prefer portable Redis shipped under services/baserow/tools if present
$portableRedis = Get-ChildItem (Join-Path $BaserowRoot "tools") -Recurse -Filter "redis-server.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($portableRedis) {
  $redisAlready = $false
  try {
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
    $redisAlready = [bool]$tcp.TcpTestSucceeded
  } catch { $redisAlready = $false }
  if (-not $redisAlready) {
    Write-Host "Starting portable Redis: $($portableRedis.FullName)"
    Start-Process -FilePath $portableRedis.FullName -ArgumentList "--port","6379" -WindowStyle Hidden
    Start-Sleep -Seconds 2
  }
}
$modulePath = (Join-Path $PluginRoot "web-frontend\modules\liangce-sso\module.js")
$env:ADDITIONAL_MODULES = $modulePath.Replace("\", "/")
$env:BASEROW_OSS_ONLY = "yes"
$env:LIANGCE_EMBEDDED_MODE = "yes"
$env:DJANGO_SETTINGS_MODULE = "liangce_sso.settings"
$env:BASEROW_ENABLE_SILK = if ($env:BASEROW_ENABLE_SILK) { $env:BASEROW_ENABLE_SILK } else { "off" }
$env:BASEROW_BACKEND_DEBUG = "on"
$env:PYTHONPATH = @(
  (Join-Path $BaserowRoot "backend\src"),
  (Join-Path $PluginRoot "backend\src"),
  $env:PYTHONPATH
) -join ";"

# Celery Windows compatibility
$env:CELERY_POOL = if ($env:CELERY_POOL) { $env:CELERY_POOL } else { "solo" }

# Ensure SSO plugin installed
& $VenvPython -m pip install -e (Join-Path $PluginRoot "backend") | Out-Null

Write-Host "Migrating Baserow DB..." -ForegroundColor Cyan
Push-Location (Join-Path $BaserowRoot "backend")
try {
  $BaserowCli = Join-Path $BaserowRoot ".venv\Scripts\baserow.exe"
  & $BaserowCli migrate
  if ($LASTEXITCODE -ne 0) { throw "migrate failed" }
} finally { Pop-Location }

function Start-LoggedProcess([string]$name, [string]$file, [string[]]$argList, [string]$workDir) {
  $out = Join-Path $LogDir "$name.out.log"
  $err = Join-Path $LogDir "$name.err.log"
  $p = Start-Process -FilePath $file -ArgumentList $argList -WorkingDirectory $workDir `
    -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -WindowStyle Hidden
  Write-Host ("Started {0} pid={1}" -f $name, $p.Id)
  return @{ name = $name; pid = $p.Id; out = $out; err = $err }
}

$pids = @()

# Django / Daphne-ish runserver
$bind = if ($env:BASEROW_RUNSERVER_BIND) { $env:BASEROW_RUNSERVER_BIND } else { "0.0.0.0:8001" }
$BaserowCli = Join-Path $BaserowRoot ".venv\Scripts\baserow.exe"
$pids += Start-LoggedProcess "backend" $BaserowCli @(
  "runserver", $bind
) (Join-Path $BaserowRoot "backend")

# Celery workers (Windows: solo pool)
$celeryPyArgs = @("-m", "celery", "-A", "baserow")
$pids += Start-LoggedProcess "celery" $VenvPython (
  $celeryPyArgs + @("worker", "--loglevel=INFO", "--pool=solo", "-Q", "celery,automation_workflow")
) (Join-Path $BaserowRoot "backend")

$pids += Start-LoggedProcess "celery-export" $VenvPython (
  $celeryPyArgs + @("worker", "--loglevel=INFO", "--pool=solo", "-Q", "export")
) (Join-Path $BaserowRoot "backend")

$pids += Start-LoggedProcess "celery-beat" $VenvPython (
  $celeryPyArgs + @("beat", "--loglevel=INFO", "-S", "redbeat.RedBeatScheduler")
) (Join-Path $BaserowRoot "backend")

# Nuxt frontend
$nuxtPort = if ($env:BASEROW_NUXT_PORT) { $env:BASEROW_NUXT_PORT } else { "3001" }
$nuxtHost = if ($env:BASEROW_NUXT_HOST) { $env:BASEROW_NUXT_HOST } else { "0.0.0.0" }
$env:APP_ENV = "dev"
$node = (Get-Command node).Source
$nuxtCli = Join-Path $BaserowRoot "web-frontend\node_modules\nuxt\bin\nuxt.mjs"
$pids += Start-LoggedProcess "web-frontend" $node @(
  "--import", "./env-remap.mjs",
  $nuxtCli, "dev", "--host", $nuxtHost, "--port", $nuxtPort
) (Join-Path $BaserowRoot "web-frontend")

($pids | ConvertTo-Json -Depth 4) | Set-Content -Path $PidFile -Encoding UTF8

Write-Host ""
Write-Host "Baserow starting:" -ForegroundColor Green
Write-Host "  Frontend: http://127.0.0.1:$nuxtPort"
Write-Host "  Backend:  http://127.0.0.1:8001"
Write-Host "  Logs:     $LogDir"
Write-Host "  Stop:     .\\scripts\\stop-baserow.ps1"
