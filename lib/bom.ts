import 'server-only'
import { getDb, type ComponentRow } from './db'

export interface BomRow {
  designator: string
  name: string
  footprint: string
  supplier: string
  quantity: number
}

export interface BomCheckItem extends BomRow {
  matchedPartNumber: string | null
  matchedName: string | null
  /** 匹配元件的标称值（容值/阻值/电感值），便于人工核对有没有配错料 */
  matchedValue: string | null
  referenceDesignator: string | null
  stockQuantity: number
  status: 'sufficient' | 'insufficient' | 'missing' | 'invalid'
  message: string
}

const compact = (value: string) => value.toUpperCase().replace(/[\s_\-./()[\]{}]/g, '')

/**
 * 标称值归一化：**必须保留小数点**。
 * 早期实现把 `.` 也当分隔符去掉，于是 "2.2uF" 与 "22uF"、"4.7K" 与 "47K"
 * 归一化后完全相同，BOM 校对会直接配错料。这里同时把 µ/μ 统一成 u、Ω 统一成 Ω。
 */
function normalizeValueText(value: string): string {
  return value
    .trim()
    .replace(/[µμΜ]/gu, 'u')
    .replace(/Ω/g, 'Ω')
    .replace(/[_/()[\]{}]/g, '')
}

/** 统一 BOM 与立创规格中常见的电阻单位写法：22R = 22Ω = 22OHM。 */
function canonicalValue(value: string): string {
  const normalized = normalizeValueText(value).replace(/\s+/g, '').toUpperCase().replace(/(?:Ω|OHM)$/u, '')
  return /^\d+(?:\.\d+)?$/.test(normalized) ? `${normalized}R` : normalized
}

/** 标称值的基准单位：Ω / F / H */
type ValueKind = 'R' | 'F' | 'H'

interface ParsedValue {
  kind: ValueKind
  value: number
}

