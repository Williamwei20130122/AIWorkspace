# 启动本地后端（Go，:3100）
# 用法：pwsh -File scripts/dev-server.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$env:PORT = "3100"
$env:DATABASE_PATH = Join-Path $root "server\data\app.db"
if (-not $env:AUTH_SECRET) {
  $env:AUTH_SECRET = "aiworkspace-dev-secret-change-me"
}
$env:SEED_ON_START = "1"
$go = "go"
$goExe = "C:\Users\eno\.tools\go\bin\go.exe"
if (Test-Path $goExe) { $go = $goExe }
Push-Location (Join-Path $root "server")
try {
  & $go run ./cmd/server
} finally {
  Pop-Location
}
