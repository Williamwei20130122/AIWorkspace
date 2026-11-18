#!/usr/bin/env bash
# ============================================================
# AI Workspace 版本升级脚本（运行于 Linux 业务服务器）
#
# 流程：校验 tar -> 导入新镜像（此步旧容器仍在运行，失败不影响线上）
#       -> 自动备份数据库 -> 停止旧容器 -> 删除旧容器（仅删容器，绝不删宿主机数据目录）
#       -> 以新镜像启动并复用同一挂载目录 -> 健康检查
#
# 用法：./upgrade.sh <新版本镜像tar包路径>
# 可选环境变量：PORT=3002（对外端口）
# ============================================================
set -euo pipefail

TAR_PATH="${1:-}"
CONTAINER_NAME="ai-workspace"
DATA_DIR="/opt/aiworkspace/data"
PORT="${PORT:-3002}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

log() { echo -e "\033[32m[升级]\033[0m $*"; }
err()  { echo -e "\033[31m[错误]\033[0m $*" >&2; }

# ---------- 0. 参数与环境校验 ----------
if [[ -z "$TAR_PATH" ]]; then
  err "用法: $0 <新版本镜像tar包路径>"
  exit 1
fi
if [[ ! -s "$TAR_PATH" ]]; then
  err "tar 包不存在或为空: $TAR_PATH"
  exit 1
fi
command -v docker >/dev/null 2>&1 || { err "未安装 docker"; exit 1; }

# ---------- 1. 导入新镜像（此时旧容器仍在运行，导入失败不影响线上服务） ----------
log "导入镜像: $TAR_PATH"
LOAD_OUTPUT="$(docker load -i "$TAR_PATH")"
echo "$LOAD_OUTPUT"
NEW_IMAGE="$(echo "$LOAD_OUTPUT" | sed -n 's/^Loaded image: //p' | head -n1)"
if [[ -z "$NEW_IMAGE" ]]; then
  NEW_IMAGE="$(echo "$LOAD_OUTPUT" | sed -n 's/^Loaded image ID: //p' | head -n1)"
fi
if [[ -z "$NEW_IMAGE" ]]; then
  err "无法从 docker load 输出解析镜像名，请确认 tar 包由 docker save 生成"
  exit 1
fi
log "新镜像: $NEW_IMAGE"

# ---------- 2. 若旧容器存在：备份 -> 停止 -> 删除 ----------
if docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  # 升级前自动备份（WAL 一致性在线备份）
  if [[ -f "$SCRIPT_DIR/backup.sh" ]]; then
    log "升级前自动备份数据库..."
    bash "$SCRIPT_DIR/backup.sh" || err "自动备份失败：升级将继续，但请尽快人工确认数据安全（可重跑 backup.sh 排查原因）"
  else
    log "未找到 backup.sh，跳过自动备份（建议先手动执行备份）"
  fi

  # 给足优雅退出时间，确保 SQLite 正常 checkpoint
  log "停止旧容器: $CONTAINER_NAME"
  docker stop -t 30 "$CONTAINER_NAME"

  # 注意：仅删除容器本身。宿主机数据目录 $DATA_DIR 不受任何影响，
  # 数据库、生成文件缓存、日志全部保留在该目录中。
  log "删除旧容器（数据保留在 $DATA_DIR）"
  docker rm "$CONTAINER_NAME"
else
  log "未发现旧容器，视为首次部署"
fi

# ---------- 3. 以新镜像启动（复用同一挂载目录） ----------
mkdir -p "$DATA_DIR"
log "启动新容器（挂载 $DATA_DIR -> /data）"
docker run -d \
  --name "$CONTAINER_NAME" \
  --restart unless-stopped \
  -p "${PORT}:3002" \
  -v "$DATA_DIR:/data" \
  -e TZ=Asia/Shanghai \
  -e WORKSPACE_ARTIFACT_DIR=/data/workspace-artifacts \
  --log-opt max-size=20m \
  --log-opt max-file=5 \
  "$NEW_IMAGE"

# ---------- 4. 健康检查（容器内自带 wget） ----------
log "等待服务启动..."
HEALTH_OK=0
for _ in $(seq 1 12); do
  if docker exec "$CONTAINER_NAME" wget -q -O - http://localhost:3002/api/status 2>/dev/null \
      | grep -q '"success":\s*true'; then
    HEALTH_OK=1
    break
  fi
  sleep 5
done

if [[ "$HEALTH_OK" == "1" ]]; then
  log "升级完成，服务健康: http://<服务器IP>:${PORT}"
else
  err "容器已启动但健康检查未通过，请查看最近日志："
  docker logs --tail 50 "$CONTAINER_NAME" || true
  exit 1
fi
