#!/usr/bin/env bash
#
# 定时备份 SQLite 数据库（在宿主机执行，配合 deploy/lcsc-inventory-backup.timer）
#
#   1. sqlite3 .backup 做一致性热快照（无需停止容器；无 sqlite3 时退化为复制 db + WAL）
#   2. gzip 压缩写入备份目录
#   3. 只保留最近 BACKUP_KEEP 份，更旧的自动删除
#   4. 可选：复制一份到备份 git 仓库并提交 / 推送到远端（异地留存）
#   5. 可选：rclone 上传到对象存储（S3 / COS / OSS / OneDrive ...）
#
# 可用环境变量（均可不设，走默认值）：
#   DB_PATH                源数据库路径            默认 <项目>/data/inventory.db
#   BACKUP_DIR             备份存放目录            默认 <项目>/data/backups
#   BACKUP_KEEP            保留最近几份            默认 30
#   BACKUP_GIT_DIR         备份 git 仓库路径        默认空（不提交）
#   BACKUP_GIT_REMOTE      远端名                  默认 origin
#   BACKUP_GIT_BRANCH      分支名                  默认 master
#   BACKUP_RCLONE_REMOTE   rclone 远端             默认空（不上传，例：mycos:lcsc-backups）
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="${PROJECT_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"

DB_PATH="${DB_PATH:-$PROJECT_DIR/data/inventory.db}"
BACKUP_DIR="${BACKUP_DIR:-$PROJECT_DIR/data/backups}"
KEEP="${BACKUP_KEEP:-30}"
GIT_DIR="${BACKUP_GIT_DIR:-}"
GIT_REMOTE="${BACKUP_GIT_REMOTE:-origin}"
GIT_BRANCH="${BACKUP_GIT_BRANCH:-master}"
RCLONE_REMOTE="${BACKUP_RCLONE_REMOTE:-}"

log() { printf '[backup] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { printf '[backup] %s ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

[ -f "$DB_PATH" ] || die "源数据库不存在：$DB_PATH"
[[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || die "BACKUP_KEEP 必须是 >=1 的整数，当前为：$KEEP"

mkdir -p "$BACKUP_DIR"

# 同一时刻只允许一个备份在跑（systemd Persistent 补跑时可能重叠）
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.backup.lock"
  flock -n 9 || die "已有备份进程在运行，本次跳过"
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir" 2>/dev/null || true' EXIT
tmp_db="$tmp_dir/inventory.db"

# ---- 1. 一致性快照 ----------------------------------------------------------
if command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "$DB_PATH" ".backup '$tmp_db'" || die "sqlite3 .backup 失败（源库可能损坏）"
  check="$(sqlite3 "$tmp_db" 'PRAGMA integrity_check;' 2>/dev/null || echo 'unknown')"
  [ "$check" = "ok" ] || die "快照完整性检查未通过：$check"
  log "已生成一致性快照（integrity_check=ok）"
else
  log "未找到 sqlite3 命令，退化为文件复制（会连同 WAL 一起复制）"
  cp -- "$DB_PATH" "$tmp_db"
  for suffix in -wal -shm; do
    if [ -f "${DB_PATH}${suffix}" ]; then
      cp -- "${DB_PATH}${suffix}" "${tmp_db}${suffix}"
    fi
  done
fi
[ -s "$tmp_db" ] || die "快照为空文件，已中止"

# ---- 2. 压缩落盘 ------------------------------------------------------------
ts="$(date '+%Y%m%d-%H%M%S')"
out="$BACKUP_DIR/inventory-$ts.db.gz"
[ -e "$out" ] && out="$BACKUP_DIR/inventory-$ts-$$.db.gz"

gzip -9 -c -- "$tmp_db" >"$out.part" || die "压缩失败"
mv -- "$out.part" "$out"
gzip -t -- "$out" || die "备份文件校验失败：$out"
log "备份完成：$(basename "$out")（$(wc -c <"$out" | tr -d ' ') 字节）"

# ---- 3. 只保留最近 N 份 -----------------------------------------------------
prune_dir() {
  local dir="$1" keep="$2" count=0
  while IFS= read -r old; do
    [ -n "$old" ] || continue
    rm -f -- "$old"
    log "清理旧备份：$(basename "$old")"
    count=$((count + 1))
  done < <(ls -1t "$dir"/inventory-*.db.gz 2>/dev/null | tail -n "+$((keep + 1))")
  [ "$count" -gt 0 ] && log "共清理 $count 份，目录内保留最近 $keep 份"
  return 0
}
prune_dir "$BACKUP_DIR" "$KEEP"

# ---- 4. 备份 git 仓库：提交 + 推送 ------------------------------------------
if [ -n "$GIT_DIR" ] && command -v git >/dev/null 2>&1; then
  mkdir -p "$GIT_DIR"
  [ -d "$GIT_DIR/.git" ] || git -C "$GIT_DIR" init -q -b "$GIT_BRANCH"
  cp -- "$out" "$GIT_DIR/"
  prune_dir "$GIT_DIR" "$KEEP"   # 工作区同样只留 N 份，历史仍完整保存在 git 里

  git -C "$GIT_DIR" add -A
  if git -C "$GIT_DIR" diff --cached --quiet; then
    log "git 仓库无变化，跳过提交"
  else
    git -C "$GIT_DIR" \
      -c user.name='lcsc-backup' \
      -c user.email='backup@localhost' \
      commit -q -m "backup $ts"
    log "git 已提交：$(basename "$out")"
  fi

  if git -C "$GIT_DIR" remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
    branch="$(git -C "$GIT_DIR" rev-parse --abbrev-ref HEAD)"
    if git -C "$GIT_DIR" push "$GIT_REMOTE" "$branch"; then
      log "已推送到 $GIT_REMOTE/$branch"
    else
      log "推送失败（保留本地提交，下次 timer 会重试）；请检查 $GIT_DIR 的远端与凭证"
    fi
  else
    log "git 仓库未配置远端 $GIT_REMOTE，仅本地提交。配置：git -C '$GIT_DIR' remote add $GIT_REMOTE <url>"
  fi
fi

# ---- 5. 可选：rclone 上传对象存储 -------------------------------------------
if [ -n "$RCLONE_REMOTE" ]; then
  if command -v rclone >/dev/null 2>&1; then
    rclone copyto -- "$out" "$RCLONE_REMOTE/$(basename "$out")" && log "已上传到 $RCLONE_REMOTE"
  else
    log "设置了 BACKUP_RCLONE_REMOTE 但未安装 rclone，跳过上传"
  fi
fi

log "全部完成，当前备份数：$(ls -1 "$BACKUP_DIR"/inventory-*.db.gz 2>/dev/null | wc -l | tr -d ' ')"
