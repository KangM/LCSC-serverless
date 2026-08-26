# 元件库存管理（LCSC Inventory）

基于**立创商城（LCSC）数据**的个人库存管理系统，推荐以 **Docker + 本地 SQLite** 部署。

- 元件信息来自 [`js-port/lcsc-catalog.js`](js-port/)（立创抓取 + 解析，服务端执行，浏览器不受 CORS 限制）
- Docker 数据存宿主机持久卷中的 **SQLite**；可从 Turso 一次性迁移历史数据
- 单密码认证（HMAC 签名 session cookie，`proxy.ts` 全局保护）

## 功能

| 模块 | 说明 |
|---|---|
| 仪表盘 | 统计卡（种类/总量/总值/低库存）、低库存预警列表、近期流水 |
| 元件列表 | 关键词搜索（编号/MPN/名称）、分类/封装筛选、7 种排序、分页、勾选批量出库 |
| 元件详情 | 立创信息卡、规格参数表、出入库流水时间线、低库存阈值、手动刷新立创信息 |
| 入库 | 手输编号 / **扫码**（立创料盘二维码 `{on,pc,pm,qty}`，自动预填数量）/ **拍照 OCR** 三通道 |
| 出库/盘点 | 出库校验库存不足，盘点按实点数自动算差额；全部原子写流水 |
| 流水记录 | 按元件/类型/时间筛选、分页、CSV 导出（当前筛选） |
| 导入导出 | CSV 批量导入（缺失信息自动查立创补全、逐行失败汇总）、元件/流水 CSV 导出 |
| 统计报表 | 库存价值按分类/封装分布、近 30 天出入库趋势、热门出库 TOP10（Recharts） |
| 设置 | OCR 服务配置（OpenAI 兼容视觉接口 / RapidOCR 自托管） |

## 本地开发

```bash
npm install          # 已配置 .npmrc 国内镜像源
npm run db:init      # 初始化本地库 file:./data/inventory.db
cp .env.example .env.local   # 按需改 APP_PASSWORD
npm run dev          # http://localhost:3000（登录密码默认 test123 需自行修改）
```

本地 SQLite 默认路径是 `data/inventory.db`。可用 `DATABASE_MODE=sqlite` 和
`SQLITE_DATABASE_PATH=/绝对路径/inventory.db` 显式指定路径。

验证脚本（开发期）：

```bash
node --conditions=react-server scripts/verify-dao.mjs   # DAO 冒烟
node --conditions=react-server scripts/verify-lcsc.mjs  # 真实抓取立创
```

## Docker 部署（推荐）

要求：Docker Engine 与 Docker Compose。SQLite 文件通过 `./data:/data` 挂载在宿主机，
不要删除或替换该目录。

1. 在项目根目录创建 `.env`：

   ```env
   APP_PASSWORD=your-password
   SESSION_SECRET=replace-with-a-random-64-char-secret
   CRON_SECRET=replace-with-a-second-random-secret
   ```

2. 启动应用：

   ```bash
   GIT_COMMIT_SHA=$(git rev-parse HEAD) \
   GIT_COMMIT_MESSAGE="$(git log -1 --pretty=%s)" \
   docker compose up -d --build
   ```

   PowerShell：

   ```powershell
   $env:GIT_COMMIT_SHA = git rev-parse HEAD
   $env:GIT_COMMIT_MESSAGE = git log -1 --pretty=%s
   docker compose up -d --build
   ```

   这两项仅用于网站侧边栏显示当前镜像对应的提交信息。

3. 首次启动会自动在 `/data/inventory.db` 建表。健康检查地址为
   `http://localhost:3000/api/health`。

4. 需要每日刷新立创数据时，额外启动可选的定时服务：

   ```bash
   docker compose --profile cron up -d
   ```

   定时器使用容器的 `Asia/Shanghai` 时区，每天 02:30 调用一次受 `CRON_SECRET`
   保护的刷新接口。

### Turso 数据迁移

先停止写入，选择一个**不存在或为空**的目标 SQLite 路径，然后执行：

```bash
TURSO_DATABASE_URL=libsql://... TURSO_AUTH_TOKEN=... \
SQLITE_DATABASE_PATH=./data/inventory.db npm run db:migrate:turso
```

迁移脚本复制 `components`、`transactions` 和 `settings`，保留流水 ID 与时间戳。
若目标库已有任一业务表数据，脚本会拒绝执行，避免覆盖。

SQLite 为单机文件数据库：只运行一个应用副本，定期备份宿主机 `data/inventory.db`。

## 部署到 Vercel（旧路径）

1. **Turso 建库**：https://turso.tech → Create Database，拿到 URL 与 token。
2. **Vercel 导入项目**（Framework Preset 选 Next.js），配置环境变量：

   | 变量 | 必填 | 说明 |
   |---|---|---|
   | `TURSO_DATABASE_URL` | 是 | Turso 库 URL（`libsql://xxx.turso.io`） |
   | `TURSO_AUTH_TOKEN` | 是 | Turso 鉴权 token |
   | `APP_PASSWORD` | 是 | 登录密码 |
   | `SESSION_SECRET` | 是 | `openssl rand -hex 32` 生成 |
   | `CRON_SECRET` | 否 | 定时任务鉴权（Vercel Cron 自动附带） |

3. **建表**：本地或任意环境执行
   `TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:init`
4. **Cron**（Hobby 计划每日一次）：`vercel.json` 已配置每日 02:30 刷新全部元件信息。
5. 部署后访问站点，登录并入库第一个元件（会自动拉取立创数据）。

## OCR 配置（设置页）

- **OpenAI 兼容视觉接口**：免费可选智谱 `glm-4v-flash`
  （`baseUrl=https://open.bigmodel.cn/api/paas/v4`，`model=glm-4v-flash`，去 https://bigmodel.cn 免费申请 key）。
- **RapidOCR 自托管**：`pip install rapidocr_api && rapidocr_api -p 9003`，
  服务需公网可达（Vercel 云端访问不到内网，用 cloudflared/frp 隧道暴露 `https://…/ocr`）。

## 说明与限制

- 立创商城无官方 API，数据通过页面/接口抓取：高频调用可能触发风控。
  项目以 800ms 启动间隔限速，但不会等待前一个立创网络请求完成；上游超时、验证页、HTTP 和响应格式错误均会返回可诊断的 502。
- 立创前端改版可能破坏解析（`__NEXT_DATA__` 结构），届时需同步更新 `js-port/lcsc-catalog.js`。
- OCR 的 API Key 明文存数据库 `settings` 表（单密码个人项目，注意保管密码）。
