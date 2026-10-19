# 自动部署

## 服务器访问 GitHub（代理配置）

国内服务器直连 GitHub 常超时。把代理**写进 git 配置**（重启不丢，只在 shell 里 `export` 会丢）：

```bash
# 全局生效（HTTP/HTTPS 协议的 remote，如 https://github.com/...）
git config --global http.proxy  http://<网关IP>:<端口>
git config --global https.proxy http://<网关IP>:<端口>

# 或只对 GitHub 生效（不影响其它仓库）
git config --global http.https://github.com.proxy http://<网关IP>:<端口>
```

验证与取消：

```bash
git ls-remote --heads origin            # 能列出 refs 即通
git config --global --get-regexp proxy  # 查看当前配置
git config --global --unset http.proxy; git config --global --unset https.proxy
```

若 remote 用 SSH（`git@github.com:...`），git 的 `http.proxy` 无效，需走 `~/.ssh/config`：

```
Host github.com
    ProxyCommand nc -X connect -x <网关IP>:<端口> %h %p
```

（`nc` 来自 `apt install -y netcat-openbsd`；改用 `corkscrew` 亦可。）

### 排错：CONNECT tunnel failed, response 407

`407` 表示**连上了代理、但代理拒绝建立 HTTPS 隧道**（不是地址不通）。按顺序排查：

```bash
# 1. 看代理回了什么（重点关注 Proxy-Authenticate / CONNECT 行）
curl -sv -x http://<网关IP>:<端口> https://github.com/ --max-time 15 2>&1 | grep -iE "CONNECT|HTTP/|Proxy-Authenticate|407"
```

| 现象 | 原因 | 处理 |
|---|---|---|
| 有 `Proxy-Authenticate: Basic` | 代理要账号密码 | 先用 `curl -s -o /dev/null -w "%{http_code}\n" -x http://<网关IP>:<端口> -U '<用户>:<密码>' https://github.com/ --max-time 15` 验证拿到 200，再写 `git config --global http.proxy http://<用户>:<密码>@<网关IP>:<端口>`；密码里的 `@` `:` `#` 等需 URL 编码（`@`→`%40`、`:`→`%3A`）。配置含明文密码，记得 `chmod 600 ~/.gitconfig` |
| 只拒绝 443、80 正常 | 代理禁止 CONNECT 到 443 | 换一个代理，或改用下方镜像/Gitee 方案 |
| 代理其实是 SOCKS5 | 协议写错 | 改 `git config --global http.proxy socks5://<网关IP>:<端口>`（DNS 也走代理用 `socks5h://`） |
| 代理有客户端 IP 白名单 | 服务器 IP 未被放行 | 在代理侧放行，或换方案 |

实在没有可用代理时（只需拉取，不用推送）：

```bash
git config --global --unset http.proxy; git config --global --unset https.proxy
git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"
```

需要**推送**的备份仓库建议直接建在国内可达的 Gitee 私有仓库（Gitee 支持从 GitHub 导入），
这样 `git pull` 与备份 `git push` 都不再依赖代理。

### 另一种做法：不改 git，改系统默认网关（透明代理）

若局域网内有旁路由/软路由在做透明代理（如 `192.168.100.5`），可让服务器整体出网走它，
git、apt、docker pull 一并解决，也不必把代理密码明文写进 `.gitconfig`：

```bash
git config --global --unset http.proxy            # 先清掉 git 侧代理
git config --global --unset https.proxy
ip route | grep default && ip -br addr show       # 记下原网关与网卡名

# 临时切换（重启失效），自带失败回滚，避免旁路由不转发时 SSH 永久失联
sudo bash -c 'ip route replace default via 192.168.100.5 dev eth0; \
  sleep 3; curl -s -o /dev/null --max-time 10 https://github.com/ \
  || ip route replace default via <原网关> dev eth0'

git ls-remote --heads origin                      # 验证
```

确认可用后，写入 netplan（`routes: - to: default, via: 192.168.100.5`，建议先 `netplan try`
再 `netplan apply`）、`nmcli con mod <连接名> ipv4.gateway ...` 或 `/etc/network/interfaces` 的
`gateway` 字段使其成为永久配置。

> 改默认网关会让整台机器断网，前提是旁路由确实在做 NAT/转发；异地云主机慎用（旁路由一关服务器即失联）。

其它要点：

- 代理跑在另一台机器上时，那台机器的 Clash/mihomo 需开启「允许局域网连接」（Clash Verge 里
  对应 `allow-lan: true`，默认 `false`），且防火墙放行该端口。
- 不想折腾代理、只需**拉取**时，可用镜像加速（**不能用于推送**，备份仓库要 push 就还是得代理）：
  `git config --global url."https://gh-proxy.com/https://github.com/".insteadOf "https://github.com/"`

## 自动部署流程

