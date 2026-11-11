#!/usr/bin/env node
/**
 * scripts/inject-bom-location.mjs — 给立创EDA Pro「辅助焊接」导出的离线 HTML
 * 注入「备料清单（含库存位置）」抽屉。库存位置 = 系统里录入的位号。
 *
 * 解析与注入逻辑在 lib/bom-html.mjs（Web 端 /import 页用的是同一份）。
 *
 * 用法:
 *   node scripts/inject-bom-location.mjs <input.html> [-o out.html]
 *       [--db data/inventory.db] [--locations data/locations.json] [--json] [--csv [out.csv]]
 *
 *   --db        库存库（默认与 app 同一套规则：.env.local 的 Turso → 本地 data/inventory.db）
 *               读 components.stock_quantity 与 transactions.reference_designator（每料取最新一条）
 *   --locations 覆盖表（JSON: {"C15849":"R1G1"} 或 {"C15849":{"location":"R1G1","stock":40}}），
 *               键支持立创编号 / 厂商型号 / lc_code，用于库里还没录位号时先预览效果
 *   --csv       同时导出「BOM 校对」CSV（列：位号,名称,封装,供应商,数量），
 *               可直接丢给站内 /import 的 BOM 核对 → 一键出库
 *   --json      额外把解析出的备料清单打印成 JSON（调试用）
 *
 * 输出：默认写到输入文件同目录、文件名加 `-库存位置` 后缀。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { createClient } from '@libsql/client'
import { resolveDbTarget } from './lib/db-target.mjs'
import {
  TABLE_SOURCE,
  buildBomCsv,
  buildItems,
  buildPayload,
  extractWindowFiles,
  injectTableColumn,
  matchInventory,
  parseBom,
  pcbNameFromFileName,
} from '../lib/bom-html.mjs'

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { input: null, out: null, db: null, locations: null, json: false, csv: null }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--db') args.db = path.resolve(argv[++i])
    else if (a === '--locations') args.locations = path.resolve(argv[++i])
    else if (a === '--json') args.json = true
    else if (a === '--csv') {
      // --csv 后面跟路径就用它，否则自动命名（输入文件同名 .bom.csv）
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args.csv = path.resolve(next)
        i++
      } else args.csv = true
    } else if (!a.startsWith('-') && !args.input) args.input = path.resolve(a)
    else {
      console.error(`未知参数: ${a}`)
      process.exit(2)
    }
  }
  if (!args.input) {
    console.error('用法: node scripts/inject-bom-location.mjs <input.html> [-o out.html] [--db ...] [--locations ...] [--csv [out.csv]]')
    process.exit(2)
  }
  return args
}

// ---------------------------------------------------------------------------
// 库存（含系统位号）
// ---------------------------------------------------------------------------

/**
 * 位号和 lib/db.ts 的取法保持一致：同一个料可能入库多次、每次记不同位号，
 * 取**最新一条**（ORDER BY id DESC）作为它当前的位置。
 *
 * 一并带出封装与规格参数：宽松匹配要靠它们区分「同值不同封装」的料
 * （10uF 在 0603 和 0805 上是两种物料），只靠编号/型号会漏掉一半。
 */
async function loadInventory(dbArg) {
  const target = await resolveDbTarget(dbArg)
  const client = createClient(target.config)
  try {
    const rows = await client.execute(`
      SELECT c.part_number, c.mpn, c.name, c.description, c.package_name, c.specifications,
             c.stock_quantity, c.status,
             (SELECT t.reference_designator FROM transactions t
               WHERE t.part_number = c.part_number
                 AND t.reference_designator IS NOT NULL AND trim(t.reference_designator) <> ''
               ORDER BY t.id DESC LIMIT 1) AS reference_designator
      FROM components c`)
    const components = rows.rows.map((r) => ({
      partNumber: String(r.part_number || ''),
      mpn: r.mpn ? String(r.mpn).trim() : '',
      name: r.name ? String(r.name) : '',
      description: r.description ? String(r.description) : '',
      packageName: r.package_name ? String(r.package_name) : '',
      specifications: (() => {
        try {
          const v = JSON.parse(String(r.specifications ?? '{}'))
          return v && typeof v === 'object' ? v : {}
        } catch {
          return {}
        }
      })(),
      stock: Number(r.stock_quantity ?? 0),
      reference: r.reference_designator ? String(r.reference_designator).trim() : '',
      status: String(r.status || 'active'),
    }))
    return { components, label: target.label }
  } finally {
    client.close()
  }
}

