import { NextResponse, type NextRequest } from 'next/server'
import {
  createManualOrder,
  listOrders,
  purchaseSummary,
  type PurchaseOrderInput,
  type PurchaseOrderItemInput,
  type PurchaseSource,
  type ShipmentState,
} from '@/lib/purchase-orders'

const SOURCES: PurchaseSource[] = ['lcsc', 'taobao', 'manual']
const STATES: ShipmentState[] = ['pending', 'shipped', 'received', 'cancelled', 'unknown']

function asItems(raw: unknown): PurchaseOrderItemInput[] {
  if (!Array.isArray(raw)) return []
  return (raw as Array<Record<string, unknown>>)
    .map((row) => ({
      lineNo: row.lineNo == null ? null : Number(row.lineNo),
      supplierPartNo: row.supplierPartNo == null ? null : String(row.supplierPartNo).trim(),
      mpn: row.mpn == null ? null : String(row.mpn).trim(),
      title: String(row.title ?? '').trim(),
      quantity: Math.trunc(Number(row.quantity ?? 0)),
      unitPrice: row.unitPrice == null || row.unitPrice === '' ? null : Number(row.unitPrice),
      matchedPartNumber: row.matchedPartNumber == null ? null : String(row.matchedPartNumber).trim(),
      note: row.note == null ? null : String(row.note),
    }))
    .filter((item) => item.title && item.quantity > 0)
}

/** GET /api/orders?source=&state=&q=&limit= — 订单列表 + 在途汇总 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const source = params.get('source')
  const state = params.get('state')
  const [orders, summary] = await Promise.all([
    listOrders({
      source: SOURCES.includes(source as PurchaseSource) ? (source as PurchaseSource) : undefined,
      shipmentState: STATES.includes(state as ShipmentState) ? (state as ShipmentState) : undefined,
      q: params.get('q') ?? undefined,
      limit: Number(params.get('limit')) || undefined,
    }),
    purchaseSummary(),
  ])
  return NextResponse.json({ ok: true, orders, summary })
}

/** POST /api/orders — 手工录入订单（淘宝订单没走 OCR 时的保底入口） */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ ok: false, error: '请求体无法解析' }, { status: 400 })

  const source = SOURCES.includes(body.source) ? (body.source as PurchaseSource) : 'manual'
  const orderNo = String(body.orderNo ?? '').trim()
  const items = asItems(body.items)
  if (!orderNo) return NextResponse.json({ ok: false, error: '请填写订单号' }, { status: 400 })
  if (items.length === 0) return NextResponse.json({ ok: false, error: '至少填一行有效的商品（名称 + 数量）' }, { status: 400 })

  const input: PurchaseOrderInput = {
    source,
    accountId: body.accountId == null ? null : Number(body.accountId),
    orderNo,
    statusText: body.statusText == null ? null : String(body.statusText),
    shipmentState: STATES.includes(body.shipmentState) ? body.shipmentState : 'pending',
    orderedAt: body.orderedAt == null ? null : String(body.orderedAt),
    receivedAt: body.receivedAt == null ? null : String(body.receivedAt),
    totalAmount: body.totalAmount == null || body.totalAmount === '' ? null : Number(body.totalAmount),
    note: body.note == null ? null : String(body.note),
    items,
  }

  try {
    const id = await createManualOrder(input)
    return NextResponse.json({ ok: true, id })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '保存订单失败' },
      { status: 400 },
    )
  }
}