服务器使用 `systemd timer` 每 5 分钟检查一次 `origin/master`。没有新提交时不会构建；有新提交时自动执行：

1. `git pull --ff-only origin master`
2. `sudo docker build --network=host -t lcsc-inventory-app:latest .`
3. `sudo docker compose up -d --no-build`

首次在服务器执行：

```bash
cd ~/lcsc-inventory
chmod +x scripts/deploy-if-updated.sh
sudo cp deploy/lcsc-inventory-update.service /etc/systemd/system/
sudo cp deploy/lcsc-inventory-update.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lcsc-inventory-update.timer
```

检查状态和日志：

```bash
systemctl list-timers lcsc-inventory-update.timer
sudo systemctl status lcsc-inventory-update.timer
sudo journalctl -u lcsc-inventory-update.service -n 100 --no-pager
```

脚本使用 `flock` 防止上一次构建尚未结束时再次启动；部署失败会保留旧容器，不会继续执行重启步骤。

### 前置条件：服务运行用户必须能无密码执行 docker

脚本里的 docker 命令**不带 sudo**（systemd 以 `User=u` 无人值守运行，没有 TTY 输密码，
`sudo docker` 会以 `sudo: a terminal is required to read the password` 失败）。安装前先执行：

```bash
sudo usermod -aG docker u
sudo systemctl restart lcsc-inventory-update.timer   # 让后续 service 启动时带上新组
```

验证（以服务运行用户身份）：`docker info` 能正常输出即可。

### 排错：`error: Your local changes ... would be overwritten by merge`

服务器上有人直接改了版本库内的文件，`pull --ff-only` 会被拒绝，5 分钟重试只会反复失败。
当前版本的脚本会**自动丢弃已跟踪文件的本地修改**后再拉取（未跟踪的 `data/` 等不受影响），
所以这条通常不会再出现。若还碰到，手动执行：

```bash
cd ~/lcsc-inventory
git diff --stat                 # 先看改了什么，确认可以丢弃
git checkout -- .               # 还原已跟踪文件（想要保留的话先 git stash）
```

> 服务器是部署目标，代码改动一律走「本地提交 → push → 自动拉取」，不要在服务器上直接改。

### 排错：`npm error Idle timeout reached for host cdn.npmmirror.com:443`

容器内访问 npm 源超时 / DNS 被污染（常见于 `registry.npmmirror.com` 被解析到 `198.18.x.x`
这类保留地址，`ping` 会看到来自网关的 `Destination Port Unreachable`）。先确认哪个源能用：

```bash
cat /etc/resolv.conf
getent hosts registry.npmmirror.com; getent hosts registry.npmjs.org
for h in registry.npmmirror.com registry.npmjs.org; do
  printf '%-24s ' "$h"
  curl -s -o /dev/null -w '%{http_code} %{time_total}s\n' --max-time 15 "https://$h/next" || echo FAIL
done
```

哪个返回 200 就用哪个。Dockerfile 的源可通过 `--build-arg NPM_REGISTRY=...` 覆盖，
部署脚本会读取环境变量透传，所以在 systemd service 里加一行最稳（纯服务器侧配置，不进仓库）：

```ini
[Service]
Environment=NPM_REGISTRY=https://registry.npmjs.org
```

```bash
sudo systemctl daemon-reload
```

手动构建时：`NPM_REGISTRY=https://registry.npmjs.org docker build --network=host -t lcsc-inventory-app:latest .`

若 DNS 整体有问题（所有域名都解析到异常 IP），换公共 DNS 后再试（见上文「透明代理」一节的
`nameservers: addresses: [223.5.5.5, 119.29.29.29]`）。

> Dockerfile 的 `deps` 阶段用了 `--mount=type=cache,target=/root/.npm`，宿主机 npm 缓存会在多次
> 构建间复用，依赖没变时不必重新下载。需要彻底重来就 `docker builder prune`。

### 排错：`journalctl` 显示 `-- No entries --`

说明 service 从未触发过，通常是 timer 没有 enable：`No entries` ≠ 部署正常，之前的更新可能都是手动跑的。

```bash
systemctl list-timers lcsc-inventory-update.timer   # 看不到或 NEXT 为空 → 未启用
sudo systemctl enable --now lcsc-inventory-update.timer
```

### 排错：`already up to date` 但代码没更新

本地与 `origin/master` 的 SHA 相同，脚本会直接跳过——通常是因为刚刚手动 `git pull` 过。
此时想立刻验证构建链路，手动跑一次即可：

```bash
cd ~/lcsc-inventory
docker build --network=host -t lcsc-inventory-app:latest .
GIT_COMMIT_SHA=$(git rev-parse HEAD) GIT_COMMIT_MESSAGE=$(git log -1 --pretty=%s) \
  docker compose up -d --no-build
```

## 数据库定时备份

