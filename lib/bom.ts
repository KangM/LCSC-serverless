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
  referenceDesignator: string | null
  stockQuantity: number
  status: 'sufficient' | 'insufficient' | 'missing' | 'invalid'
  message: string
}

const compact = (value: string) => value.toUpperCase().replace(/[\s_\-./()[\]{}]/g, '')

/** 统一 BOM 与立创规格中常见的电阻单位写法：22R = 22Ω = 22OHM。 */
function canonicalValue(value: string): string {
  const normalized = compact(value).replace(/(?:Ω|OHM|欧姆)$/u, '')
  return /^\d+(?:\.\d+)?$/.test(normalized) ? `${normalized}R` : normalized
}

function matchesName(row: ComponentRow, name: string): boolean {
  const target = canonicalValue(name)
  if (!target) return false
  const candidates = [row.partNumber, row.mpn ?? '', row.name ?? '', ...Object.values(row.specifications)]
  if (candidates.some((value) => canonicalValue(String(value)) === target)) return true
  // Common BOM LED labels (LED_R/LED_G/LED_B) correspond to color in LCSC specs.
  const color = target === 'LEDR' ? '红' : target === 'LEDG' ? '绿' : target === 'LEDB' ? '蓝' : ''
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
        return { designator, name, footprint, supplier: String(raw.supplier ?? '').trim(), quantity, matchedPartNumber: null, matchedName: null, referenceDesignator: null, stockQuantity: 0, status: 'invalid', message: '缺少名称/位号或数量无效' }
      }
      const candidates = components.filter((component) => matchesName(component, name))
      const footprintMatches = candidates.filter((component) => matchesFootprint(component, footprint))
      const matched = footprintMatches[0] ?? candidates[0] ?? null
      const stockQuantity = matched?.stockQuantity ?? 0
      const status = !matched ? 'missing' : stockQuantity >= quantity ? 'sufficient' : 'insufficient'
      return {
        designator, name, footprint, supplier: String(raw.supplier ?? '').trim(), quantity,
        matchedPartNumber: matched?.partNumber ?? null, matchedName: matched?.name ?? null,
        referenceDesignator: matched?.referenceDesignator ?? null, stockQuantity, status,
        message: !matched ? '未找到匹配元件' : status === 'sufficient' ? '库存足够' : '库存不足',
      }
    }),
  }
}
