import { NextResponse, type NextRequest } from 'next/server'
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
    },
  })
}

/** GET /api/export/components — 全量元件 CSV */
export async function GET() {
  const result = await getDb().execute('SELECT * FROM components ORDER BY part_number')
  const rows: Array<Array<unknown>> = [
    ['part_number', 'mpn', 'name', 'brand', 'package', 'category', 'price', 'stock', 'threshold', 'product_url', 'datasheet_url', 'updated_at'],
  ]
  for (const r of result.rows) {
    rows.push([
      r.part_number, r.mpn, r.name, r.brand, r.package_name, r.category,
      r.price, r.stock_quantity, r.threshold, r.product_url, r.datasheet_url, r.updated_at,
    ])
  }
  return csvResponse('components.csv', rows)
}