另一个 `systemd timer` 每天 03:30（服务器本地时区，避开 02:30 的立创刷新任务）备份 SQLite：
`sqlite3 .backup` 一致性热快照 → gzip → 只保留最近 30 份 → 提交并推送到备份 git 仓库。

前置：宿主机需安装 `sqlite3`（`sudo apt install -y sqlite3`）以获得一致性快照；缺失时脚本退化为
复制 db + WAL 文件（仍可用，但不如 `.backup` 稳妥）。

### 1. 准备备份 git 仓库（异地留存）

在宿主机建一个**私有**仓库（数据库 `settings` 表含 OCR API Key 明文），例如 Gitee / GitHub 私有仓库 /
自建 Git：

```bash
mkdir -p ~/lcsc-inventory-backups
cd ~/lcsc-inventory-backups
git init -b master
git remote add origin git@your-git-server:you/lcsc-inventory-backups.git
```

> 命名易混：**目录**是复数 `~/lcsc-inventory-backups`，**systemd 单元名**是单数
> `lcsc-inventory-backup.service`。别照着单元名建出 `~/lcsc-inventory-backup` 目录，否则会出现
> 两个文件夹、备份跑在错误的那个里。
> 若 `git remote add` 报 `remote origin already exists`，改用
> `git remote set-url origin <url>`（仓库已存在时不要重复 add）。

推送免密：把 systemd 里 `User=` 那个用户的 SSH 公钥加到远端（`ssh -T git@your-git-server` 验证一次，
首次连接需 `ssh-keyscan your-git-server >> ~/.ssh/known_hosts`，否则定时器会因 host key 校验失败）。

### 2. 安装定时器

```bash
cd ~/lcsc-inventory
chmod +x scripts/backup-db.sh
sudo cp deploy/lcsc-inventory-backup.service /etc/systemd/system/
sudo cp deploy/lcsc-inventory-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now lcsc-inventory-backup.timer
```

service 里通过 `Environment=` 写死了路径与保留份数，改完要 `sudo systemctl daemon-reload`。

### 3. 检查与手动执行

```bash
systemctl list-timers lcsc-inventory-backup.timer
sudo journalctl -u lcsc-inventory-backup.service -n 50 --no-pager
sudo systemctl start lcsc-inventory-backup.service   # 立刻跑一次，不等待定时器
ls -lh ~/lcsc-inventory/data/backups
```

### 4. 在应用里查看备份状态

「设置 → 数据库备份」卡片直接显示备份情况，无需登录服务器。数据来源是备份脚本每次执行后
写入的 `data/backups/status.json`（容器内即 `/data/backups/status.json，随 `./data` 挂载），
包含：上次备份时间与距今时长、计划与下次预计时间、保留份数、最新快照体积、
上次执行的耗时与结果、异地 git 推送状态（远端/分支/commit/积压未推送的提交数/失败原因）。

健康判定：超过 **25 小时**没有新快照即标记「已逾期」（每天一次 + 5 分钟随机延迟 + 余量）；
脚本上次执行失败直接标红并显示错误。

> 升级到新版 `backup-db.sh` 之前，页面只会显示兜底信息（扫描目录得出的份数与最后修改时间），
> 异地推送状态要等脚本跑过一次写出 `status.json` 后才有。
> 备份目录可用 `BACKUP_DIR` 环境变量覆盖（默认与数据库同级的 `backups/`）。

### 5. 恢复

```bash
sudo docker compose stop app
gunzip -c ~/lcsc-inventory/data/backups/inventory-YYYYMMDD-HHMMSS.db.gz > ~/lcsc-inventory/data/inventory.db.new
mv ~/lcsc-inventory/data/inventory.db.new ~/lcsc-inventory/data/inventory.db
sudo docker compose start app
```

恢复前建议先确认快照可用：`sqlite3 恢复出来的文件 'PRAGMA integrity_check;'`。

### 说明

- 备份目录 `data/backups` 与 git 仓库工作区都只保留最近 `BACKUP_KEEP` 份；git 历史仍保存全部快照，
  仓库会随时间增长（当前单库压缩后约几十 KB，一年约十几 MB）。仓库过大时可在备份仓库执行
  `git clone --depth 30` 重建，或改用 `rclone` 钩子替代 git。
- 未配置 git 远端时脚本只本地提交并打印提示，不会失败。
- 推送失败会自动退避重试（5s/10s/20s），次数用 `BACKUP_PUSH_RETRIES` 控制（默认 3）。
  网络抖动导致的偶发失败通常重试即恢复；全部失败也不影响本次备份，本地提交保留，
  由下次任务连同新备份一起补推。
- 可选对象存储：在 service 里加 `Environment=BACKUP_RCLONE_REMOTE=myremote:lcsc-backups`
  并安装配置好 rclone，脚本会在备份后额外上传一份。
