import { NextResponse, type NextRequest } from 'next/server'
import { listTransactions } from '@/lib/cache'

function csvCell(value: unknown): string {
  const s = value == null ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** GET /api/export/transactions?pn=&type=&from=&to= — 流水 CSV（支持与页面一致的筛选） */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const type = sp.get('type')
  const data = await listTransactions({
    partNumber: sp.get('pn') ?? undefined,
    type: type === 'in' || type === 'out' || type === 'adjust' ? type : undefined,
    from: sp.get('from') ?? undefined,
    to: sp.get('to') ?? undefined,
    page: 1,
    pageSize: 10000,
  })

  const rows: Array<Array<unknown>> = [
    ['id', 'time', 'part_number', 'name', 'type', 'quantity', 'before_qty', 'after_qty', 'reference_designator', 'purchase_price', 'note', 'operator'],
  ]
  for (const t of data.items) {
    rows.push([
      t.id, new Date(t.createdAt).toISOString(), t.partNumber, t.name,
      t.type, t.quantity, t.beforeQty, t.afterQty, t.referenceDesignator, t.purchasePrice, t.note, t.operator,
    ])
  }

  const body = '\uFEFF' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  return new NextResponse(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="transactions.csv"',
    },
  })
}
