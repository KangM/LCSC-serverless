import { NextResponse, type NextRequest } from 'next/server'
import { adjustStock, getComponent, stockIn, stockOut } from '@/lib/db'
import { lcsc, type ComponentDetail } from '@/lib/lcsc'

type Params = { params: Promise<{ partNumber: string }> }

/**
 * POST /api/components/[partNumber]/stock — 库存操作
 * body:
 *   { action: 'in', quantity, referenceDesignator?, purchasePrice?, note?, detail? } 入库
 *   { action: 'out',   quantity, note? }                  出库
 *   { action: 'adjust', actualQuantity, note? }           盘点（修正为实点数）
 */
export async function POST(request: NextRequest, { params }: Params) {
  const { partNumber } = await params
  const body = await request.json().catch(() => null)
  const action: unknown = body?.action
  const note: unknown = body?.note

  try {
    if (action === 'in') {
      const quantity = Number(body?.quantity)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return NextResponse.json({ ok: false, error: '数量必须为正整数' }, { status: 400 })
      }
      const purchasePrice = body?.purchasePrice
      if (purchasePrice != null && (!Number.isFinite(Number(purchasePrice)) || Number(purchasePrice) < 0)) {
        return NextResponse.json({ ok: false, error: '入手价格必须是非负数字' }, { status: 400 })
      }
      let detail: ComponentDetail | null | undefined = body?.detail
      if (!(await getComponent(partNumber))) {
        if (!detail) detail = await lcsc.lookupByPartNumber(partNumber)
        if (!detail) {
          return NextResponse.json(
            { ok: false, error: '未在立创找到该元件，请检查编号或稍后重试' },
            { status: 404 },
          )
        }
      }
      const row = await stockIn(partNumber, quantity, {
        detail,
        referenceDesignator: typeof body?.referenceDesignator === 'string' ? body.referenceDesignator : undefined,
        purchasePrice: purchasePrice == null ? undefined : Number(purchasePrice),
        note: typeof note === 'string' ? note : undefined,
      })
      return NextResponse.json({ ok: true, item: row })
    }

    if (action === 'out') {
      const quantity = Number(body?.quantity)
      if (!Number.isFinite(quantity) || quantity < 1) {
        return NextResponse.json({ ok: false, error: '数量必须为正整数' }, { status: 400 })
      }
      const row = await stockOut(partNumber, quantity, {
        note: typeof note === 'string' ? note : undefined,
      })
      return NextResponse.json({ ok: true, item: row })
    }

    if (action === 'adjust') {
      const actualQuantity = Number(body?.actualQuantity)
      if (!Number.isFinite(actualQuantity) || actualQuantity < 0) {
        return NextResponse.json({ ok: false, error: '实点数必须是非负整数' }, { status: 400 })
      }
      const row = await adjustStock(partNumber, actualQuantity, {
        note: typeof note === 'string' ? note : undefined,
      })
      return NextResponse.json({ ok: true, item: row })
    }

    return NextResponse.json({ ok: false, error: '未知 action' }, { status: 400 })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '操作失败' },
      { status: 400 },
    )
  }
}
