#!/usr/bin/env node
/**
 * scripts/inject-bom-location.mjs — 给立创EDA Pro「辅助焊接」导出的离线 HTML
 * 注入「备料清单（含库存位置）」抽屉。
 *
 * 为什么是后处理而不是 EDA 插件：那份 HTML 是立创 SMT 引擎输出的编译产物（React SPA），
 * 插件侧没有钩子能改它的导出内容；但它的 BOM 数据是明文 JSON，位于
 *   window.files.bom_merge → JSON → data.{designator_info, comp_info}
 * 里，注入只加 ~15KB，11MB 主体一字节不动。
 *
 * 用法:
 *   node scripts/inject-bom-location.mjs <input.html> [-o out.html]
 *       [--db data/inventory.db] [--locations data/locations.json] [--json]
 *
 *   --db        库存库（默认与 app 同一套规则：.env.local 的 Turso → 本地 data/inventory.db）
 *               读 components.location / stock_quantity
 *   --locations 位置覆盖表（JSON: {"C15849":"A1-1"}，键支持立创编号 / 厂商型号 / lc_code），
 *               用于库里还没录位置时先跑通、或从表格批量导入前预览
 *   --json      额外把解析出的备料清单打印成 JSON（调试用）
 *
 * 输出：默认写到输入文件同目录、文件名加 `-库存位置` 后缀。
 */
import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@libsql/client'
import { resolveDbTarget } from './lib/db-target.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))

// ---------------------------------------------------------------------------
// 参数
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { input: null, out: null, db: null, locations: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '-o' || a === '--out') args.out = argv[++i]
    else if (a === '--db') args.db = path.resolve(argv[++i])
    else if (a === '--locations') args.locations = path.resolve(argv[++i])
    else if (a === '--json') args.json = true
    else if (!a.startsWith('-') && !args.input) args.input = path.resolve(a)
    else {
      console.error(`未知参数: ${a}`)
      process.exit(2)
    }
  }
  if (!args.input) {
    console.error('用法: node scripts/inject-bom-location.mjs <input.html> [-o out.html] [--db ...] [--locations ...]')
    process.exit(2)
  }
  return args
}

// ---------------------------------------------------------------------------
// 1. 解析辅助焊接 HTML
// ---------------------------------------------------------------------------

/**
 * window.files 是一个 JSON 字面量，紧跟其后是 `}; window.__ENGING_*`。
 * 不用正则整体匹配（4MB 单行 + 内部字符串含 `};`），改用「从 window.files = 起，
 * 找到 `}; window.__ENGING` 之前」的边界切片 —— 这是实测最稳的定位方式。
 */
function extractWindowFiles(html) {
  const marker = 'window.files = '
  const start = html.indexOf(marker)
  if (start < 0) throw new Error('没找到 window.files —— 这看起来不是立创「辅助焊接」导出的 HTML')
  const from = start + marker.length

  let end = html.indexOf('}; window.__ENGING', from)
  if (end < 0) end = html.indexOf('};window.__ENGING', from)
  if (end < 0) {
    // 兜底：从 from 起做括号配平（字符串内的 { } 会被跳过）
    end = matchObjectEnd(html, html.indexOf('{', from))
  }
  if (end < 0) throw new Error('没能定位 window.files 的结尾，立创可能改了导出结构')

  const literal = html.slice(from, end + 1)
  return { obj: JSON.parse(literal), start, from, end, literal }
}

