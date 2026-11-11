#!/usr/bin/env node
/**
 * scripts/set-component-location.mjs — 录入/批量导入元件的库存位置
 *
 * 位置是自由文本，约定「货架-盒-格」这种能一眼走到的写法，例如 A3-2、B12-05。
 * 注入到辅助焊接页里的备料清单会按这个字段**排序**，所以命名尽量保持字典序与物理
 * 行走顺序一致（A 区在前、号小的在前）。
 *
 * 用法:
 *   node scripts/set-component-location.mjs C15849 A1-3          # 单个
 *   node scripts/set-component-location.mjs C15849 ""            # 清空
 *   node scripts/set-component-location.mjs --import data/locations.json
 *   node scripts/set-component-location.mjs --list               # 列出还没录位置的元件
 *
 * --import 支持 {"C15849":"A1-3"} 或 [{part_number:"C15849", location:"A1-3"}]
 * 位置表里出现库里没有的编号会**跳过并提示**，不会自动建元件。
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { resolveDbTarget } from './lib/db-target.mjs'

const argv = process.argv.slice(2)
const flags = { import: null, list: false, db: null }
const positional = []
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  if (a === '--import') flags.import = path.resolve(argv[++i])
  else if (a === '--list') flags.list = true
  else if (a === '--db') flags.db = path.resolve(argv[++i])
  else positional.push(a)
}

const target = await resolveDbTarget(flags.db)
const client = createClient(target.config)

try {
  const cols = new Set((await client.execute('PRAGMA table_info(components)')).rows.map((r) => String(r.name)))
  if (!cols.has('location')) {
    console.error('库里没有 location 列，先执行：npm run db:init')
    process.exit(1)
  }

  if (flags.list) {
    const rows = await client.execute(
      "SELECT part_number, name, stock_quantity FROM components WHERE status='active' AND (location IS NULL OR trim(location)='') ORDER BY part_number",
    )
    console.log(`未录位置（${target.label}）: ${rows.rows.length} 个`)
    for (const r of rows.rows) {
      console.log(`  ${String(r.part_number).padEnd(14)} ${String(r.name ?? '').slice(0, 40).padEnd(42)} 库存 ${r.stock_quantity}`)
    }
  } else if (flags.import) {
    const raw = JSON.parse(await readFile(flags.import, 'utf8'))
    const entries = Array.isArray(raw)
      ? raw.map((it) => [String(it.part_number ?? it.partNumber ?? '').trim(), String(it.location ?? '').trim()])
      : Object.entries(raw).map(([k, v]) => [String(k).trim(), String(v ?? '').trim()])

    const existing = new Set(
      (await client.execute('SELECT part_number FROM components')).rows.map((r) => String(r.part_number).toUpperCase()),
    )
    const now = new Date().toISOString()
    let ok = 0
    const skipped = []
    for (const [part, loc] of entries) {
      if (!part) continue
      if (!existing.has(part.toUpperCase())) {
        skipped.push(part)
        continue
      }
      await client.execute({
        sql: 'UPDATE components SET location = ?, updated_at = ? WHERE part_number = ? COLLATE NOCASE',
        args: [loc || null, now, part],
      })
      ok++
    }
    console.log(`已写入 ${ok} 条位置（${target.label}）`)
    if (skipped.length) console.log(`跳过 ${skipped.length} 个库里没有的编号: ${skipped.slice(0, 20).join(', ')}${skipped.length > 20 ? ' …' : ''}`)
  } else {
    const [part, loc] = positional
    if (!part) {
      console.error('用法: node scripts/set-component-location.mjs <立创编号> <位置> | --import <json> | --list')
      process.exit(2)
    }
    const result = await client.execute({
      sql: 'UPDATE components SET location = ?, updated_at = ? WHERE part_number = ? COLLATE NOCASE',
      args: [loc ? loc.trim() : null, new Date().toISOString(), part],
    })
    if (!result.rowsAffected) {
      console.error(`库里没有 ${part}（不会自动新建，请先入库）`)
      process.exit(1)
    }
    console.log(`${part.toUpperCase()} 位置 → ${loc ? loc.trim() : '(清空)'}（${target.label}）`)
  }
} finally {
  client.close()
}
