import { connection } from 'next/server'
import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/** CSV 专用转义：含逗号/引号/换行时用引号包裹 */
function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

function csvResponse(filename: string, rows: Array<Array<unknown>>): NextResponse {
  const lines = rows.map((row) => row.map(csvCell).join(','))
  // \uFEFF BOM 让 Excel 正确识别 UTF-8 中文
  const body = '\uFEFF' + lines.join('\r\n')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

function timestampedFilename(prefix: string): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  return `${prefix}-${stamp}.csv`
}

function formatSpecifications(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw.trim()) return ['', '', '', '']
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ['', '', '', '']
    return Object.entries(parsed)
      .slice(0, 4)
      .map(([key, value]) => `${key}: ${String(value)}`)
      .concat(['', '', '', ''])
      .slice(0, 4)
  } catch {
    return ['', '', '', '']
  }
}

/** GET /api/export/components — 全量元件 CSV */
export async function GET() {
  await connection()
  const result = await getDb().execute(`
    SELECT components.*, (
      SELECT reference_designator FROM transactions
      WHERE transactions.part_number = components.part_number
        AND reference_designator IS NOT NULL AND trim(reference_designator) <> ''
      ORDER BY transactions.id DESC LIMIT 1
    ) AS reference_designator
    FROM components ORDER BY part_number
  `)
  const rows: Array<Array<unknown>> = [
    ['part_number', 'mpn', 'name', 'brand', 'package', 'category', 'price', 'stock', 'threshold', 'reference_designator', 'spec_1', 'spec_2', 'spec_3', 'spec_4', 'product_url', 'datasheet_url', 'updated_at'],
  ]
  for (const r of result.rows) {
    const specs = formatSpecifications(r.specifications)
    rows.push([
      r.part_number, r.mpn, r.name, r.brand, r.package_name, r.category,
      r.price, r.stock_quantity, r.threshold, r.reference_designator, ...specs,
      r.product_url, r.datasheet_url, r.updated_at,
    ])
  }
  return csvResponse(timestampedFilename('components'), rows)
}
