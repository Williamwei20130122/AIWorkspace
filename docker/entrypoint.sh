#!/bin/sh
# AIWorkspace 容器入口：迁移数据库 → 可选灌演示数据 → 启动 Next.js standalone
set -e

export DATABASE_URL="${DATABASE_URL:-file:/data/app.db}"
export PORT="${PORT:-3100}"
export HOSTNAME="${HOSTNAME:-0.0.0.0}"

mkdir -p /data

echo "==> 数据库：$DATABASE_URL"
echo "==> 执行 Prisma 迁移…"
node /app/prisma-cli/node_modules/prisma/build/index.js migrate deploy

if [ "${SEED_ON_START:-1}" = "1" ]; then
  echo "==> 检查演示数据…"
  node prisma/ensure-seed.mjs || echo "==> 演示数据初始化失败，继续启动（不影响已有数据）"
fi

echo "==> 启动 AIWorkspace：http://0.0.0.0:${PORT}"
exec node server.js
