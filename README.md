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
| 导入导出 | CSV 批量导入（缺失信息自动查立创补全、逐行失败汇总）、元件/流水 CSV 导出、**辅助焊接 HTML 注入库存位置** |
| BOM 核对 | 上传 BOM CSV 匹配库存；勾选需要的行后可**按 BOM 数量一次性出库**（同元件多行合并成一笔流水） |
| 统计报表 | 库存价值按分类/封装分布、近 30 天出入库趋势、热门出库 TOP10（Recharts） |
| 设置 | OCR 服务配置（OpenAI 兼容视觉接口 / RapidOCR 自托管） |

## 辅助焊接 HTML 注入库存位置

立创EDA Pro「制造 → 辅助焊接」导出的是一份 ~12MB 的离线单文件 SPA，插件没有接口能改它的
导出内容；但它的 BOM 数据是明文 JSON（`window.files.bom_merge`），所以走**导出后处理**：
在原文件 `</body>` 前追加一段脚本，在 BOM 表格里插一列「库存位置」，其余字节一字节不动
（实测 11.32MB → 11.34MB，只多 18KB）。

**Web**：导入导出页 →「辅助焊接 HTML（注入库存位置）」→ 选文件 → 生成并下载。

**命令行**（离线 / 批量时用）：

```bash
npm run bom:location -- "D:/Downloads/InteractiveBOM_xxx.html"
#   → 同目录输出 xxx-库存位置.html（-o 可指定）
#   --csv [out.csv]  同时导出 BOM 校对 CSV，可直接在 /import 页核对并一键出库
```

「库存位置」= 元件在系统里录入的**位号**（`transactions.reference_designator`，形如
`R1G1` / `CL2A3`，即货位；同一料多次入库取最新一条）。新列插在「器件编号」左边，
一格一行的对照关系直接落在你本来就在看的那张表上。

那一列只有四种取值，不存在「空着不知道什么意思」：

| 显示 | 含义 |
|---|---|
| `R1G1`（绿色） | 去这个货位拿 |
| `封装不符`（橙红） | 库里有同值料但封装不同，**不能拿**（悬停看是哪个料），先补正确封装的库存 |
| `未入库` | 库里没有这个料 |
| `—` | 已入库，但入库流水没填位号 |

### 匹配规则

`立创编号 → 厂商型号 → 名称/值`，后两级共用 `lib/part-match.mjs`（与站内 BOM 核对同一套
识别函数，`1uF` 与 `100nF` 按数值换算、`µ/μ` `Ω/Ω` 统一）：

- **封装必须一致**才会认定命中。同一容值在 0603 / 0805 上是两种物料，回退到「同值但封装
  不同」的料会显示出错误的货位，让人拿错料 —— 比显示「没有」危险得多，所以这里宁可判失败。
- 编号 / 型号命中时不校验封装（编号唯一，系统里的封装字段常有 `C0603`、`0603_L2.5mm` 混写）。
- 归并粒度是 **料号 + 封装**，不是只有料号：立创对没关联商城编号的料只写 `,10uF` 这种值键，
  而 10uF 可能同时有 0805 和 0603 两种（PCB10 的 C1 与 C3 就是）。只按料号归并会把它们
  合成一行，0603 的器件被贴上 0805 的封装和货位。

> 站内 BOM 核对（`/import`）在封装不符时仍会给候选（标「封装未完全匹配」），因为那边是
> 人工逐行核对；这里要直接指导去哪个货架，所以更严格。**不要为了「统一」把回退加回来。**

### 实现要点

- 表格是 React 渲染的，且**表头和数据是两个独立的 `<table>`**（`#resizeTable` / `#founded`），
  插列必须同时动 th、两个 colgroup 的 col、每个 tr 的 td，漏一个就错位。
- 列位置按表头文字「器件编号」定位而非写死索引：手机端会少两列并把封装挪到最后。
- 排序 / 搜索 / 勾选会让 React 重建 tbody，注入的 td 会丢，所以挂了 MutationObserver
  自动补齐（已补齐时直接返回，避免「补 → 触发 → 再补」的死循环）。
- 结构探测：找不到 `designator_info` 或表头没有「器件编号」时不动 DOM，宁可不显示也不插错。
- 逻辑在 `lib/bom-html.mjs`（解析 + 匹配 + 注入），页面脚本在 `lib/bom-table.mjs`
  （String.raw 常量，standalone 构建才打得到），匹配规则在 `lib/part-match.mjs`。

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

批量出库（BOM 扣减）的冒烟验证需要一个空白测试库：

```bash
DATABASE_MODE=sqlite SQLITE_DATABASE_PATH=./data/verify-bom.db node scripts/init-db.mjs
DATABASE_MODE=sqlite SQLITE_DATABASE_PATH=./data/verify-bom.db \
  node --conditions=react-server scripts/verify-bom-consume.mjs
```

`scripts/smoke-bom-consume.mjs` 则打真实 HTTP（需先 `npm run build && npm run start`，
会自己签一个会话 token 绕开登录）：

```bash
SESSION_SECRET=<与启动服务一致> PORT=3000 node scripts/smoke-bom-consume.mjs
```

> 本地构建提示：Next 清理 `.next/turbopack` 时可能触发批量删除保护而失败，
> 可在构建命令前加 `CODEBUDDY_SAFE_DELETE_ENABLED=0`（仅作用于该进程）。
> 另外构建会预渲染首页，需要指向一个**已初始化**的 SQLite 库，否则报 `no such table: components`。

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

### 数据库定时备份

`scripts/backup-db.sh` 在宿主机做一致性热备份（不停止容器），每天 03:30 由 systemd timer 触发：
快照 → gzip → 只保留最近 30 份 → 提交并推送到备份 git 仓库（异地留存）。

完整安装步骤（含 SSH 免密、恢复方法、可选 rclone 上传）见 [`deploy/README.md`](deploy/README.md#数据库定时备份)。

本地手动跑一份：

```bash
npm run db:backup                       # Linux / macOS
bash scripts/backup-db.sh               # Windows 用 Git Bash 执行
BACKUP_KEEP=10 npm run db:backup        # 只保留最近 10 份
```

> 注意：数据库 `settings` 表存有 OCR API Key 明文，备份仓库务必设为**私有**。

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
