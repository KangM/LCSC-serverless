#!/usr/bin/env bash
# 部署状态一览（只读，不改任何东西）。
# 用法：在服务器上 bash ~/lcsc-inventory/scripts/deploy-status.sh
#      或在本机 ssh lcsc-docker 'bash ~/lcsc-inventory/scripts/deploy-status.sh'
set -uo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-master}"
REMOTE="${DEPLOY_REMOTE:-origin}"
UNIT="lcsc-inventory-update"
PORT="${PORT:-3000}"

cd "$APP_DIR" || { echo "找不到项目目录：$APP_DIR"; exit 1; }

echo "== 1. 代码版本 =="
git fetch --quiet "$REMOTE" "$BRANCH" 2>/dev/null || echo "  (fetch 失败，下面用本地已知的远端引用)"
LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH" 2>/dev/null || echo '')"
echo "  服务器 HEAD : ${LOCAL_SHA:0:12}  $(git log -1 --pretty=%s)"
echo "  远端 $BRANCH  : ${REMOTE_SHA:0:12}  $(git log -1 --pretty=%s "$REMOTE/$BRANCH" 2>/dev/null)"
if [[ -n "$REMOTE_SHA" && "$LOCAL_SHA" != "$REMOTE_SHA" ]]; then
  echo "  >>> 落后 $(git rev-list --count "HEAD..$REMOTE_SHA" 2>/dev/null || echo '?') 个提交，等下一次定时器就会部署"
else
  echo "  >>> 已是最新"
fi

echo
echo "== 2. 定时器 =="
systemctl list-timers "${UNIT}.timer" --no-pager 2>/dev/null | head -3

echo
echo "== 3. 上一次部署 =="
systemctl show "${UNIT}.service" -p Result -p ExecMainStatus -p ExecMainExitTimestamp --no-pager 2>/dev/null \
  | sed 's/^/  /'
echo "  最近 3 条部署日志："
journalctl -u "${UNIT}.service" --no-pager -o cat 2>/dev/null | grep -E 'checking|already up to date|building|deployment complete|ERROR' | tail -3 | sed 's/^/    /'

echo
echo "== 4. 容器 =="
docker ps --filter 'name=lcsc-inventory-app' --format '  {{.Names}} | {{.Status}} | 创建于 {{.CreatedAt}}' 2>/dev/null
docker images lcsc-inventory-app:latest --format '  镜像构建于 {{.CreatedAt}}' 2>/dev/null
echo "  镜像内版本：$(docker exec lcsc-inventory-app-1 printenv GIT_COMMIT_SHA 2>/dev/null | cut -c1-12)（空=构建时没传 build-arg）"
echo "  镜像内提交时间：$(docker exec lcsc-inventory-app-1 printenv GIT_COMMIT_TIME 2>/dev/null)（空=构建时没传 GIT_COMMIT_TIME）"

echo
echo "== 5. 健康检查（含线上版本号）=="
curl -s --max-time 5 "http://127.0.0.1:${PORT}/api/health" || echo "  连接失败"
echo
