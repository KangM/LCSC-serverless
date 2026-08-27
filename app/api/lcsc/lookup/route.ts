import { NextResponse, type NextRequest } from 'next/server'
import { lcsc } from '@/lib/lcsc'
import { suggestReferenceDesignator } from '@/lib/db'
import { setServerTiming } from '@/lib/server-timing'

/**
 * GET /api/lcsc/lookup?pn=C14663 — 实时/缓存查立创元件详情
 * 供入库弹窗输入编号后自动补全、扫码/OCR 流程使用。
 * 未找到或风控返回 404，客户端提示后回退手动关键词搜索。
 */
export async function GET(request: NextRequest) {
  const startedAt = performance.now()
  const pn = request.nextUrl.searchParams.get('pn')?.trim()
  if (!pn) return NextResponse.json({ ok: false, error: '缺少参数 pn' }, { status: 400 })

  const lookup = await lcsc.lookupByPartNumberTimed(pn)
  const item = lookup.value
  if (!item) {
    return setServerTiming(
      NextResponse.json({ ok: false, error: '未在立创找到该元件' }, { status: 404 }),
      [
        { name: 'lcsc_queue', duration: lookup.timing.queueMs },
        { name: 'lcsc_fetch', duration: lookup.timing.fetchMs, description: lookup.timing.cache },
        { name: 'total', duration: performance.now() - startedAt },
      ],
    )
  }
  const dbStartedAt = performance.now()
  const suggestedReferenceDesignator = await suggestReferenceDesignator(item.partNumber, item.category)
  return setServerTiming(NextResponse.json({ ok: true, item, suggestedReferenceDesignator }), [
    { name: 'lcsc_queue', duration: lookup.timing.queueMs },
    { name: 'lcsc_fetch', duration: lookup.timing.fetchMs, description: lookup.timing.cache },
    { name: 'db', duration: performance.now() - dbStartedAt },
    { name: 'total', duration: performance.now() - startedAt },
  ])
}
