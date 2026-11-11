/**
 * lib/part-match.mjs — 「一个料名 ↔ 库存里的元件」的宽松匹配规则。
 *
 * 为什么单独抽出来：站内 BOM 核对（lib/bom.ts 的 checkBom）和辅助焊接 HTML 注入
 * （lib/bom-html.mjs）必须用**同一套口径**，否则同一份板子在两个入口匹配出不同结果。
 * 纯函数、不碰数据库，所以放 .mjs 让 TS 和 Node 脚本都能引。
 *
 * 三条约束（踩过坑，别随手改）：
 *   1. 标称值必须按数值比较（1uF 与 100nF 相等），不能只做字符串归一化 ——
 *      早期实现连小数点一起抹掉，2.2uF 与 22uF 会撞成同一种料，直接配错。
 *   2. µ/μ → u、Ω/Ω 统一，否则立创规格里的 `µF` 和 BOM 里的 `uF` 对不上。
 *   3. 匹配只在「名称/值」层放宽，**编号和型号永远优先**，且优先精确命中。
 */

const compact = (value) => String(value ?? '').toUpperCase().replace(/[\s_\-./()[\]{}]/g, '')

/** 标称值归一化：**必须保留小数点**（见文件头约束 1）。 */
export function normalizeValueText(value) {
  return String(value ?? '')
    .trim()
    .replace(/[µμΜ]/gu, 'u')
    // U+2126 OHM SIGN → U+03A9 GREEK OMEGA（两者视觉一样，字节不同，必须统一）
    .replace(/\u2126/g, '\u03a9')
    .replace(/[_/()[\]{}]/g, '')
}

/** 统一电阻单位写法：22R = 22Ω = 22OHM。 */
export function canonicalValue(value) {
  const normalized = normalizeValueText(value).replace(/\s+/g, '').toUpperCase().replace(/(?:Ω|OHM)$/u, '')
  return /^\d+(?:\.\d+)?$/.test(normalized) ? `${normalized}R` : normalized
}

/** 标称值的基准单位：Ω / F / H */
function prefixScale(prefix) {
  switch (prefix) {
    case 'p':
    case 'P':
      return 1e-12
    case 'n':
    case 'N':
      return 1e-9
    case 'u':
    case 'U':
      return 1e-6
    case 'm': // 毫：10mΩ 采样电阻、10mH
      return 1e-3
    case 'M': // 兆：1MΩ
      return 1e6
    case 'k':
    case 'K':
      return 1e3
    case 'g':
    case 'G':
      return 1e9
    default:
      return 1
  }
}

/** "2.2uF" / "100nF" / "4.7K" / "22R" / "10mΩ" → { kind, value }，解析不了返回 null。 */
export function parseValue(text) {
  const normalized = normalizeValueText(text).replace(/\s+/g, '')
  const match = /^(\d+(?:\.\d+)?)([pnu]|[mM]|[kK]|[gG])?(Ω|OHM|R|F|H)?$/i.exec(normalized)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = (match[3] ?? '').toUpperCase()
  const kind = unit === 'F' ? 'F' : unit === 'H' ? 'H' : 'R'
  return { kind, value: amount * prefixScale(match[2] ?? '') }
}

/** 换算后的浮点比较（0.1uF 与 100nF 视为相等） */
function nearlyEqual(a, b) {
  if (a === b) return true
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 || Math.abs(a - b) <= scale * 1e-6
}

function sameParsedValue(a, b) {
  return a.kind === b.kind && nearlyEqual(a.value, b.value)
}

/** 从长文本里抽取所有「数值+单位」片段（如 "2.2uF ±10% 25V 0603" → 2.2uF）。 */
export function extractValues(text) {
  const out = []
  const matches = normalizeValueText(text).matchAll(
    /\d+(?:\.\d+)?\s*(?:[pnuµμ]|[mMkKgG])?\s*(?:Ω|OHM|R|F|H)(?![A-Za-z0-9])/gi,
  )
  for (const match of matches) {
    const parsed = parseValue(match[0])
    if (parsed) out.push(parsed)
  }
  return out
}

/**
 * 一个「名称」（BOM 里的值/型号/编号）是否对得上这个元件。
 *
 * @param component { partNumber, mpn, name, description, specifications }
 * @param name      待匹配的文本
 */
