#Requires -Version 5.1
<#
.SYNOPSIS
  Create liangce_baserow database on the shared PostgreSQL server.
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$EnvFile = Join-Path $Root "services\baserow\.env.liangce"
$LiangceEnv = Join-Path $Root "backend\.env"

function Read-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  Get-Content $path | ForEach-Object {
    $line = $_.Trim()
    if (-not $line -or $line.StartsWith("#")) { return }
    $i = $line.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $line.Substring(0, $i).Trim()
    $v = $line.Substring($i + 1).Trim().Trim('"').Trim("'")
    $map[$k] = $v
  }
  return $map
}

$be = Read-DotEnv $EnvFile
$le = Read-DotEnv $LiangceEnv

$hostName = $be["DATABASE_HOST"]; if (-not $hostName) { $hostName = $le["POSTGRES_HOST"] }
$port = $be["DATABASE_PORT"]; if (-not $port) { $port = $le["POSTGRES_PORT"]; if (-not $port) { $port = "5432" } }
$user = $be["DATABASE_USER"]; if (-not $user) { $user = $le["POSTGRES_USER"]; if (-not $user) { $user = "postgres" } }
$password = $be["DATABASE_PASSWORD"]; if (-not $password) { $password = $le["POSTGRES_PASSWORD"] }
$dbName = $be["DATABASE_NAME"]; if (-not $dbName) { $dbName = "liangce_baserow" }

if (-not $hostName -or -not $password) {
  throw "Missing DATABASE_HOST/PASSWORD. Fill services/baserow/.env.liangce first."
}

Write-Host "Creating database '$dbName' on ${hostName}:${port} ..."

$py = & py -3.14 -c "import sys; print(sys.executable)"
$code = @"
import psycopg2
conn = psycopg2.connect(host='$hostName', port=$port, user='$user', password='''$password''', dbname='postgres')
conn.autocommit = True
with conn.cursor() as cur:
    cur.execute("SELECT 1 FROM pg_database WHERE datname = %s", ('$dbName',))
    if cur.fetchone():
        print('exists')
    else:
        cur.execute('CREATE DATABASE "$dbName"')
        print('created')
conn.close()
"@

# Prefer existing Liangce venv psycopg if available
$candidates = @(
  (Join-Path $Root "backend\.venv\Scripts\python.exe"),
  (Join-Path $Root "services\baserow\.venv\Scripts\python.exe"),
  $py
)
$ran = $false
foreach ($python in $candidates) {
  if (-not (Test-Path $python)) { continue }
  try {
    & $python -c "import psycopg2" 2>$null
    if ($LASTEXITCODE -ne 0) { continue }
    & $python -c $code
    $ran = $true
    break
  } catch { continue }
}

if (-not $ran) {
  Write-Host "Installing psycopg2-binary temporarily..."
  & $py -m pip install --user psycopg2-binary | Out-Null
  & $py -c $code
}

Write-Host "Done." -ForegroundColor Green
