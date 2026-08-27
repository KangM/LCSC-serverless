/**
 * scripts/init-db.mjs — 初始化数据库（建表）
 *
 * 用法:
 *   npm run db:init                     # 优先读 .env.local 的 TURSO_*；否则本地 file:./data/inventory.db
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:init   # 显式传环境变量（优先于 .env.local）
 *
 * 幂等：schema.sql 全部使用 IF NOT EXISTS。
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'

const DEFAULT_SQLITE_PATH = fileURLToPath(new URL('../data/inventory.db', import.meta.url))

// 轻量加载 .env.local（Next.js 只在自身进程自动加载，纯 Node 脚本需要手动读）
// 仅当对应变量未被环境变量显式设置时生效。
async function loadDotEnvLocal() {
  try {
    const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const idx = trimmed.indexOf('=')
      if (idx <= 0) continue
      const key = trimmed.slice(0, idx).trim()
      let value = trimmed.slice(idx + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && !process.env[key]) process.env[key] = value
    }
  } catch {
    // 无 .env.local 则忽略
  }
}

await loadDotEnvLocal()

const useTurso = process.env.DATABASE_MODE === 'turso'
  || (process.env.DATABASE_MODE !== 'sqlite' && Boolean(process.env.TURSO_DATABASE_URL))
const sqlitePath = path.resolve(process.env.SQLITE_DATABASE_PATH ?? DEFAULT_SQLITE_PATH)
if (!useTurso) await mkdir(path.dirname(sqlitePath), { recursive: true })
const client = createClient(
  useTurso
    ? { url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }
    : { url: pathToFileURL(sqlitePath).href },
)

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
// 去掉行首注释行（避免整段以注释开头被误判），再按分号切分执行
const statements = schema
  .split('\n')
  .filter((line) => !line.trim().startsWith('--'))
  .join('\n')
  .split(';')
  .map((s) => s.trim())
  .filter(Boolean)

for (const stmt of statements) {
  await client.execute(stmt)
}

// 旧库由 CREATE TABLE IF NOT EXISTS 保留原结构；为入库流水补齐新增列。
const transactionColumns = new Set(
  (await client.execute('PRAGMA table_info(transactions)')).rows.map((row) => String(row.name)),
)
if (!transactionColumns.has('reference_designator')) {
  await client.execute('ALTER TABLE transactions ADD COLUMN reference_designator TEXT')
}
if (!transactionColumns.has('purchase_price')) {
  await client.execute('ALTER TABLE transactions ADD COLUMN purchase_price REAL')
}

const componentColumns = new Set(
  (await client.execute('PRAGMA table_info(components)')).rows.map((row) => String(row.name)),
)
if (!componentColumns.has('status')) {
  await client.execute("ALTER TABLE components ADD COLUMN status TEXT NOT NULL DEFAULT 'active'")
}

// 位号是物理存储位置，非空时必须全局唯一（不区分大小写）。
await client.execute(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_reference_designator
  ON transactions(reference_designator COLLATE NOCASE)
  WHERE reference_designator IS NOT NULL AND trim(reference_designator) <> ''
`)

// 校验三张表都建好了
const check = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('components','transactions','settings') ORDER BY name",
)
console.log(`已建表（${useTurso ? 'Turso' : sqlitePath}）:`, check.rows.map((r) => r.name).join(', '))
client.close()
