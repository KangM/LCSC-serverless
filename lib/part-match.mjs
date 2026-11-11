/**
 * lib/part-match.mjs — 「一个料名 ↔ 库存里的元件」的宽松匹配规则。
 *
 * 为什么单独抽出来：站内 BOM 核对（lib/bom.ts 的 checkBom）和辅助焊接 HTML 注入
 * （lib/bom-html.mjs）必须用**同一套口径**，否则同一份板子在两个入口匹配出不同结果。
 * 纯函数、不碰数据库，所以放 .mjs 让 TS 和 Node 脚本都能引。
 *
 * 四条约束（踩过坑，别随手改）：
 *   1. 标称值必须按数值比较（1uF 与 100nF 相等），不能只做字符串归一化 ——
 *      早期实现连小数点一起抹掉，2.2uF 与 22uF 会撞成同一种料，直接配错。
 *   2. µ/μ → u、Ω/Ω 统一，否则立创规格里的 `µF` 和 BOM 里的 `uF` 对不上。
 *   3. 匹配只在「名称/值」层放宽，**编号和型号永远优先**，且优先精确命中。
 *   4. 名称/值层必须**品类一致**：U2 是芯片，哪怕它的值被人误填成 1kΩ，
 *      也不能去配一颗 1kΩ 电阻。位号前缀（U/R/C/L/D/Q…）与库存分类（贴片电阻/
 *      贴片电容/集成电路…）对不上就直接判「未入库」，见 designatorFamily /
 *      componentFamily。这条既治「封装不符」的假警报，也堵死同封装时的错货位。
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

/* ── 品类：位号前缀 ↔ 库存分类 ──────────────────────────────────────────────
 * 名称/值匹配必须限定在同一大类里。原因见文件头约束 4。
 * 值是 null 表示「认得出这个前缀，但它不约束品类」（测试点、蜂鸣器…）——
 * 必须显式写出来，否则最长前缀匹配会退回首字母，让 TP1 变成三极管（T）。
 */
const DESIGNATOR_FAMILIES = {
  // 电阻
  R: 'res', RN: 'res', RP: 'res', RV: 'res', VR: 'res', RT: 'res',
  // 电容
  C: 'cap', CP: 'cap', CT: 'cap', TC: 'cap', CE: 'cap',
  // 电感 / 磁珠
  L: 'ind', FB: 'ind', FL: 'ind',
  // 二极管（LED 画在 D 位或 LED 位都常见）
  D: 'diode', LED: 'diode', ZD: 'diode', TVS: 'diode', DS: 'diode',
  // 三极管 / MOS
  Q: 'transistor', T: 'transistor', VT: 'transistor', MOS: 'transistor',
  // 芯片
  U: 'ic', IC: 'ic', N: 'ic',
  // 晶体 / 晶振
  Y: 'crystal', X: 'crystal', XT: 'crystal', XTAL: 'crystal', OSC: 'crystal',
  // 开关 / 按键
  SW: 'switch', S: 'switch', K: 'switch', KEY: 'switch',
  // 连接器
  J: 'connector', P: 'connector', CN: 'connector', CON: 'connector',
  XS: 'connector', JP: 'connector', USB: 'connector', H: 'connector',
  // 保险丝
  F: 'fuse', FU: 'fuse',
  // 已知但不约束
  TP: null, BZ: null, LS: null, SP: null, BAT: null, BT: null, MH: null, ANT: null, M: null,
}

/** 库存分类（立创二级小类）→ 大类。二极管要排在稳压器前面，别再挪。 */
const CATEGORY_FAMILIES = [
  ['cap', /电容|MLCC/i],
  ['res', /电阻|电位器|热敏|压敏|光敏|湿敏/],
  ['ind', /电感|磁珠|共模|变压器/],
  ['diode', /二极管|TVS|整流|桥堆|发光/i],
  ['transistor', /三极管|场效应|MOSFET|MOS|晶体管|IGBT|晶闸管|可控硅/i],
  ['crystal', /晶振|晶体|振荡器|谐振器/],
  ['switch', /开关|按键|按钮/],
  ['connector', /连接器|排针|排母|插座|端子|接线|SIM卡座/i],
  ['fuse', /保险丝|熔断|自恢复/],
  ['ic', /集成|芯片|单片机|MCU|MPU|SOC|电源管理|稳压器|LDO|DC-?DC|逻辑|放大器|运放|驱动|接口|ADC|DAC|时钟|模块|射频|蓝牙|WIFI/i],
]

/** 没有分类时的兜底：规格表的键就能说明品类（立创的「阻值」「容值」很稳定）。 */
const SPEC_FAMILIES = { 容值: 'cap', 阻值: 'res', 电感值: 'ind', 稳压值: 'diode' }

/**
 * 从位号取品类：'U2' → ic、'R1,R2' → res、'LED3' → diode。
 * 认不出（TP1 / BZ1 / 空）返回 null，调用方必须放行。
 */
export function designatorFamily(designators) {
  const first = String(designators ?? '')
    .split(/[,，、;；\s]+/)
    .find((value) => value.trim())
  const letters = /^([A-Za-z]+)/.exec(String(first ?? '').trim().replace(/^[^A-Za-z0-9]+/, ''))
  const prefix = (letters?.[1] ?? '').toUpperCase()
  for (let len = Math.min(4, prefix.length); len >= 1; len--) {
    const key = prefix.slice(0, len)
    if (Object.prototype.hasOwnProperty.call(DESIGNATOR_FAMILIES, key)) {
      return DESIGNATOR_FAMILIES[key]
    }
  }
  return null
}

