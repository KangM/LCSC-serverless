import { NextResponse, type NextRequest } from 'next/server'
import { lcsc } from '@/lib/lcsc'

/**
 * GET /api/lcsc/search?k=关键词&page=1 — 立创关键词分页搜索（代理）
 * 供入库弹窗关键词搜索候选、OCR 识别后选词使用。
 */
export async function GET(request: NextRequest) {
  const k = request.nextUrl.searchParams.get('k')?.trim()
  if (!k) return NextResponse.json({ ok: false, error: '缺少参数 k' }, { status: 400 })
  const page = Math.max(1, Number(request.nextUrl.searchParams.get('page') ?? 1) || 1)

  const paged = await lcsc.searchPaged(k, page, 30)
  if (paged.totalCount === 0) {
    return NextResponse.json({ ok: false, error: '立创未返回结果，可能是风控或关键词无效' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, ...paged })
}