function matchObjectEnd(text, openIdx) {
  if (openIdx < 0) return -1
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = openIdx; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/** bom_merge 是「字符串里套字符串」的两层编码，逐层解开。 */
function parseBom(files) {
  if (!files.bom_merge) throw new Error('window.files 里没有 bom_merge（可能不是 SMT 焊接图，而是别的导出）')
  const outer = JSON.parse(files.bom_merge)
  if (!outer || !outer.data) throw new Error('bom_merge 缺少 data 字段')
  const data = JSON.parse(outer.data)
  if (!data.designator_info) throw new Error('bom_merge.data 里没有 designator_info —— 导出结构已变化，本工具需要适配')
  return data
}

/**
 * 把 designator_info 里的贴片记录按 lc_code 归并成「一种料一行」。
 * lc_code 形如 "C15849,1uF"（立创编号,值），也可能是 ",10uF"（未关联商城）或 ""。
 * 完全没有编号的（如 LED_0603-G / USB 座），按「值+封装」归并 —— 否则每个位号会各成一行。
 */
function buildItems(data) {
  const comp = data.comp_info || {}
  const groups = new Map()

  for (const set of data.designator_info) {
    for (const side of ['top', 'bottom']) {
      for (const p of set[side] || []) {
        if (!p || !p.des) continue
        if (p.is_mount === false) continue // 只统计要贴的
        const key = p.lc_code || `#${p.cm || ''}|${p.ft_name || ''}`
        let g = groups.get(key)
        if (!g) {
          g = { key, lcCode: p.lc_code || '', designators: [], sides: new Set(), cm: p.cm || '', ft: p.ft_name || '' }
          groups.set(key, g)
        }
        g.designators.push(p.des)
        g.sides.add(side)
      }
    }
  }

  const items = []
  for (const g of groups.values()) {
    const info = comp[g.key] || (g.lcCode ? {} : comp[''] || {})
    const [codeFromKey, valueFromKey] = splitLcCode(g.lcCode)
    const partNumber = cleanString(info['Supplier Part']) || codeFromKey || ''
    const value =
      cleanString(info.value) || cleanString(info.Value) || valueFromKey || cleanString(g.cm) || ''
    items.push({
      key: g.key,
      partNumber,
      mpn: cleanString(info['Manufacturer Part']),
      name: cleanString(info.Name) || cleanString(info['LCSC Part Name']),
      value,
      footprint: cleanString(info['Supplier Footprint']) || cleanString(info.lc_pkg) || cleanString(g.ft),
      designators: sortDesignators(g.designators),
      qty: g.designators.length,
      sides: [...g.sides].sort().join('/'),
      bomClass: cleanString(info['JLCPCB Part Class']),
      description: cleanString(info.Description),
    })
  }
  return items.sort((a, b) => a.designators.localeCompare(b.designators, 'en', { numeric: true }))
}

function cleanString(v) {
  if (v == null) return ''
  const s = String(v).trim()
  return s === 'None' || s === 'null' || s === 'undefined' ? '' : s
}

function splitLcCode(lcCode) {
  if (!lcCode) return ['', '']
  const idx = lcCode.indexOf(',')
  if (idx < 0) return [lcCode.trim(), '']
  return [lcCode.slice(0, idx).trim(), lcCode.slice(idx + 1).trim()]
}

/** C1,C2,C10 → C1,C2,C10（自然序，避免 C10 跑到 C2 前面） */
function sortDesignators(list) {
  return list
    .slice()
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }))
    .join(',')
}

// ---------------------------------------------------------------------------
// 2. 匹配库存
// ---------------------------------------------------------------------------

async function loadInventory(dbArg) {
  // 与 scripts/init-db.mjs 同一套解析规则：显式 --db > DATABASE_MODE=sqlite > TURSO_* > 本地 data/inventory.db
  const target = await resolveDbTarget(dbArg)
  const client = createClient(target.config)
  try {
    const cols = new Set((await client.execute('PRAGMA table_info(components)')).rows.map((r) => String(r.name)))
    const hasLocation = cols.has('location')
    if (!hasLocation) {
      console.warn('⚠ 库里还没有 location 列，先跑一次 `npm run db:init` 补列；本次所有位置都会显示为「—」。')
    }
    const rows = await client.execute(
      `SELECT part_number, mpn, name, stock_quantity, status${hasLocation ? ', location' : ''} FROM components`,
    )
    const byPart = new Map()
    const byMpn = new Map()
    for (const r of rows.rows) {
      const rec = {
        partNumber: String(r.part_number || '').toUpperCase(),
        mpn: r.mpn ? String(r.mpn).trim().toUpperCase() : '',
        name: r.name ? String(r.name) : '',
        stock: Number(r.stock_quantity ?? 0),
        location: hasLocation && r.location ? String(r.location).trim() : '',
        status: String(r.status || 'active'),
      }
      if (rec.partNumber) byPart.set(rec.partNumber, rec)
      if (rec.mpn) byMpn.set(rec.mpn, rec)
    }
    return { byPart, byMpn, label: target.label }
  } finally {
    client.close()
  }
}


async function loadLocationOverrides(file) {
  if (!file) return new Map()
  const raw = JSON.parse(await readFile(file, 'utf8'))
  const map = new Map()
  // 支持三种写法：
  //   {"C15849":"A1-1"}                       —— 只给位置
  //   {"C15849":{"location":"A1-1","stock":40}} —— 位置 + 库存（库里还没这料时用）
  //   [{part_number, location, stock}]        —— 数组形式
  const put = (key, val) => {
    if (!key) return
    if (val && typeof val === 'object') {
      map.set(String(key).toUpperCase(), {
        location: String(val.location ?? '').trim(),
        stock: val.stock == null ? null : Number(val.stock),
      })
    } else {
      map.set(String(key).toUpperCase(), { location: String(val ?? '').trim(), stock: null })
    }
  }
  if (Array.isArray(raw)) {
    for (const it of raw) put(it.part_number ?? it.partNumber ?? it.key, it)
  } else {
    for (const [k, v] of Object.entries(raw)) put(k, v)
  }
  return map
}

/**
 * 三级匹配：立创编号 → 厂商型号 → 值+封装（弱匹配，仅当唯一命中时采用）。
 * 值匹配复用不了 lib/bom.ts（那是 server-only 的 TS），这里只做保守的“归一化后完全相等”。
 */