const familyCache = new WeakMap()

/** 从库存元件取品类；分类/规格都读不出时返回 null（表示不约束）。 */
export function componentFamily(component) {
  if (!component || typeof component !== 'object') return null
  if (familyCache.has(component)) return familyCache.get(component)
  const family = inferComponentFamily(component)
  familyCache.set(component, family)
  return family
}

function inferComponentFamily(component) {
  const category = String(component.category ?? '')
  if (category) {
    for (const [family, pattern] of CATEGORY_FAMILIES) {
      if (pattern.test(category)) return family
    }
  }
  const specs =
    component.specifications && typeof component.specifications === 'object'
      ? Object.keys(component.specifications)
      : []
  for (const [key, family] of Object.entries(SPEC_FAMILIES)) {
    if (specs.some((name) => name.includes(key))) return family
  }
  const parsed = parseValue(component.name)
  if (parsed) return parsed.kind === 'R' ? 'res' : parsed.kind === 'F' ? 'cap' : 'ind'
  return null
}

/**
 * 位号品类与元件品类是否相容。任一侧未知就放行（宁可多匹配一次，也不无端判死）。
 * 两条例外来自实际板子：LED 常被放在 L 位；0Ω 电阻与保险丝两种归类都见过。
 */
export function familiesCompatible(designatorFam, componentFam, name = '') {
  if (!designatorFam || !componentFam) return true
  if (designatorFam === componentFam) return true
  if (designatorFam === 'ind' && componentFam === 'diode' && /^(?:LED|发光)/i.test(String(name))) return true
  if (designatorFam === 'res' && componentFam === 'fuse') return true
  return false
}

/**
 * 名称/值层的候选过滤：先按品类、再交给调用方按封装筛。
 * 两个调用方（matchComponent / checkBom）都走这里，口径才不会分叉。
 *
 * 例外：**编号/型号文本精确命中时不卡品类**。唯一标识比位号前缀可靠 ——
 * 位号是设计者手写的，写错前缀（U1 上挂了一颗电容型号）的情况真有，而这种
 * 情况下「库里确实有这颗料」的结论仍然成立，没必要硬判未入库。
 */
export function compatibleCandidates(candidates, { designators, name } = {}) {
  const family = designatorFamily(designators)
  if (!family) return candidates
  return candidates.filter(
    (component) =>
      exactIdentifierMatch(component, name) ||
      familiesCompatible(family, componentFamily(component), name),
  )
}

/** 文本是否正好是这颗料的立创编号或厂商型号（忽略大小写与分隔符） */
function exactIdentifierMatch(component, text) {
  const target = compact(text)
  if (!target) return false
  return [component.partNumber, component.mpn].some((value) => value && compact(value) === target)
}

/**
 * 给一个料挑最合适的元件。
 *
 * 优先级：立创编号 → 厂商型号 → 名称/型号文本 → 标称值（宽松匹配 + 封装过滤）。
 * 前两级是唯一标识，命中就直接用（不再看封装 —— 系统里封装字段常写成
 * C0603 / 0603_L2.5mm 这种，拿它否掉一个编号命中是舍本逐末）。
 *
 * 第三/四级缩到「同一大类」内：位号前缀 U 就只认芯片类元件。U2 这类芯片在
 * 原理图里常留着上一个器件的值（实测 PCB10 的 SY8089AAAC 值是 1kΩ），
 * 不限定品类就会去配 1kΩ 电阻，轻则误报「封装不符」，重则给出一个错的货位。
 *
 * 名称/值层必须**要求封装一致**，不匹配就判定失败，不做回退。
 * 原因：同一个值在 0603 和 0805 上是两种物料。回退到「同值但封装不同」的料
 * 会让 HTML 里显示一个错的货位，人照着去拿必然拿错 —— 这比显示「没匹配上」危险得多。
 *
 * @param item  { partNumber, mpn, name, value, footprint, designators }
 * @param index { byPart: Map, byMpn: Map, all: Array }
 * @returns {{ component: any|null, how: string, ambiguous: boolean,
 *            reason: ''|'none'|'pkg', near: any|null }}
 *          reason: '' 命中 / 'none' 库里没有 / 'pkg' 有同值同品类料但封装不符
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
  // 型号也当文本再试一次：库存里常有只填了 name（型号）而 mpn 空着的记录，
  // 光靠 byMpn 精确查会漏。顺序按「越具体越前」：名称 → 型号 → 值。
  // 无编号料这三者常常都是同一个 cm（见 buildItems），去重避免重复扫全库。
  const keys = [
    ...new Set([item.name, item.mpn, item.value].map((v) => String(v ?? '').trim()).filter(Boolean)),
  ]
  let near = null
  for (const key of keys) {
    const named = all.filter((component) => matchesName(component, key))
    if (!named.length) continue
    const candidates = compatibleCandidates(named, { designators: item.designators, name: key })
    // 同名同值但品类都不对（芯片配上了电阻）：直接放弃，连 near 也不留 ——
    // 留了就会冒出「封装不符」这种误导性提示，实际库里根本没有这颗料。
    if (!candidates.length) continue
    const withFootprint = candidates.filter((component) => matchesFootprint(component, item.footprint))
    if (!withFootprint.length) {
      // 同值同品类但封装全不符：记下最接近的一个（供界面提示），但不认定匹配
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
