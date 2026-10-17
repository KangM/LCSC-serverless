import { NextResponse, type NextRequest } from 'next/server'
import { stockOutBatch, type StockOutBatchItem } from '@/lib/db'

/**
 * POST /api/bom/consume — 按 BOM 勾选结果一次性出库（焊接扣减）
 * body: { items: [{ partNumber, quantity, designators? }], note?, allowOversell? }
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const rawItems: unknown = body?.items
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    return NextResponse.json({ ok: false, error: '没有勾选任何元件' }, { status: 400 })
  }

  const items: StockOutBatchItem[] = []
  for (const raw of rawItems as Array<Record<string, unknown>>) {
    const partNumber = String(raw?.partNumber ?? '').trim()
    if (!partNumber) continue
    items.push({
      partNumber,
      quantity: Number(raw?.quantity),
      designators: Array.isArray(raw?.designators)
        ? (raw.designators as unknown[]).map((value) => String(value))
        : [],
    })
  }
  if (items.length === 0) {
    return NextResponse.json({ ok: false, error: '没有有效的元件编号' }, { status: 400 })
  }

  try {
    const results = await stockOutBatch(items, {
      note: typeof body?.note === 'string' ? body.note : undefined,
      allowOversell: body?.allowOversell === true,
    })
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '出库失败' },
      { status: 400 },
    )
  }
}
