# 启动本地前端开发服务器（Vite，:5173，/api 代理到 :3100）
# 用法：pwsh -File scripts/dev-web.ps1
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root "web")
try {
  if (-not (Test-Path "node_modules")) { npm install }
  npm run dev
} finally {
  Pop-Location
}
