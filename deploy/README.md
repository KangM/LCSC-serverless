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

### 4. 恢复

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
- 可选对象存储：在 service 里加 `Environment=BACKUP_RCLONE_REMOTE=myremote:lcsc-backups`
  并安装配置好 rclone，脚本会在备份后额外上传一份。
