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
#   BACKUP_TIMER_FILE      timer 单元路径          默认 <项目>/deploy/lcsc-inventory-backup.timer
#
# 每次执行结束（无论成功失败）会在备份目录写 status.json，供应用「设置 → 数据库备份」读取：
# 上次备份时间 / 份数 / 计划 / 异地推送状态 / 失败原因。
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
PUSH_RETRIES="${BACKUP_PUSH_RETRIES:-3}"

log() { printf '[backup] %s %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"; }
die() { st_status="error"; st_error="$*"; printf '[backup] %s ERROR: %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >&2; exit 1; }

# ---- 状态文件：供应用「设置 → 数据库备份」读取 --------------------------------
# 放在备份目录里（容器内即 /data/backups，已随 ./data 挂载），应用侧无需额外挂载。
STATUS_FILE="$BACKUP_DIR/status.json"
st_started_at="$(date '+%Y-%m-%dT%H:%M:%S%:z')"
st_status="ok"
st_error=""
st_file=""
st_size=0
st_last_at=""
st_git_enabled=false
st_git_committed=false
st_git_commit=""
st_git_pushed=false
st_git_remote=""
st_git_remote_url=""
st_git_branch=""
st_git_error=""
st_git_pending=0
st_rclone_enabled=false
st_rclone_uploaded=false

json_str() { # 转义成 JSON 字符串（含 null 处理）
  local s="${1-}"
  [ -n "$s" ] || { printf 'null'; return 0; }
  s="${s//\\/\\\\}"
  s="${s//\"/\\\"}"
  s="${s//$'\n'/\\n}"
  s="${s//$'\t'/\\t}"
  printf '"%s"' "$s"
}
json_bool() { [ "${1-}" = "true" ] && printf 'true' || printf 'false'; }

# 从 timer 单元里读 OnCalendar，让页面能显示计划时间
schedule_text() {
  local f="${BACKUP_TIMER_FILE:-$PROJECT_DIR/deploy/lcsc-inventory-backup.timer}" line
  [ -f "$f" ] || return 0
  line="$(grep -a -m1 -E '^[[:space:]]*OnCalendar=' "$f" 2>/dev/null || true)"
  if [[ "$line" =~ ([0-9]{2}):([0-9]{2}) ]]; then
    printf '每日 %s:%s' "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}"
  fi
}
ST_SCHEDULE="$(schedule_text)"

write_status() {
  local finished now_ms start_ms dur
  finished="$(date '+%Y-%m-%dT%H:%M:%S%:z')"
  start_ms="$(date -d "$st_started_at" '+%s%3N' 2>/dev/null || echo 0)"
  now_ms="$(date '+%s%3N' 2>/dev/null || echo 0)"
  dur=$((now_ms - start_ms))
  [ "$dur" -ge 0 ] 2>/dev/null || dur=0
  {
    printf '{\n'
    printf '  "generatedAt": %s,\n' "$(json_str "$finished")"
    printf '  "status": %s,\n' "$(json_str "$st_status")"
    printf '  "error": %s,\n' "$(json_str "$st_error")"
    printf '  "startedAt": %s,\n' "$(json_str "$st_started_at")"
    printf '  "finishedAt": %s,\n' "$(json_str "$finished")"
    printf '  "durationMs": %s,\n' "$dur"
    printf '  "lastBackupFile": %s,\n' "$(json_str "$st_file")"
    printf '  "lastBackupAt": %s,\n' "$(json_str "$st_last_at")"
    printf '  "lastBackupSize": %s,\n' "$st_size"
    printf '  "backupCount": %s,\n' "$(ls -1 "$BACKUP_DIR"/inventory-*.db.gz 2>/dev/null | wc -l | tr -d ' ')"
    printf '  "keepCount": %s,\n' "$( [[ "$KEEP" =~ ^[0-9]+$ ]] && echo "$KEEP" || echo 0 )"
    printf '  "schedule": %s,\n' "$(json_str "$ST_SCHEDULE")"
    printf '  "git": {\n'
    printf '    "enabled": %s,\n' "$(json_bool "$st_git_enabled")"
    printf '    "committed": %s,\n' "$(json_bool "$st_git_committed")"
    printf '    "commit": %s,\n' "$(json_str "$st_git_commit")"
    printf '    "pushed": %s,\n' "$(json_bool "$st_git_pushed")"
    printf '    "remote": %s,\n' "$(json_str "$st_git_remote")"
    printf '    "remoteUrl": %s,\n' "$(json_str "$st_git_remote_url")"
    printf '    "branch": %s,\n' "$(json_str "$st_git_branch")"
    printf '    "pendingCommits": %s,\n' "$st_git_pending"
    printf '    "error": %s\n' "$(json_str "$st_git_error")"
    printf '  },\n'
    printf '  "rclone": { "enabled": %s, "uploaded": %s }\n' \
      "$(json_bool "$st_rclone_enabled")" "$(json_bool "$st_rclone_uploaded")"
    printf '}\n'
  } >"$STATUS_FILE.part" 2>/dev/null || return 0
  mv -- "$STATUS_FILE.part" "$STATUS_FILE" 2>/dev/null || true
}

# 推送可能因网络抖动（如链路偶发 RST）失败，退避重试几次再放弃
push_with_retry() {
  local branch="$1" i delay=5
  for ((i = 1; i <= PUSH_RETRIES; i++)); do
    if git -C "$GIT_DIR" push "$GIT_REMOTE" "$branch"; then
      return 0
    fi
    if [ "$i" -lt "$PUSH_RETRIES" ]; then
      log "第 $i/$PUSH_RETRIES 次推送失败，${delay}s 后退避重试"
      sleep "$delay"
      delay=$((delay * 2))
    fi
  done
  return 1
}

mkdir -p "$BACKUP_DIR"

# 无论成功失败都写一份状态文件，页面才能显示「上次执行结果」
trap 'write_status; rm -rf "${tmp_dir:-}" 2>/dev/null || true' EXIT

[ -f "$DB_PATH" ] || die "源数据库不存在：$DB_PATH"
[[ "$KEEP" =~ ^[0-9]+$ ]] && [ "$KEEP" -ge 1 ] || die "BACKUP_KEEP 必须是 >=1 的整数，当前为：$KEEP"
[[ "$PUSH_RETRIES" =~ ^[0-9]+$ ]] && [ "$PUSH_RETRIES" -ge 1 ] || die "BACKUP_PUSH_RETRIES 必须是 >=1 的整数"

# 同一时刻只允许一个备份在跑（systemd Persistent 补跑时可能重叠）
if command -v flock >/dev/null 2>&1; then
  exec 9>"$BACKUP_DIR/.backup.lock"
  if ! flock -n 9; then
    log "已有备份进程在运行，本次跳过"
    st_status="skipped"
    exit 0
  fi
fi

tmp_dir="$(mktemp -d)"
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
st_file="$(basename "$out")"
st_size="$(wc -c <"$out" | tr -d ' ')"
st_last_at="$(date '+%Y-%m-%dT%H:%M:%S%:z')"
log "备份完成：$st_file（$st_size 字节）"

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
  st_git_enabled=true
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
  st_git_committed=true
  st_git_commit="$(git -C "$GIT_DIR" rev-parse --short HEAD 2>/dev/null || echo '')"

  if git -C "$GIT_DIR" remote get-url "$GIT_REMOTE" >/dev/null 2>&1; then
    branch="$(git -C "$GIT_DIR" rev-parse --abbrev-ref HEAD)"
    remote_url="$(git -C "$GIT_DIR" remote get-url "$GIT_REMOTE")"
    st_git_remote="$GIT_REMOTE"
    st_git_remote_url="$remote_url"
    st_git_branch="$branch"
    if push_with_retry "$branch"; then
      st_git_pushed=true
      log "已推送到 $GIT_REMOTE/$branch（$remote_url）"
    else
      st_git_error="重试 $PUSH_RETRIES 次仍推送失败，本地提交已保留"
      log "重试 $PUSH_RETRIES 次仍失败；本地提交已保留，下次 timer 会连同新备份一起重试"
      log "远端地址：$remote_url —— 请确认仓库存在且凭证有效（$GIT_DIR）"
    fi
    # 未被推送出去的本地提交数（异地留存积压量）
    if git -C "$GIT_DIR" rev-parse --verify --quiet "$GIT_REMOTE/$branch" >/dev/null; then
      st_git_pending="$(git -C "$GIT_DIR" rev-list --count "$GIT_REMOTE/$branch..HEAD" 2>/dev/null || echo 0)"
    else
      st_git_pending="$(git -C "$GIT_DIR" rev-list --count HEAD 2>/dev/null || echo 0)"
    fi
  else
    st_git_error="未配置远端 $GIT_REMOTE，仅本地提交"
    st_git_pending="$(git -C "$GIT_DIR" rev-list --count HEAD 2>/dev/null || echo 0)"
    log "git 仓库未配置远端 $GIT_REMOTE，仅本地提交。配置：git -C '$GIT_DIR' remote add $GIT_REMOTE <url>"
  fi
fi

# ---- 5. 可选：rclone 上传对象存储 -------------------------------------------
if [ -n "$RCLONE_REMOTE" ]; then
  st_rclone_enabled=true
  if command -v rclone >/dev/null 2>&1; then
    if rclone copyto -- "$out" "$RCLONE_REMOTE/$(basename "$out")"; then
      st_rclone_uploaded=true
      log "已上传到 $RCLONE_REMOTE"
    fi
  else
    log "设置了 BACKUP_RCLONE_REMOTE 但未安装 rclone，跳过上传"
  fi
fi

log "全部完成，当前备份数：$(ls -1 "$BACKUP_DIR"/inventory-*.db.gz 2>/dev/null | wc -l | tr -d ' ')"
