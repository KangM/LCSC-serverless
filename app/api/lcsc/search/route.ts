import { NextResponse, type NextRequest } from 'next/server'
import { lcsc } from '@/lib/lcsc'
import { getComponentsByPartNumbers } from '@/lib/cache'
import { setServerTiming } from '@/lib/server-timing'

/**
 * GET /api/lcsc/search?k=关键词&page=1 — 立创关键词分页搜索（代理）
 * 供入库弹窗关键词搜索候选、OCR 识别后选词使用。
 * 额外返回 inStockSet：本页结果中已存在于本地库存的立创编号集合。
 */
export async function GET(request: NextRequest) {
  const startedAt = performance.now()
  const k = request.nextUrl.searchParams.get('k')?.trim()
  if (!k) return NextResponse.json({ ok: false, error: '缺少参数 k' }, { status: 400 })
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? 1) || 1)

  const search = await lcsc.searchPagedTimed(k, page, 30)
  const paged = search.value
  if (search.failure) {
    return setServerTiming(
      NextResponse.json(
        { ok: false, error: `立创搜索服务异常（${search.failure.code}），请稍后重试` },
        { status: 502 },
      ),
      [
        { name: 'lcsc_queue', duration: search.timing.queueMs },
        { name: 'lcsc_fetch', duration: search.timing.fetchMs, description: search.failure.code },
        { name: 'total', duration: performance.now() - startedAt },
      ],
    )
  }
  if (paged.totalCount === 0) {
    return setServerTiming(
      NextResponse.json({ ok: false, error: '立创未返回结果，可能是风控或关键词无效' }, { status: 404 }),
      [
        { name: 'lcsc_queue', duration: search.timing.queueMs },
        { name: 'lcsc_fetch', duration: search.timing.fetchMs, description: search.timing.cache },
        { name: 'total', duration: performance.now() - startedAt },
      ],
    )
  }

  // 标记本页结果是否已在本地库存中
  const dbStartedAt = performance.now()
  const inDb = await getComponentsByPartNumbers(paged.items.map((i) => i.partNumber))
  const inStockSet = [...inDb.keys()]

  return setServerTiming(NextResponse.json({ ok: true, ...paged, inStockSet }), [
    { name: 'lcsc_queue', duration: search.timing.queueMs },
    { name: 'lcsc_fetch', duration: search.timing.fetchMs, description: search.timing.cache },
    { name: 'db', duration: performance.now() - dbStartedAt },
    { name: 'total', duration: performance.now() - startedAt },
  ])
}
