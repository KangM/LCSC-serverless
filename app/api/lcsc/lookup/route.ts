import { NextResponse, type NextRequest } from 'next/server'
import { lcsc } from '@/lib/lcsc'

/**
 * GET /api/lcsc/lookup?pn=C14663 — 实时/缓存查立创元件详情
 * 供入库弹窗输入编号后自动补全、扫码/OCR 流程使用。
 * 未找到或风控返回 404，客户端提示后回退手动关键词搜索。
 */
export async function GET(request: NextRequest) {
  const pn = request.nextUrl.searchParams.get('pn')?.trim()
  if (!pn) return NextResponse.json({ ok: false, error: '缺少参数 pn' }, { status: 400 })

  const item = await lcsc.lookupByPartNumber(pn)
  if (!item) {
    return NextResponse.json({ ok: false, error: '未在立创找到该元件' }, { status: 404 })
  }
  return NextResponse.json({ ok: true, item })
}
