import { NextResponse, type NextRequest } from 'next/server'
import { bindOrderItem } from '@/lib/purchase-orders'

type Params = { params: Promise<{ id: string }> }

/**
 * PATCH /api/orders/items/[id] — 把订单行绑定到库存元件
 * body: { partNumber, rememberAlias? }
 * rememberAlias 为真时记下标题别名，下次同标题的订单行自动命中（淘宝必用）。
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { id } = await params
  const body = await request.json().catch(() => null)
  const partNumber = String(body?.partNumber ?? '').trim()
  if (!partNumber) return NextResponse.json({ ok: false, error: '请填写立创编号' }, { status: 400 })

  try {
    await bindOrderItem(Number(id), partNumber, { rememberAlias: body?.rememberAlias === true })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '绑定失败' },
      { status: 400 },
    )
  }
}
