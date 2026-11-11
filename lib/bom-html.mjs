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

import { matchComponent } from './part-match.mjs'

export { TABLE_SOURCE } from './bom-table.mjs'

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
 * 把 designator_info 里的贴片记录归并成「一种料一行」。
 *
 * 归并键必须是 **lc_code + 封装 + 值**，不能只用 lc_code：
 * 立创对「没有关联商城编号」的料只写 `,10uF` 这种值键，而 10uF 可能同时存在
 * C0805 和 C0603 两种封装（PCB10 里 C1 是 0805、C3 是 0603）。只按 lc_code 归并
 * 会把它们合成一组，取到第一个的封装，于是 0603 的器件被贴上 0805 的料和货位 ——
 * 匹配看似成功，实际让人去错的货架拿料。这类错配比匹配不上危险得多。
 *
 * 归并后组数必须等于页面表格的行数（PCB10 = 36），差一个就说明分组口径不对。
 */
export function buildItems(data) {
  const comp = data.comp_info || {}
  const groups = new Map()

  for (const set of data.designator_info) {
    for (const side of ['top', 'bottom']) {
      for (const p of set[side] || []) {
        if (!p || !p.des) continue
        if (p.is_mount === false) continue // 只统计要贴的
        // 封装必须进键：同一个 lc_code 会对应不同封装（见函数头注释）
        const key = `${p.lc_code || ''}|${p.ft_name || ''}|${p.cm || ''}`
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
    const info = comp[g.lcCode] || (g.lcCode ? {} : comp[''] || {})
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
      // ft_name 是器件自己的封装（C0603 / SOD-123），比 comp_info 里的 lc_pkg 更准：
      // lc_pkg 是「这个值键」共享的，同值不同封装时会给出错误的那个
      footprint: cleanString(g.ft) || cleanString(info['Supplier Footprint']) || cleanString(info.lc_pkg),
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
 * @typedef {object} InventoryComponent
 * @property {string} [partNumber]
 * @property {string} [mpn]
 * @property {string} [name]
 * @property {string} [description]
 * @property {string} [packageName]
 * @property {Record<string, string>} [specifications]
 * @property {number} [stock]           快照里的库存数（getInventorySnapshot）
 * @property {number} [stockQuantity]   ComponentRow 里的库存数
 * @property {string} [reference]       快照里的位号
 * @property {string} [referenceDesignator] ComponentRow 里的位号
 */

/**
 * 把解析出的料与库存匹配。
 *
 * 匹配规则与站内 BOM 核对（lib/bom.ts 的 checkBom）同源 —— 都用 lib/part-match.mjs 的
 * matchesName / matchesFootprint，编号 → 型号 → 名称/值（1uF=100nF 数值换算）。
 *
 * **但回退策略故意不同**：checkBom 封装对不上时仍给候选（界面上标「封装未完全匹配」），
 * 因为那边是人工逐行核对；这里要直接显示「去哪个货位拿料」，封装不符就必须判定失败，
 * 否则人照着错的货位去拿，比显示「没有」危险得多。别为了「统一」把这个回退改回去。
 *
 * 早期这里只比编号和型号，于是「没有立创编号的料」（10uF / 1K / 100nF 这种
 * 只有值的，PCB10 里占了一半）全部匹配不上 —— 这正是「匹配有问题」的根因。
 *
 * @param {Array<any>} items  buildItems() 的结果
 * @param {object} [options]
 * @param {InventoryComponent[]} [options.components] 库存元件（getInventorySnapshot）
 * @param {Map<string, { reference: string, stock: number | null }>} [options.overrides]
 *        临时覆盖表（CLI 预览用，Web 传空）
 * @returns {Array<any>}
 */
export function matchInventory(items, { components = [], overrides = new Map() } = {}) {
  const byPart = new Map()
  const byMpn = new Map()
  for (const c of components) {
    if (c.partNumber) byPart.set(String(c.partNumber).toUpperCase(), c)
    if (c.mpn) byMpn.set(String(c.mpn).toUpperCase(), c)
  }
  const index = { byPart, byMpn, all: components }

  return items.map((item) => {
    let reference = ''
    let overrideStock = null
    for (const key of [item.key, item.partNumber, item.mpn].filter(Boolean)) {
      const v = overrides.get(String(key).toUpperCase())
      if (v) {
        reference = v.reference
        overrideStock = v.stock
        break
      }
    }

    const { component, how, ambiguous, reason, near } = matchComponent(item, index)
    // 两个调用方的字段名不同：Web 用 getInventorySnapshot（stock / reference），
    // CLI 也用同一份快照，但 ComponentRow 是 stockQuantity / referenceDesignator。
    // 都兼容一下，省得为了字段名在两边做映射。
    if (!reference && component) reference = component.referenceDesignator || component.reference || ''
    const rawStock = component ? (component.stockQuantity != null ? component.stockQuantity : component.stock) : null
    const stock = overrideStock != null ? overrideStock : rawStock == null ? null : Number(rawStock)

    return {
      ...item,
      reference,
      stock,
      matched: Boolean(component) || Boolean(reference),
      matchBy: how,
      ambiguous,
      // 'pkg' = 库里有同值料但封装对不上（不能拿，会拿错料）；
      // 'none' = 库里根本没有这个料；'' = 命中
      reason: component ? '' : reason,
      nearHint: near ? `${near.partNumber} ${near.packageName || ''}`.trim() : '',
      shortage: stock === null ? false : stock < item.qty,
    }
  })
}

/**
 * 注入给页面的数据。
 *
 * 页面侧按**位号**查（每行显示的是 C1、C4、C8），不是按「第几种料」——
 * React 排序 / 搜索后行序会变，按下标对应必然错位；位号在这块板内唯一，永远对得上。
 */
export function buildPayload({ items, pcbName, sourceLabel }) {
  const designators = items.reduce((n, it) => n + it.qty, 0)
  const byDesignator = {}
  for (const it of items) {
    // why: 'pkg' 封装不符 / 'none' 未入库 / '' 正常。页面据此区分三种提示，
    // 单靠 m=0 分不出「库里没有」和「有同值但封装不对」——后者最容易被误当作
    // 可以拿的料，必须单独标出来。
    const state = { r: it.reference || '', m: it.matched ? 1 : 0, why: it.reason || '', hint: it.nearHint || '' }
    for (const raw of String(it.designators || '').split(',')) {
      const des = raw.trim()
      if (des) byDesignator[des] = state
    }
  }
  return {
    pcbName,
    sourceLabel,
    generatedAt: new Date().toISOString(),
    counts: {
      items: items.length,
      designators,
      unmatched: items.filter((it) => !it.matched).length,
      footprintMismatch: items.filter((it) => it.reason === 'pkg').length,
      noReference: items.filter((it) => it.matched && !it.reference).length,
      shortage: items.filter((it) => it.shortage).length,
    },
    byDesignator,
    // 明细保留一份：CLI --json 调试、CSV 导出、以及日后排查匹配口径
    rows: items.map((it) => ({
      reference: it.reference,
      designators: it.designators,
      qty: it.qty,
      value: it.value,
      name: it.name,
      partNumber: it.partNumber,
      mpn: it.mpn,
      footprint: it.footprint,
      stock: it.stock,
      matched: it.matched,
      matchBy: it.matchBy,
      ambiguous: it.ambiguous,
      reason: it.reason,
      nearHint: it.nearHint,
      shortage: it.shortage,
    })),
  }
}

/** 把数据与「库存位置」列脚本插到 </body> 前；原页面其余字节完全不动。 */
export function injectTableColumn(html, payload, tableSource) {
  if (html.includes('window.__INV_LOC__ = ')) {
    throw new Error('这份 HTML 已经注入过了 —— 请用立创导出的原始文件，否则会重复插列')
  }
  const dataScript =
    '<script>window.__INV_LOC__ = ' + JSON.stringify(payload).replace(/</g, '\\u003c') + '</script>'
  const script = '<script>\n' + tableSource + '\n</script>'
  const block =
    '\n<!-- 库存位置列注入层（lib/bom-table.mjs 生成） -->\n' + dataScript + '\n' + script + '\n'

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
