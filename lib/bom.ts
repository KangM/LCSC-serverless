import 'server-only'
import { getDb, type ComponentRow } from './db'
import { matchesFootprint, matchesName } from './part-match.mjs'

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

/** 元件标称值（容值/阻值/电感值），用于在界面上核对匹配结果 */
const VALUE_SPEC_KEYS = ['容值', '阻值', '电感值']

function primaryValue(row: ComponentRow): string | null {
  for (const key of VALUE_SPEC_KEYS) {
    const value = row.specifications[key]
    if (value) return value
  }
  return null
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