export function matchesName(component, name) {
  const target = String(name ?? '').trim()
  if (!target) return false
  const specs = component.specifications || {}
  const targetValue = parseValue(target)
  const targetText = canonicalValue(target)
  const candidates = [component.partNumber, component.mpn ?? '', component.name ?? '', ...Object.values(specs)]
  if (
    candidates.some((value) => {
      const text = String(value ?? '')
      if (canonicalValue(text) === targetText) return true
      const parsed = parseValue(text)
      return Boolean(parsed && targetValue && sameParsedValue(parsed, targetValue))
    })
  ) {
    return true
  }
  // 名称/描述是长文本时（如 "2.2uF ±10% 25V 0603"），抽取其中的标称值再比对
  if (targetValue) {
    const longTexts = [component.name ?? '', component.description ?? '']
    if (longTexts.some((text) => extractValues(text).some((parsed) => sameParsedValue(parsed, targetValue)))) {
      return true
    }
  }
  // Common BOM LED labels (LED_R/LED_G/LED_B) correspond to color in LCSC specs.
  const color = targetText === 'LEDR' ? '红' : targetText === 'LEDG' ? '绿' : targetText === 'LEDB' ? '蓝' : ''
  return Boolean(color && Object.values(specs).some((value) => String(value).includes(color)))
}

/** 封装比对：C0805 / 0805 / 0603 互相包含即算一致；空封装视为不约束。 */
export function matchesFootprint(component, footprint) {
  const target = compact(footprint)
  if (!target) return true
  const pkg = compact(component.packageName ?? '')
  return Boolean(pkg && (pkg === target || pkg.includes(target) || target.includes(pkg)))
}

/**
 * 给一个料挑最合适的元件。
 *
 * 优先级：立创编号 → 厂商型号 → 名称/值（宽松匹配 + 封装过滤）。
 * 前两级是唯一标识，命中就直接用（不再看封装 —— 系统里封装字段常写成
 * C0603 / 0603_L2.5mm 这种，拿它否掉一个编号命中是舍本逐末）。
 *
 * 第三级必须**要求封装一致**，不匹配就判定失败，不做回退。
 * 原因：同一个值在 0603 和 0805 上是两种物料。回退到「同值但封装不同」的料
 * 会让 HTML 里显示一个错的货位，人照着去拿必然拿错 —— 这比显示「没匹配上」危险得多。
 *
 * @param item  { partNumber, mpn, name, value, footprint }
 * @param index { byPart: Map, byMpn: Map, all: Array }
 * @returns {{ component: any|null, how: string, ambiguous: boolean,
 *            reason: ''|'none'|'pkg', near: any|null }}
 *          reason: '' 命中 / 'none' 库里没有 / 'pkg' 有同值料但封装不符
 */
export function matchComponent(item, index) {
  const byPart = index.byPart || new Map()
  const byMpn = index.byMpn || new Map()

  if (item.partNumber) {
    const hit = byPart.get(String(item.partNumber).toUpperCase())
    if (hit) return { component: hit, how: '立创编号', ambiguous: false, reason: '', near: null }
  }
  if (item.mpn) {
    const hit = byMpn.get(String(item.mpn).toUpperCase())
    if (hit) return { component: hit, how: '厂商型号', ambiguous: false, reason: '', near: null }
  }

  const all = index.all || []
  const keys = [item.name, item.value].map((v) => String(v ?? '').trim()).filter(Boolean)
  let near = null
  for (const key of keys) {
    const candidates = all.filter((component) => matchesName(component, key))
    if (!candidates.length) continue
    const withFootprint = candidates.filter((component) => matchesFootprint(component, item.footprint))
    if (!withFootprint.length) {
      // 同值但封装全不符：记下最接近的一个（供界面提示），但不认定匹配
      if (!near) near = candidates[0]
      continue
    }
    return {
      component: withFootprint[0],
      how: `名称/值(${key})`,
      ambiguous: withFootprint.length > 1,
      reason: '',
      near: null,
    }
  }
  return { component: null, how: '', ambiguous: false, reason: near ? 'pkg' : 'none', near }
}
