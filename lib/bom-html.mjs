/**
 * lib/bom-html.mjs — 立创EDA Pro「辅助焊接」导出 HTML 的解析 / 注入核心。
 *
 * 为什么是后处理而不是 EDA 插件：那份 HTML 是立创 SMT 引擎输出的编译产物（React SPA），
 * 插件侧没有钩子能改它的导出内容；但它的 BOM 数据是明文 JSON，位于
 *   window.files.bom_merge → JSON → data.{designator_info, comp_info}
 * 里，注入只加 ~20KB，11MB 主体一字节不动。
 *
 * 纯函数、不碰数据库也不碰文件系统 —— 两个调用方共用这一份：
 *   · scripts/inject-bom-location.mjs   （CLI）
 *   · app/api/bom/inject/route.ts       （Web：/import 页上传）
 *
 * 术语：本文件里的「位号」有两层，别混。
 *   · designators —— 这块 PCB 上的丝印位号（C1、R5），来自辅助焊接导出
 *   · reference   —— 系统里录入的位号，实际是元件在货架上的位置（R1G1、CL2A3），
 *                    对应 transactions.reference_designator
 */

export { PANEL_SOURCE } from './bom-panel.mjs'

/**
 * window.files 是一个 JSON 字面量，紧跟其后是 `}; window.__ENGING_*`。
 * 不用正则整体匹配（4MB 单行 + 内部字符串含 `};`），改用「从 window.files = 起，
 * 找到 `}; window.__ENGING` 之前」的边界切片 —— 这是实测最稳的定位方式。
 */
export function extractWindowFiles(html) {
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
  return { obj: JSON.parse(literal), start, from, end }
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
export function parseBom(files) {
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
export function buildItems(data) {
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

/**
 * 把解析出的料与库存匹配，产出备料清单。
 *
 * @param items      buildItems() 的结果
 * @param byPart     Map<立创编号大写, 元件记录>，记录含 { partNumber, mpn, name, stock, reference }
 * @param byMpn      Map<厂商型号大写, 元件记录>
 * @param overrides  Map<键大写, { reference, stock }> 临时覆盖表（CLI 预览用，Web 传空 Map）
 *
 * 匹配顺序：立创编号 → 厂商型号 → 值（仅当既无编号也无型号时兜底）。
 * 值必须最后兜底：同一个值（如 1uF）常对应多个不同料，按值直接匹配会把位号串到别人头上。
 */
export function matchInventory(items, { byPart = new Map(), byMpn = new Map(), overrides = new Map() } = {}) {
  return items.map((item) => {
    let hit = null
    let how = ''
    if (item.partNumber) {
      hit = byPart.get(item.partNumber.toUpperCase()) || null
      if (hit) how = '立创编号'
    }
    if (!hit && item.mpn) {
      hit = byMpn.get(item.mpn.toUpperCase()) || null
      if (hit) how = '厂商型号'
    }

    const candidates = [item.key, item.partNumber, item.mpn].filter(Boolean)
    if (!item.partNumber && !item.mpn && item.value) candidates.push(item.value)

    let reference = ''
    let overrideStock = null
    for (const c of candidates) {
      const v = overrides.get(String(c).toUpperCase())
      if (v) {
        reference = v.reference
        overrideStock = v.stock
        break
      }
    }
    if (!reference && hit) reference = hit.reference || ''

    const stock = overrideStock != null ? overrideStock : hit ? hit.stock : null
    return {
      ...item,
      // loc 是面板读取的字段名（历史原因沿用），语义 = 系统位号 / 货位
      loc: reference,
      stock,
      matched: Boolean(hit) || Boolean(reference),
      matchBy: how,
      shortage: stock === null ? false : stock < item.qty,
    }
  })
}

export function buildPayload({ items, pcbName, sourceLabel }) {
  const designators = items.reduce((n, it) => n + it.qty, 0)
  return {
    pcbName,
    sourceLabel,
    generatedAt: new Date().toISOString(),
    counts: {
      items: items.length,
      designators,
      noLocation: items.filter((it) => !it.loc).length,
      shortage: items.filter((it) => it.shortage).length,
    },
    rows: items.map((it) => ({
      loc: it.loc,
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

/** 把数据与面板脚本插到 </body> 前；原页面其余字节完全不动。 */
export function injectPanel(html, payload, panelSource) {
  if (html.includes('window.__INV_LOC_MOUNTED__')) {
    throw new Error('这份 HTML 已经注入过了 —— 请用立创导出的原始文件，否则会重复叠加面板')
  }
  const dataScript =
    '<script>window.__INV_LOC__ = ' + JSON.stringify(payload).replace(/</g, '\\u003c') + '</script>'
  const panelScript = '<script>\n' + panelSource + '\n</script>'
  const block =
    '\n<!-- 备料清单（库存位置 = 系统位号）注入层，由 lib/bom-html.mjs 生成 -->\n' +
    dataScript +
    '\n' +
    panelScript +
    '\n'

  const idx = html.lastIndexOf('</body>')
  if (idx < 0) return html + block // 极端情况（无 body 闭合）追加到末尾
  return html.slice(0, idx) + block + html.slice(idx)
}

/**
 * 列名刻意用「位号/名称/封装/供应商/数量」—— 这是 /import 页 parseBomCsv 认识的表头。
 *
 * 名称列写**立创编号**而不是值：checkBom 的匹配是按编号/型号/名称/规格逐个比，
 * 写 "1uF" 这种值会和多个不同料撞车（同一值可能有多个编号），编号是唯一且最稳的。
 * 位号含逗号，统一加引号（/import 的 CSV 解析支持引号包裹）。
 */
export function buildBomCsv(items) {
  const cell = (value) => {
    const text = String(value ?? '')
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
  }
  const lines = ['位号,名称,封装,供应商,数量']
  for (const it of items) {
    lines.push(
      [
        cell(it.designators),
        cell(it.partNumber || it.mpn || it.value),
        cell(it.footprint),
        cell(it.partNumber),
        it.qty,
      ].join(','),
    )
  }
  return lines.join('\r\n') + '\r\n'
}

/** InteractiveBOM_PCB10_2026-11-7.html → PCB10 */
export function pcbNameFromFileName(name) {
  const base = String(name || '').replace(/\.html?$/i, '').split(/[\\/]/).pop() || ''
  const m = base.match(/InteractiveBOM_([^-_]+)/i)
  return m ? m[1] : base
}
