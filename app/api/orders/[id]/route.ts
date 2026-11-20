import { NextResponse, type NextRequest } from 'next/server'
import { deleteOrder, setOrderState, type ShipmentState } from '@/lib/purchase-orders'

type Params = { params: Promise<{ id: string }> }

const STATES: ShipmentState[] = ['pending', 'shipped', 'received', 'cancelled', 'unknown']

/** /api/orders/items 这类静态子路径不该落到这里，id 必须是正整数 */
function parseId(raw: string): number | null {
  const id = Number(raw)
  return Number.isInteger(id) && id > 0 ? id : null
}

/** PATCH /api/orders/[id] — 手动推进物流阶段（平台给不出状态时自己标） */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const orderId = parseId(id)
  if (orderId === null) return NextResponse.json({ ok: false, error: '订单 id 无效' }, { status: 400 })

  const body = await request.json().catch(() => null)
  const state = body?.shipmentState
  if (!STATES.includes(state)) {
    return NextResponse.json({ ok: false, error: `shipmentState 必须是 ${STATES.join(' / ')}` }, { status: 400 })
  }
  await setOrderState(orderId, state)
  return NextResponse.json({ ok: true })
}

/** DELETE /api/orders/[id] — 删除订单及其行项目（已核销的库存流水保留） */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { id } = await params
  const orderId = parseId(id)
  if (orderId === null) return NextResponse.json({ ok: false, error: '订单 id 无效' }, { status: 400 })

  await deleteOrder(orderId)
  return NextResponse.json({ ok: true })
}
