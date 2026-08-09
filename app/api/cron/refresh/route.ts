import { NextResponse, type NextRequest } from 'next/server'
import { getDb, upsertComponentFromLcsc } from '@/lib/db'
import { lcsc } from '@/lib/lcsc'

export const dynamic = 'force-dynamic'

/**
 * GET /api/cron/refresh — 每日定时刷新全部元件信息（vercel.json crons 调用）
 * 鉴权：请求头 Authorization: Bearer $CRON_SECRET（Vercel Cron 自动携带）。
 * 逐件走 lib/lcsc 串行限速刷新名称/价格/规格，失败跳过（不中断整体）。
 */
export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET 未配置' }, { status: 500 })
  }
  const auth = request.headers.get('authorization')
  if (auth !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: '未授权' }, { status: 401 })
  }

  const result = await getDb().execute('SELECT part_number FROM components ORDER BY part_number')
  const partNumbers = result.rows.map((r) => r.part_number as string)

  let refreshed = 0
  let failed = 0
  const errors: Array<{ partNumber: string; error: string }> = []

  for (const pn of partNumbers) {
    try {
      const detail = await lcsc.refreshPartNumber(pn)
      if (detail) {
        await upsertComponentFromLcsc(detail)
        refreshed++
      } else {
        failed++
        errors.push({ partNumber: pn, error: '立创未返回（风控或编号失效）' })
      }
    } catch (error) {
      failed++
      errors.push({ partNumber: pn, error: error instanceof Error ? error.message : '未知错误' })
    }
  }

  return NextResponse.json({ ok: true, total: partNumbers.length, refreshed, failed, errors: errors.slice(0, 10) })
}
