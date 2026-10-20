import { connection } from 'next/server'
import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { formatComponentPrintFields } from '@/lib/component-print-template'
import { buildXlsx } from '@/lib/xlsx'

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

function xlsxResponse(filename: string, rows: Array<Array<unknown>>, sheetName: string): NextResponse {
  const body = buildXlsx(rows, sheetName)
  return new NextResponse(new Uint8Array(body), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length': String(body.length),
      'Cache-Control': 'no-store, no-cache, must-revalidate',
    },
  })
}

/** 文件名时间戳固定用北京时间，避免服务器 TZ 影响（Docker 里是 Asia/Shanghai，本机不一定） */
function timestampedFilename(prefix: string, ext: 'csv' | 'xlsx'): string {
  const d = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(d).reduce<Record<string, string>>((out, part) => {
    out[part.type] = part.value
    return out
  }, {})
  const stamp = `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`
  return `${prefix}-${stamp}.${ext}`
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

/**
 * GET /api/export/components
 *   ?from=&to=  按录入时间（created_at，UTC ISO 边界）筛选，缺省不过滤
 *   ?format=print 打印标签格式：按录入时间正序、短类别 + 四列规格，返回 xlsx
 *   否则全量元件表，按立创编号排序，返回 csv
 */
export async function GET(request: NextRequest) {
  await connection()
  const sp = request.nextUrl.searchParams
  const printFormat = sp.get('format') === 'print'
  const from = sp.get('from')
  const to = sp.get('to')

  const where: string[] = []
  const args: string[] = []
  if (from) {
    where.push('created_at >= ?')
    args.push(from)
  }
  if (to) {
    where.push('created_at <= ?')
    args.push(to)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  // 打印格式按「先入库的先打印」，同一时刻再按编号兜底，保证顺序稳定
  const orderSql = printFormat ? 'ORDER BY created_at ASC, part_number ASC' : 'ORDER BY part_number'

  const result = await getDb().execute({
    sql: `
    SELECT components.*, (
      SELECT reference_designator FROM transactions
      WHERE transactions.part_number = components.part_number
        AND reference_designator IS NOT NULL AND trim(reference_designator) <> ''
      ORDER BY transactions.id DESC LIMIT 1
    ) AS reference_designator
    FROM components ${whereSql} ${orderSql}
  `,
    args,
  })

  const rows: Array<Array<unknown>> = [
    ['part_number', 'mpn', 'name', 'brand', 'package', 'category', 'price', 'stock', 'threshold', 'reference_designator', 'spec_1', 'spec_2', 'spec_3', 'spec_4', 'product_url', 'datasheet_url', 'updated_at'],
  ]
  for (const r of result.rows) {
    const printFields = printFormat ? formatComponentPrintFields(r.category, r.specifications) : null
    const specs = printFields?.specifications ?? formatSpecifications(r.specifications)
    rows.push([
      r.part_number, r.mpn, r.name, r.brand, r.package_name, printFields?.category ?? r.category,
      r.price, r.stock_quantity, r.threshold, r.reference_designator, ...specs,
      r.product_url, r.datasheet_url, r.updated_at,
    ])
  }

  if (printFormat) {
    return xlsxResponse(timestampedFilename('components-print', 'xlsx'), rows, '打印格式')
  }
  return csvResponse(timestampedFilename('components', 'csv'), rows)
}
