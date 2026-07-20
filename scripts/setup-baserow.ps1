#Requires -Version 5.1
<#
.SYNOPSIS
  First-time Baserow community edition setup for Liangce (Windows native, no Docker).
#>
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $PSScriptRoot
$BaserowRoot = Join-Path $Root "services\baserow"
$PluginRoot = Join-Path $Root "integrations\baserow\liangce_sso"
$Venv = Join-Path $BaserowRoot ".venv"
$EnvFile = Join-Path $BaserowRoot ".env.liangce"
$EnvExample = Join-Path $BaserowRoot ".env.liangce.example"

Write-Host "== Liangce Baserow setup ==" -ForegroundColor Cyan

if (-not (Test-Path (Join-Path $BaserowRoot "backend"))) {
  Write-Host "Cloning Baserow 2.3.2 into services/baserow ..."
  New-Item -ItemType Directory -Force -Path (Split-Path $BaserowRoot) | Out-Null
  git clone --depth 1 --branch 2.3.2 https://github.com/baserow/baserow.git $BaserowRoot
}

# Python 3.14
$py = & py -3.14 -c "import sys; print(sys.executable)" 2>$null
if (-not $py) { throw "Python 3.14 not found. Install from python.org and ensure `py -3.14` works." }
Write-Host "Python: $py"

# uv
$uv = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uv) {
  Write-Host "Installing uv..."
  powershell -ExecutionPolicy ByPass -c "irm https://astral.sh/uv/install.ps1 | iex"
  $env:Path = "$env:USERPROFILE\.local\bin;$env:USERPROFILE\.cargo\bin;$env:Path"
  $uv = Get-Command uv -ErrorAction SilentlyContinue
  if (-not $uv) { throw "uv install failed" }
}

# Yarn
$yarn = Get-Command yarn -ErrorAction SilentlyContinue
if (-not $yarn) {
  Write-Host "Installing yarn globally..."
  npm install -g yarn
}

# Redis / Memurai / project-local portable Redis
$redisOk = $false
try {
  $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
  $redisOk = [bool]$tcp.TcpTestSucceeded
} catch { $redisOk = $false }

if (-not $redisOk) {
  $tools = Join-Path $BaserowRoot "tools"
  $redisDir = Join-Path $tools "Redis-x64-3.0.504"
  $redisExe = Join-Path $redisDir "redis-server.exe"
  if (-not (Test-Path $redisExe)) {
    New-Item -ItemType Directory -Force -Path $tools | Out-Null
    $redisZip = Join-Path $tools "Redis-x64-3.0.504.zip"
    Write-Host "Downloading project-local portable Redis..." -ForegroundColor Yellow
    Invoke-WebRequest `
      -Uri "https://github.com/microsoftarchive/redis/releases/download/win-3.0.504/Redis-x64-3.0.504.zip" `
      -OutFile $redisZip -UseBasicParsing
    Expand-Archive -Path $redisZip -DestinationPath $redisDir -Force
  }
  Start-Process -FilePath $redisExe -ArgumentList "--port", "6379" -WindowStyle Hidden
  Start-Sleep -Seconds 2
  try {
    $tcp = Test-NetConnection -ComputerName 127.0.0.1 -Port 6379 -WarningAction SilentlyContinue
    $redisOk = [bool]$tcp.TcpTestSucceeded
  } catch { $redisOk = $false }
}

if (-not $redisOk) {
  Write-Host "WARNING: Redis/Memurai still unavailable on 127.0.0.1:6379." -ForegroundColor Red
  Write-Host "Install Memurai Developer manually, then re-run setup-baserow.ps1." -ForegroundColor Red
} else {
  Write-Host "Redis OK on 6379"
}