async function loadOverrides(file) {
  if (!file) return new Map()
  const raw = JSON.parse(await readFile(file, 'utf8'))
  const map = new Map()
  const put = (key, val) => {
    if (!key) return
    if (val && typeof val === 'object') {
      map.set(String(key).toUpperCase(), {
        reference: String(val.location ?? val.reference ?? '').trim(),
        stock: val.stock == null ? null : Number(val.stock),
      })
    } else {
      map.set(String(key).toUpperCase(), { reference: String(val ?? '').trim(), stock: null })
    }
  }
  if (Array.isArray(raw)) {
    for (const it of raw) put(it.part_number ?? it.partNumber ?? it.key, it)
  } else {
    for (const [k, v] of Object.entries(raw)) put(k, v)
  }
  return map
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
const t0 = Date.now()

const html = await readFile(args.input, 'utf8')
const { obj: files } = extractWindowFiles(html)
const items = buildItems(parseBom(files))
if (!items.length) throw new Error('解析出 0 个贴片位号，导出文件可能没勾选任何元件')

const inv = await loadInventory(args.db)
const overrides = await loadOverrides(args.locations)
const matched = matchInventory(items, { components: inv.components, overrides })

const payload = buildPayload({
  items: matched,
  pcbName: pcbNameFromFileName(args.input),
  sourceLabel: overrides.size ? `覆盖表 + ${inv.label}` : inv.label,
})

const out = args.out
  ? path.resolve(args.out)
  : path.join(path.dirname(args.input), path.basename(args.input, path.extname(args.input)) + '-库存位置.html')

await writeFile(out, injectTableColumn(html, payload, TABLE_SOURCE), 'utf8')

let csvOut = null
if (args.csv) {
  csvOut =
    args.csv === true
      ? path.join(path.dirname(out), path.basename(out, path.extname(out)).replace(/-库存位置$/, '') + '.bom.csv')
      : args.csv
  await writeFile(csvOut, buildBomCsv(matched), 'utf8')
}

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const noRef = matched.filter((it) => it.matched && !it.reference)
const bad = matched.filter((it) => it.shortage)
const unmatched = matched.filter((it) => !it.matched)
const pkgBad = matched.filter((it) => it.reason === 'pkg')

console.log(`输入: ${args.input}`)
console.log(`输出: ${out}`)
if (csvOut) console.log(`BOM CSV: ${csvOut}（可直接在站内 /import 页做 BOM 核对并一键出库）`)
console.log(
  `元件: ${payload.counts.items} 种料 / ${payload.counts.designators} 个位号` +
    ` · 已入库未录位号 ${noRef.length} · 缺料 ${bad.length}` +
    ` · 未入库 ${unmatched.length - pkgBad.length} · 封装不符 ${pkgBad.length}` +
    ` · 耗时 ${Date.now() - t0}ms`,
)
if (noRef.length) {
  console.log('\n已入库但没录位号（前 10，去「元件列表 → 详情」或入库时填写）:')
  for (const it of noRef.slice(0, 10)) {
    console.log(`  ${it.designators.padEnd(24)} ${(it.partNumber || it.mpn || it.value || '?').padEnd(16)} ${it.name}`)
  }
  if (noRef.length > 10) console.log(`  … 还有 ${noRef.length - 10} 种`)
}
if (pkgBad.length) {
  console.log('\n封装不符（库里有同值料但封装不同，不能直接拿）:')
  for (const it of pkgBad) {
    console.log(`  ${it.designators.padEnd(24)} ${String(it.value).padEnd(10)} 需要 ${it.footprint} / 库里有 ${it.nearHint}`)
  }
}
if (bad.length) {
  console.log('\n缺料:')
  for (const it of bad) console.log(`  ${it.designators.padEnd(24)} 需 ${it.qty} / 有 ${it.stock}`)
}

if (args.json) console.log('\n' + JSON.stringify(payload.rows, null, 2))
