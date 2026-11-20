-- 库存管理系统数据库结构（Turso / libSQL 兼容）
-- 用于本地 file: 库初始化与远程 Turso 库建表，两边保持同一份 SQL。

-- 元件表：以立创编号为主键，元件静态信息 + 当前库存
CREATE TABLE IF NOT EXISTS components (
  part_number     TEXT PRIMARY KEY,                    -- 立创编号，如 C14663
  mpn             TEXT,                                -- 厂商型号，如 GRM188R71C104KA01D
  name            TEXT,                                -- 显示名
  brand           TEXT,                                -- 品牌
  package_name    TEXT,                                -- 封装
  category        TEXT,                                -- 分类
  description     TEXT,                                -- 描述
  price           REAL,                                -- 第一档价格（元）
  stock_quantity  INTEGER NOT NULL DEFAULT 0,          -- 当前库存数量
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'deleted')),
  threshold       INTEGER NOT NULL DEFAULT 0,          -- 低库存预警阈值（<= threshold 报警）
  product_url     TEXT,                                -- 立创商品页
  datasheet_url   TEXT,                                -- 数据手册
  image_url       TEXT,                                -- 商品图
  specifications  TEXT,                                -- 规格参数表（JSON 字符串）
  last_fetched_at TEXT,                                -- 上次从立创抓取时间（ISO 8601）
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 流水表：每次出入库/盘点一条记录
CREATE TABLE IF NOT EXISTS transactions (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number  TEXT NOT NULL REFERENCES components(part_number) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('in', 'out', 'adjust')),
  quantity     INTEGER NOT NULL,                       -- in/out 为正数；adjust 为变化量（可正可负）
  before_qty   INTEGER NOT NULL,                       -- 操作前库存
  after_qty    INTEGER NOT NULL,                       -- 操作后库存
  reference_designator TEXT,                            -- 位号，如 R12、C3-C6
  purchase_price REAL,                                 -- 本次入手单价（元）
  note         TEXT,                                   -- 备注
  operator     TEXT,                                   -- 操作人
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_transactions_part_number ON transactions(part_number);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at  ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_transactions_type        ON transactions(type);

-- 设置表（KV）：OCR 配置、默认阈值等
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- ---------------------------------------------------------------------------
-- 采购订单（淘宝 / 立创商城）——「已买未入库」的数量即 BOM 核对里的在途量
-- ---------------------------------------------------------------------------

-- 采购账户：同一个平台可以配多个账号，各自保存一份登录 Cookie
CREATE TABLE IF NOT EXISTS purchase_accounts (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source            TEXT NOT NULL CHECK (source IN ('lcsc', 'taobao')),
  label             TEXT NOT NULL,                       -- 显示名，如「个人号」「公司采购号」
  username          TEXT,                                -- 账号标识（选填）
  cookie            TEXT NOT NULL,                       -- 登录 Cookie（等同凭证，禁止外传）
  cookie_updated_at TEXT,                                -- Cookie 最后一次更新时间
  enabled           INTEGER NOT NULL DEFAULT 1,          -- 0 = 暂停同步
  last_sync_at      TEXT,
  last_sync_status  TEXT,                                -- ok / cookie_expired / error
  last_sync_message TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, label)
);

-- 采购订单：平台同步或手工录入
CREATE TABLE IF NOT EXISTS purchase_orders (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  source         TEXT NOT NULL CHECK (source IN ('lcsc', 'taobao', 'manual')),
  account_id     INTEGER REFERENCES purchase_accounts(id) ON DELETE SET NULL,
  order_no       TEXT NOT NULL,
  status_text    TEXT,                                   -- 平台原始状态原文，如「已发货」
  shipment_state TEXT NOT NULL DEFAULT 'unknown'         -- 归一化后的物流阶段
                 CHECK (shipment_state IN ('pending', 'shipped', 'received', 'cancelled', 'unknown')),
  ordered_at     TEXT,
  shipped_at     TEXT,
  received_at    TEXT,
  total_amount   REAL,
  note           TEXT,
  raw            TEXT,                                   -- 平台原始数据（JSON），便于回溯
  synced_at      TEXT,
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, order_no)
);

-- 订单行：一行一种料
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id            INTEGER NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no             INTEGER,                           -- 平台侧行号
  supplier_part_no    TEXT,                              -- 平台上该行的商品编号（立创 C14663 / 淘宝商品 ID）
  mpn                 TEXT,
  title               TEXT NOT NULL,                     -- 商品标题（淘宝只有标题可依据）
  quantity            INTEGER NOT NULL,
  unit_price          REAL,
  matched_part_number TEXT,                              -- 匹配到的库存元件（components.part_number）
  match_source        TEXT,                              -- lcsc_code / mpn / alias / manual / none
  consumed_quantity   INTEGER NOT NULL DEFAULT 0,        -- 已核销入库数量
  note                TEXT,
  created_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- 标题别名：淘宝行只有标题，人工绑定一次后同类标题自动命中
CREATE TABLE IF NOT EXISTS purchase_item_aliases (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  source      TEXT NOT NULL CHECK (source IN ('lcsc', 'taobao', 'manual')),
  keyword     TEXT NOT NULL,                             -- 归一化后的标题/型号关键词
  part_number TEXT NOT NULL,                             -- 对应库存元件
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  UNIQUE (source, keyword, part_number)
);

CREATE INDEX IF NOT EXISTS idx_purchase_orders_state   ON purchase_orders(shipment_state);
CREATE INDEX IF NOT EXISTS idx_purchase_orders_account ON purchase_orders(account_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_order  ON purchase_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_purchase_order_items_part   ON purchase_order_items(matched_part_number);