# Env file
if (-not (Test-Path $EnvFile)) {
  Copy-Item $EnvExample $EnvFile
  $secret = -join ((48..57 + 97..122) | Get-Random -Count 40 | ForEach-Object { [char]$_ })
  Add-Content -Path $EnvFile -Value "LIANGCE_SSO_SHARED_SECRET=$secret"
  $liangceEnv = Join-Path $Root "backend\.env"
  if (Test-Path $liangceEnv) {
    $raw = Get-Content $liangceEnv -Raw
    if ($raw -notmatch "BASEROW_SSO_SHARED_SECRET=") {
      Add-Content -Path $liangceEnv -Value "`nBASEROW_PUBLIC_URL=http://127.0.0.1:3001`nBASEROW_BACKEND_URL=http://127.0.0.1:8001`nBASEROW_SSO_SHARED_SECRET=$secret"
    }
  }
  Write-Host "Created $EnvFile and synced SSO secret into backend/.env" -ForegroundColor Yellow
}

# The checked-in example intentionally contains placeholders. Local startup merges
# actual PostgreSQL credentials from backend/.env, so no database password is copied
# into a tracked file.

# Backend venv + deps
Push-Location (Join-Path $BaserowRoot "backend")
try {
  if (-not (Test-Path $Venv)) {
    Write-Host "Creating venv with Python 3.14..."
    & py -3.14 -m venv $Venv
  }
  $pip = Join-Path $Venv "Scripts\pip.exe"
  $python = Join-Path $Venv "Scripts\python.exe"
  & $python -m pip install -U pip wheel
  # Official uv.lock is linux/darwin only — install via uv pip on Windows.
  # netifaces needs MSVC and is unused by Baserow imports on this tag.
  $pyproject = Get-Content ".\pyproject.toml" -Raw
  if ($pyproject -match '"netifaces==') {
    $patched = $pyproject -replace '    "netifaces==0\.11\.0",\r?\n', "    # netifaces removed for Windows native install`n"
    [System.IO.File]::WriteAllText((Resolve-Path ".\pyproject.toml"), $patched, (New-Object System.Text.UTF8Encoding $false))
  }
  Write-Host "Installing Baserow backend deps via uv pip (Windows)..."
  & uv pip install --python $python -e .
  # dev settings imports these unconditionally/for local convenience.
  & uv pip install --python $python snoop django-extensions
  Write-Host "Installing Liangce SSO plugin (editable)..."
  & $pip install -e (Join-Path $PluginRoot "backend")
} finally {
  Pop-Location
}

# Frontend deps
Push-Location (Join-Path $BaserowRoot "web-frontend")
try {
  # Upstream i18n/locales is a symlink. Git commonly checks it out as a plain
  # text file on Windows, which makes every SSR request hang/fail.
  $localeLink = Join-Path (Get-Location) "i18n\locales"
  if ((Test-Path $localeLink -PathType Leaf) -or -not (Test-Path (Join-Path $localeLink "en.json"))) {
    Remove-Item $localeLink -Force -Recurse -ErrorAction SilentlyContinue
    New-Item -ItemType Junction -Path $localeLink -Target (Join-Path (Get-Location) "locales") | Out-Null
  }
  Write-Host "Installing web-frontend yarn deps..."
  # Upstream package scripts use POSIX `APP_ENV=...`; run the equivalent
  # explicitly on Windows.
  yarn install --ignore-scripts --network-timeout 600000
  Get-ChildItem ".\node_modules" -Recurse -File -Include *.node,*.dll,*.exe |
    Unblock-File
  $env:APP_ENV = "dev"
  npx nuxt prepare
} finally {
  Pop-Location
}

Write-Host ""
Write-Host "Setup finished." -ForegroundColor Green
Write-Host "1) Edit services/baserow/.env.liangce (DB password + SSO secret)"
Write-Host "2) Create DB: .\\scripts\\create-baserow-db.ps1"
Write-Host "3) Start:    .\\scripts\\start-baserow.ps1"
Write-Host "4) Align backend/.env BASEROW_SSO_SHARED_SECRET with LIANGCE_SSO_SHARED_SECRET"
