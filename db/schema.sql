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
