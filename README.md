# 元件库存管理（LCSC Inventory）

基于**立创商城（LCSC）数据**的个人库存管理系统，部署在 **Vercel**。

- 元件信息来自 [`js-port/lcsc-catalog.js`](js-port/)（立创抓取 + 解析，服务端执行，浏览器不受 CORS 限制）
- 数据存 **Turso（libSQL）**，本地开发零配置（自动用 `file:./data/inventory.db`）
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

验证脚本（开发期）：

```bash
node --conditions=react-server scripts/verify-dao.mjs   # DAO 冒烟
node --conditions=react-server scripts/verify-lcsc.mjs  # 真实抓取立创
```

## 部署到 Vercel

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
  项目已内置**串行限速（800ms）+ 24h 内存缓存 + 失败回退数据库缓存**，入库时抓取、浏览时读库。
- 立创前端改版可能破坏解析（`__NEXT_DATA__` 结构），届时需同步更新 `js-port/lcsc-catalog.js`。
- OCR 的 API Key 明文存数据库 `settings` 表（单密码个人项目，注意保管密码）。
