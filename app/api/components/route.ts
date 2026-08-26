import { NextResponse, type NextRequest } from 'next/server'
import { listComponents } from '@/lib/cache'
import { stockIn } from '@/lib/db'
import { lcsc, type ComponentDetail } from '@/lib/lcsc'

/** GET /api/components?q=&category=&package=&sort=&order=&page=&pageSize= — 元件列表 */
export async function GET(request: NextRequest) {
  const sp = request.nextUrl.searchParams
  const data = await listComponents({
    q: sp.get('q') ?? undefined,
    category: sp.get('category') ?? undefined,
    packageName: sp.get('package') ?? undefined,
    sort: (sp.get('sort') as never) ?? undefined,
    order: (sp.get('order') as never) ?? undefined,
    page: sp.get('page') ? Number(sp.get('page')) : undefined,
    pageSize: sp.get('pageSize') ? Number(sp.get('pageSize')) : undefined,
  })
  return NextResponse.json({ ok: true, ...data })
}

/**
 * POST /api/components — 入库
 * body: { partNumber, quantity, referenceDesignator?, purchasePrice?, note?, detail? }
 * detail 缺省时服务端实时查立创补全（客户端传入的 detail 也以服务端为准更新缓存）。
 */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const partNumber: unknown = body?.partNumber
  const quantity: unknown = body?.quantity
  const note: unknown = body?.note
  const referenceDesignator: unknown = body?.referenceDesignator
  const purchasePrice: unknown = body?.purchasePrice
  const detail: ComponentDetail | null | undefined = body?.detail

  if (typeof partNumber !== 'string' || !partNumber.trim()) {
    return NextResponse.json({ ok: false, error: '缺少参数 partNumber' }, { status: 400 })
  }
  if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity < 1) {
    return NextResponse.json({ ok: false, error: '数量必须为正整数' }, { status: 400 })
  }
  if (purchasePrice != null && (typeof purchasePrice !== 'number' || !Number.isFinite(purchasePrice) || purchasePrice < 0)) {
    return NextResponse.json({ ok: false, error: '入手价格必须是非负数字' }, { status: 400 })
  }

  // 已存在则无需立创详情；不存在时：客户端给了 detail 就用，否则实时查
  let effectiveDetail: ComponentDetail | null | undefined = detail
  const existing = await listComponents({ q: partNumber.trim(), pageSize: 1 })
  if (existing.total === 0) {
    if (!effectiveDetail) {
      effectiveDetail = await lcsc.lookupByPartNumber(partNumber)
    }
    if (!effectiveDetail) {
      return NextResponse.json(
        { ok: false, error: '未在立创找到该元件，请检查编号或稍后重试' },
        { status: 404 },
      )
    }
  }

  try {
    const row = await stockIn(partNumber, quantity, {
      detail: effectiveDetail,
      referenceDesignator: typeof referenceDesignator === 'string' ? referenceDesignator : undefined,
      purchasePrice: typeof purchasePrice === 'number' ? purchasePrice : undefined,
      note: typeof note === 'string' ? note : undefined,
    })
    return NextResponse.json({ ok: true, item: row })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '入库失败' },
      { status: 400 },
    )
  }
}
