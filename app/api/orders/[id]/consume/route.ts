import { NextResponse, type NextRequest } from 'next/server'
import { consumeOrderItems, type ConsumeEntry } from '@/lib/purchase-orders'

type Params = { params: Promise<{ id: string }> }

/**
 * POST /api/orders/[id]/consume — 到货核销入库
 * body: { items: [{ itemId, quantity, purchasePrice?, referenceDesignator?, note? }], operator? }
 *
 * 「改库存 + 写流水 + 累加已核销量」在数据层是一个原子 batch，
 * 所以核销后该行的在途量同步归零，不会重复计数。
 */
export async function POST(request: NextRequest, { params }: Params) {
  await params
  const body = await request.json().catch(() => null)
  const rawItems: unknown = body?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ ok: false, error: '没有勾选任何待核销的行' }, { status: 400 })
  }

  const entries: ConsumeEntry[] = []
  for (const raw of rawItems as Array<Record<string, unknown>>) {
    const itemId = Number(raw?.itemId)
    const quantity = Math.trunc(Number(raw?.quantity))
    if (!Number.isFinite(itemId) || itemId <= 0) continue
    if (!Number.isFinite(quantity) || quantity < 1) continue
    entries.push({
      itemId,
      quantity,
      purchasePrice: raw?.purchasePrice == null || raw?.purchasePrice === '' ? null : Number(raw.purchasePrice),
      referenceDesignator: raw?.referenceDesignator == null ? null : String(raw.referenceDesignator),
      note: raw?.note == null ? null : String(raw.note),
    })
  }
  if (entries.length === 0) {
    return NextResponse.json({ ok: false, error: '没有有效的核销行（需要 itemId 与数量）' }, { status: 400 })
  }

  try {
    const results = await consumeOrderItems(entries, typeof body?.operator === 'string' ? body.operator : undefined)
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '核销失败' },
      { status: 400 },
    )
  }
}
