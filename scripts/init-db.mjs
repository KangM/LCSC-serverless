/**
 * scripts/init-db.mjs — 初始化数据库（建表）
 *
 * 用法:
 *   npm run db:init                     # 本地 file:./data/inventory.db
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... npm run db:init   # 远程 Turso
 *
 * 幂等：schema.sql 全部使用 IF NOT EXISTS。
 */
import { readFile } from 'node:fs/promises'
import { createClient } from '@libsql/client'

const url = process.env.TURSO_DATABASE_URL
const client = createClient(
  url ? { url, authToken: process.env.TURSO_AUTH_TOKEN } : { url: 'file:./data/inventory.db' },
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

// 校验三张表都建好了
const check = await client.execute(
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('components','transactions','settings') ORDER BY name",
)
console.log('已建表:', check.rows.map((r) => r.name).join(', '))
client.close()