function prefixScale(prefix: string): number {
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

/**
 * 解析 "2.2uF" / "100nF" / "4.7K" / "22R" / "10mΩ" 这类「数值+单位」文本，
 * 换算成基准单位数值（F / Ω / H）后比较，避免小数点被吃掉；不带单位按欧姆处理。
 * 无法解析返回 null（交给纯文本比较兜底）。
 */
function parseValue(text: string): ParsedValue | null {
  const normalized = normalizeValueText(text).replace(/\s+/g, '')
  const match = /^(\d+(?:\.\d+)?)([pnu]|[mM]|[kK]|[gG])?(Ω|OHM|R|F|H)?$/i.exec(normalized)
  if (!match) return null
  const amount = Number(match[1])
  if (!Number.isFinite(amount)) return null
  const unit = (match[3] ?? '').toUpperCase()
  const kind: ValueKind = unit === 'F' ? 'F' : unit === 'H' ? 'H' : 'R'
  return { kind, value: amount * prefixScale(match[2] ?? '') }
}

/** 换算后的浮点比较（0.1uF 与 100nF 应视为相等） */
function nearlyEqual(a: number, b: number): boolean {
  if (a === b) return true
  const scale = Math.max(Math.abs(a), Math.abs(b))
  return scale === 0 || Math.abs(a - b) <= scale * 1e-6
}

function sameParsedValue(a: ParsedValue, b: ParsedValue): boolean {
  return a.kind === b.kind && nearlyEqual(a.value, b.value)
}

/** 从较长的名称/描述里抽取「数值+单位」片段（如 "2.2uF ±10% 25V 0603" → 2.2uF） */
function extractValues(text: string): ParsedValue[] {
  const out: ParsedValue[] = []
  const matches = normalizeValueText(text).matchAll(
    /\d+(?:\.\d+)?\s*(?:[pnuµμ]|[mMkKgG])?\s*(?:Ω|OHM|R|F|H)(?![A-Za-z0-9])/gi,
  )
  for (const match of matches) {
    const parsed = parseValue(match[0])
    if (parsed) out.push(parsed)
  }
  return out
}

/** 元件标称值（容值/阻值/电感值），用于在界面上核对匹配结果 */
const VALUE_SPEC_KEYS = ['容值', '阻值', '电感值']

function primaryValue(row: ComponentRow): string | null {
  for (const key of VALUE_SPEC_KEYS) {
    const value = row.specifications[key]
    if (value) return value
  }
  return null
}

function matchesName(row: ComponentRow, name: string): boolean {
  const target = name.trim()
  if (!target) return false
  const targetValue = parseValue(target)
  const targetText = canonicalValue(target)
  const candidates = [row.partNumber, row.mpn ?? '', row.name ?? '', ...Object.values(row.specifications)]
  if (
    candidates.some((value) => {
      const text = String(value)
      if (canonicalValue(text) === targetText) return true
      const parsed = parseValue(text)
      return Boolean(parsed && targetValue && sameParsedValue(parsed, targetValue))
    })
  ) {
    return true
  }
  // 名称/描述是长文本时（如 "2.2uF ±10% 25V 0603"），抽取其中的标称值再比对
  if (targetValue) {
    const longTexts = [row.name ?? '', row.description ?? '']
    if (longTexts.some((text) => extractValues(text).some((parsed) => sameParsedValue(parsed, targetValue)))) {
      return true
    }
  }
  // Common BOM LED labels (LED_R/LED_G/LED_B) correspond to color in LCSC specs.
  const color = targetText === 'LEDR' ? '红' : targetText === 'LEDG' ? '绿' : targetText === 'LEDB' ? '蓝' : ''
  return Boolean(color && Object.values(row.specifications).some((value) => value.includes(color)))
}

function matchesFootprint(row: ComponentRow, footprint: string): boolean {
  const target = compact(footprint)
  if (!target) return true
  const pkg = compact(row.packageName ?? '')
  return Boolean(pkg && (pkg === target || pkg.includes(target) || target.includes(pkg)))
}

/** 将 BOM 每一行与当前正常库存匹配，并按需求数量判断库存是否足够。 */
export async function checkBom(rawRows: unknown): Promise<{ items: BomCheckItem[] }> {
  const rows = Array.isArray(rawRows) ? rawRows as Array<Record<string, unknown>> : []
  const result = await getDb().execute(`
    SELECT components.*, (
      SELECT reference_designator FROM transactions
      WHERE transactions.part_number = components.part_number
        AND reference_designator IS NOT NULL AND trim(reference_designator) <> ''
      ORDER BY transactions.id DESC LIMIT 1
    ) AS reference_designator
    FROM components
    WHERE status = 'active'
  `)
  const components = result.rows.map((row) => {
    const values = row as Record<string, unknown>
    return {
      partNumber: String(values.part_number ?? ''),
      mpn: (values.mpn as string) ?? null,
      name: (values.name as string) ?? null,
      brand: (values.brand as string) ?? null,
      packageName: (values.package_name as string) ?? null,
      category: (values.category as string) ?? null,
      description: (values.description as string) ?? null,
      price: values.price == null ? null : Number(values.price),
      stockQuantity: Number(values.stock_quantity ?? 0),
      status: 'active' as const,
      referenceDesignator: (values.reference_designator as string) ?? null,
      threshold: Number(values.threshold ?? 0),
      productUrl: null, datasheetUrl: null, imageUrl: null, specifications: (() => {
        try { return JSON.parse(String(values.specifications ?? '{}')) as Record<string, string> } catch { return {} }
      })(), lastFetchedAt: null, createdAt: '', updatedAt: '',
    } satisfies ComponentRow
  })

  return {
    items: rows.map((raw) => {
      const designator = String(raw.designator ?? '').trim()
      const name = String(raw.name ?? '').trim()
      const footprint = String(raw.footprint ?? '').trim()
      const quantity = Math.trunc(Number(raw.quantity ?? 0))
      if (!designator || !name || quantity < 1) {
        return { designator, name, footprint, supplier: String(raw.supplier ?? '').trim(), quantity, matchedPartNumber: null, matchedName: null, matchedValue: null, referenceDesignator: null, stockQuantity: 0, status: 'invalid', message: '缺少名称/位号或数量无效' }
      }
      const candidates = components.filter((component) => matchesName(component, name))
      const footprintMatches = candidates.filter((component) => matchesFootprint(component, footprint))
      // 封装对不上时仍回退到名称匹配（缺料时给个候选），但要在结论里点出来
      const matched = footprintMatches[0] ?? candidates[0] ?? null
      const footprintMatched = footprintMatches.length > 0
      const stockQuantity = matched?.stockQuantity ?? 0
      const status = !matched ? 'missing' : stockQuantity >= quantity ? 'sufficient' : 'insufficient'
      const suffix = footprintMatched ? '' : '（封装未完全匹配）'
      return {
        designator, name, footprint, supplier: String(raw.supplier ?? '').trim(), quantity,
        matchedPartNumber: matched?.partNumber ?? null, matchedName: matched?.name ?? null,
        matchedValue: matched ? primaryValue(matched) : null,
        referenceDesignator: matched?.referenceDesignator ?? null, stockQuantity, status,
        message: !matched ? '未找到匹配元件' : status === 'sufficient' ? `库存足够${suffix}` : `库存不足${suffix}`,
      }
    }),
  }
}