function matchItem(item, inv, overrides) {
  let hit = null
  let how = ''
  if (item.partNumber) {
    hit = inv.byPart.get(item.partNumber.toUpperCase()) || null
    if (hit) how = '编号'
  }
  if (!hit && item.mpn) {
    hit = inv.byMpn.get(item.mpn.toUpperCase()) || null
    if (hit) how = '厂商型号'
  }

  const candidates = [item.key, item.partNumber, item.mpn].filter(Boolean)
  // 值（如 1uF）只作为最后兜底，且仅当这件料没有编号/型号时用 ——
  // 否则 "1uF" 会被多个不同料共用，把位置串到别人头上。
  if (!item.partNumber && !item.mpn && item.value) candidates.push(item.value)
  let loc = ''
  let overrideStock = null
  for (const c of candidates) {
    const v = overrides.get(String(c).toUpperCase())
    if (v) {
      loc = v.location
      overrideStock = v.stock
      break
    }
  }
  if (!loc && hit) loc = hit.location

  const stock = overrideStock != null ? overrideStock : hit ? hit.stock : null
  const matched = Boolean(hit) || Boolean(loc)
  const shortage = stock === null ? false : stock < item.qty

  return { ...item, matched, matchBy: how, location: loc, stock, shortage }
}

// ---------------------------------------------------------------------------
// 3. 注入
// ---------------------------------------------------------------------------

function buildPayload({ items, pcbName, sourceLabel }) {
  const designators = items.reduce((n, it) => n + it.qty, 0)
  return {
    pcbName,
    sourceLabel,
    generatedAt: new Date().toISOString(),
    counts: {
      items: items.length,
      designators,
      noLocation: items.filter((it) => !it.location).length,
      shortage: items.filter((it) => it.shortage).length,
    },
    rows: items.map((it) => ({
      loc: it.location,
      designators: it.designators,
      qty: it.qty,
      value: it.value,
      name: it.name,
      partNumber: it.partNumber,
      mpn: it.mpn,
      footprint: it.footprint,
      stock: it.stock,
      matched: it.matched,
      shortage: it.shortage,
    })),
  }
}

function inject(html, payload, panelSource) {
  const dataScript =
    '<script>window.__INV_LOC__ = ' +
    JSON.stringify(payload).replace(/</g, '\\u003c') +
    '</script>'
  const panelScript = '<script>\n' + panelSource + '\n</script>'
  const block = '\n<!-- 备料清单（库存位置）注入层，由 scripts/inject-bom-location.mjs 生成 -->\n' + dataScript + '\n' + panelScript + '\n'

  const idx = html.lastIndexOf('</body>')
  if (idx < 0) return html + block // 极端情况（无 body 闭合）追加到末尾
  return html.slice(0, idx) + block + html.slice(idx)
}

function pcbNameOf(input) {
  const base = path.basename(input).replace(/\.html?$/i, '')
  const m = base.match(/InteractiveBOM_([^-_]+)/i)
  return m ? m[1] : base
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2))
const t0 = Date.now()

const html = await readFile(args.input, 'utf8')
const { obj: files } = extractWindowFiles(html)
const data = parseBom(files)
const items = buildItems(data)

if (!items.length) throw new Error('解析出 0 个贴片位号，导出文件可能没勾选任何元件')

const inv = await loadInventory(args.db)
const overrides = await loadLocationOverrides(args.locations)
const withInv = items.map((it) => matchItem(it, inv, overrides))

const payload = buildPayload({
  items: withInv,
  pcbName: pcbNameOf(args.input),
  sourceLabel: overrides.size ? `覆盖表 + ${inv.label}` : inv.label,
})

const panelSource = await readFile(path.join(HERE, 'bom-location-panel.js'), 'utf8')
const out = args.out
  ? path.resolve(args.out)
  : path.join(path.dirname(args.input), path.basename(args.input, path.extname(args.input)) + '-库存位置.html')

await writeFile(out, inject(html, payload, panelSource), 'utf8')

// ---------------------------------------------------------------------------
// 报告
// ---------------------------------------------------------------------------

const noLoc = withInv.filter((it) => !it.location)
const bad = withInv.filter((it) => it.shortage)
const unmatched = withInv.filter((it) => !it.matched)

console.log(`输入: ${args.input}`)
console.log(`输出: ${out}`)
console.log(
  `元件: ${payload.counts.items} 种料 / ${payload.counts.designators} 个位号` +
    ` · 位置缺失 ${noLoc.length} · 缺料 ${bad.length} · 库存未匹配 ${unmatched.length}` +
    ` · 耗时 ${Date.now() - t0}ms`,
)
if (noLoc.length) {
  console.log('\n未设位置（前 10）:')
  for (const it of noLoc.slice(0, 10)) {
    console.log(`  ${it.designators.padEnd(24)} ${(it.partNumber || it.mpn || it.value || '?').padEnd(16)} ${it.name}`)
  }
  if (noLoc.length > 10) console.log(`  … 还有 ${noLoc.length - 10} 种`)
}
if (bad.length) {
  console.log('\n缺料:')
  for (const it of bad) console.log(`  ${it.designators.padEnd(24)} 需 ${it.qty} / 有 ${it.stock}`)
}

if (args.json) console.log('\n' + JSON.stringify(payload.rows, null, 2))
