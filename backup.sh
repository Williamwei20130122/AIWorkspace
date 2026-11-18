#!/usr/bin/env bash
# ============================================================
# AI Workspace SQLite 在线备份脚本（运行于 Linux 业务服务器）
#
# - 通过 docker exec 在容器内用 sqlite3 的 .backup 命令做在线备份，
#   对 WAL 模式安全（不能直接 cp 运行中的数据库文件）。
# - 备份文件名带时间戳，写入容器 /data/backups/，
#   即宿主机 <数据目录>/backups/（随数据目录一起持久化）。
# - 自动清理超过 KEEP_DAYS 天的过期备份。
#
# 用法：./backup.sh [容器名]          默认容器名 ai-workspace
# 可选环境变量：
#   DB_PATH=/data/one-api.db          数据库在容器内的路径
#   BACKUP_DIR=/data/backups          备份目录（容器内路径）
#   KEEP_DAYS=7                       备份保留天数
# ============================================================
set -euo pipefail

CONTAINER_NAME="${1:-ai-workspace}"
DB_PATH="${DB_PATH:-/data/one-api.db}"
BACKUP_DIR="${BACKUP_DIR:-/data/backups}"
KEEP_DAYS="${KEEP_DAYS:-7}"

log() { echo -e "\033[32m[备份]\033[0m $*"; }
err()  { echo -e "\033[31m[错误]\033[0m $*" >&2; }

# ---------- 0. 前置校验 ----------
command -v docker >/dev/null 2>&1 || { err "未安装 docker"; exit 1; }
if ! docker container inspect "$CONTAINER_NAME" >/dev/null 2>&1; then
  err "容器不存在: $CONTAINER_NAME"
  exit 1
fi
if [[ "$(docker container inspect -f '{{.State.Running}}' "$CONTAINER_NAME")" != "true" ]]; then
  err "容器未运行，无法在线备份。"
  err "若容器已被删除且数据目录仍在：停止一切写入后，直接拷贝宿主机数据目录里的 one-api.db 文件。"
  exit 1
fi
if ! docker exec "$CONTAINER_NAME" test -f "$DB_PATH"; then
  err "数据库文件不存在: $DB_PATH"
  exit 1
fi

# ---------- 1. 生成带时间戳的备份 ----------
TS="$(date +%Y%m%d-%H%M%S)"
BACKUP_FILE="backup-${TS}.db"
docker exec "$CONTAINER_NAME" mkdir -p "$BACKUP_DIR"

log "开始在线备份（sqlite3 .backup，WAL 安全）..."
docker exec "$CONTAINER_NAME" sqlite3 "$DB_PATH" ".backup '$BACKUP_DIR/$BACKUP_FILE'"

# ---------- 2. 校验备份非空 ----------
if ! docker exec "$CONTAINER_NAME" test -s "$BACKUP_DIR/$BACKUP_FILE"; then
  err "备份文件为空或不存在: $BACKUP_DIR/$BACKUP_FILE"
  exit 1
fi
SIZE="$(docker exec "$CONTAINER_NAME" du -h "$BACKUP_DIR/$BACKUP_FILE" | cut -f1)"

# ---------- 3. 清理过期备份（仅删除 backups 目录内带时间戳的备份文件） ----------
docker exec "$CONTAINER_NAME" find "$BACKUP_DIR" -name 'backup-*.db' -mtime +"$KEEP_DAYS" -delete
REMAIN="$(docker exec "$CONTAINER_NAME" find "$BACKUP_DIR" -name 'backup-*.db' | wc -l)"

log "备份完成: $BACKUP_FILE（$SIZE）"
log "位置: 挂载数据目录下的 backups/ 子目录（可另行拷贝离线保存）"
log "当前共 ${REMAIN} 份备份，保留最近 ${KEEP_DAYS} 天"
