/**
 * 将 Turso 中的应用数据复制到一个全新的 SQLite 文件。
 *
 * 用法：
 *   TURSO_DATABASE_URL=... TURSO_AUTH_TOKEN=... SQLITE_DATABASE_PATH=./data/inventory.db npm run db:migrate:turso
 *
 * 为防止误覆盖，目标库任一业务表已有数据时会直接失败。
 */
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@libsql/client'

const TABLES = [
  {
    name: 'components',
    columns: [
      'part_number', 'mpn', 'name', 'brand', 'package_name', 'category', 'description',
      'price', 'stock_quantity', 'threshold', 'product_url', 'datasheet_url', 'image_url',
      'specifications', 'last_fetched_at', 'created_at', 'updated_at',
    ],
    orderBy: 'part_number',
  },
  {
    name: 'transactions',
    columns: ['id', 'part_number', 'type', 'quantity', 'before_qty', 'after_qty', 'note', 'operator', 'created_at'],
    orderBy: 'id',
  },
  {
    name: 'settings',
    columns: ['key', 'value'],
    orderBy: 'key',
  },
]

const CHUNK_SIZE = 100
const DEFAULT_SQLITE_PATH = fileURLToPath(new URL('../data/inventory.db', import.meta.url))

async function loadDotEnvLocal() {
  try {
    const text = await readFile(new URL('../.env.local', import.meta.url), 'utf8')
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) continue
      const separator = trimmed.indexOf('=')
      if (separator <= 0) continue
      const key = trimmed.slice(0, separator).trim()
      let value = trimmed.slice(separator + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      if (key && !process.env[key]) process.env[key] = value
    }
  } catch {
    // 无 .env.local 时由显式环境变量提供源库连接信息。
  }
}

function schemaStatements(schema) {
  return schema
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
}

await loadDotEnvLocal()

if (!process.env.TURSO_DATABASE_URL) {
  throw new Error('缺少 TURSO_DATABASE_URL，无法确定迁移源库')
}

const targetPath = path.resolve(process.env.SQLITE_DATABASE_PATH ?? DEFAULT_SQLITE_PATH)
await mkdir(path.dirname(targetPath), { recursive: true })

const source = createClient({
  url: process.env.TURSO_DATABASE_URL,
  authToken: process.env.TURSO_AUTH_TOKEN,
})
const target = createClient({ url: pathToFileURL(targetPath).href })

try {
  const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
  for (const statement of schemaStatements(schema)) await target.execute(statement)

  for (const table of TABLES) {
    const existing = await target.execute(`SELECT COUNT(*) AS count FROM ${table.name}`)
    if (Number(existing.rows[0]?.count ?? 0) > 0) {
      throw new Error(`目标数据库 ${targetPath} 的 ${table.name} 已有数据；请指定新的 SQLITE_DATABASE_PATH`)
    }
  }

  for (const table of TABLES) {
    const sourceRows = await source.execute(`SELECT ${table.columns.join(', ')} FROM ${table.name} ORDER BY ${table.orderBy}`)
    const placeholders = table.columns.map(() => '?').join(', ')
    const sql = `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`

    for (let offset = 0; offset < sourceRows.rows.length; offset += CHUNK_SIZE) {
      const chunk = sourceRows.rows.slice(offset, offset + CHUNK_SIZE)
      await target.batch(chunk.map((row) => ({
        sql,
        args: table.columns.map((column) => row[column]),
      })), 'write')
    }
    console.log(`已迁移 ${table.name}: ${sourceRows.rows.length} 行`)
  }

  console.log(`迁移完成：${targetPath}`)
} finally {
  source.close()
  target.close()
}
