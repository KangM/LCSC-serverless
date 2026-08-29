#!/usr/bin/env bash
set -Eeuo pipefail

# 服务器定时部署：仅当 origin/master 有新提交时才构建并重启。
APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BRANCH="${DEPLOY_BRANCH:-master}"
REMOTE="${DEPLOY_REMOTE:-origin}"
LOCK_FILE="${DEPLOY_LOCK_FILE:-/tmp/lcsc-inventory-deploy.lock}"

exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "[$(date --iso-8601=seconds)] deployment already running"
  exit 0
fi

cd "$APP_DIR"
echo "[$(date --iso-8601=seconds)] checking $REMOTE/$BRANCH"
git fetch --quiet "$REMOTE" "$BRANCH"

LOCAL_SHA="$(git rev-parse HEAD)"
REMOTE_SHA="$(git rev-parse "$REMOTE/$BRANCH")"
if [[ "$LOCAL_SHA" == "$REMOTE_SHA" ]]; then
  echo "[$(date --iso-8601=seconds)] already up to date at ${LOCAL_SHA:0:12}"
  exit 0
fi

git pull --ff-only "$REMOTE" "$BRANCH"
export GIT_COMMIT_SHA="$(git rev-parse HEAD)"
export GIT_COMMIT_MESSAGE="$(git log -1 --pretty=%s)"

echo "[$(date --iso-8601=seconds)] building ${GIT_COMMIT_SHA:0:12}"
sudo docker build --network=host -t lcsc-inventory-app:latest .
sudo --preserve-env=GIT_COMMIT_SHA,GIT_COMMIT_MESSAGE docker compose up -d --no-build
echo "[$(date --iso-8601=seconds)] deployment complete"
