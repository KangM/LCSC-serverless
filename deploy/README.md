# 自动部署

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
