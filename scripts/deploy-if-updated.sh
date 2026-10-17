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

# 服务器是部署目标，所有权归 upstream：工作区对「已跟踪文件」的任何本地修改一律丢弃，
# 否则 pull 会被 "local changes would be overwritten by merge" 拒掉，5 分钟重试也只会反复失败。
# 只会还原被版本管理的文件，data/ 等忽略/未跟踪的文件不受影响。
if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "[$(date --iso-8601=seconds)] discarding local changes to tracked files"
  git reset --quiet
  git checkout -- .
fi

git pull --ff-only "$REMOTE" "$BRANCH"
export GIT_COMMIT_SHA="$(git rev-parse HEAD)"
export GIT_COMMIT_MESSAGE="$(git log -1 --pretty=%s)"

# 注意：这里必须用「无 sudo 的 docker」。systemd 以 User=u 无人值守运行，
# 没有 TTY 也输不了密码，`sudo docker` 会直接失败：
#   sudo: a terminal is required to read the password
# 前置条件：把服务运行用户加入 docker 组（sudo usermod -aG docker <用户>）。
DOCKER_BIN="${DEPLOY_DOCKER_BIN:-docker}"
if ! "$DOCKER_BIN" info >/dev/null 2>&1; then
  echo "[$(date --iso-8601=seconds)] ERROR: $(id -un) 无法执行 '${DOCKER_BIN} info'。" >&2
  echo "  处理：sudo usermod -aG docker $(id -un)" >&2
  echo "  或用 root 运行服务：修改 service 的 User=（不推荐，会产生 root 属主的仓库文件）" >&2
  exit 1
fi

echo "[$(date --iso-8601=seconds)] building ${GIT_COMMIT_SHA:0:12}"
# NPM_REGISTRY 可选：在 service 里加 Environment=NPM_REGISTRY=https://registry.npmjs.org 即可换源
"$DOCKER_BIN" build --network=host -t lcsc-inventory-app:latest \
  ${NPM_REGISTRY:+--build-arg NPM_REGISTRY="$NPM_REGISTRY"} .
"$DOCKER_BIN" compose up -d --no-build
echo "[$(date --iso-8601=seconds)] deployment complete"
