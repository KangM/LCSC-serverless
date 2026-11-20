import { NextResponse, type NextRequest } from 'next/server'
import { syncAllAccounts } from '@/lib/orders/sync'

/**
 * GET /api/cron/sync-orders — 每日定时把平台订单拉进在途池
 *
 * 鉴权同 /api/cron/refresh：Authorization: Bearer $CRON_SECRET
 * 没有配采购账号时是空操作，不会报错。
 */

export const maxDuration = 300

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return NextResponse.json({ ok: false, error: 'CRON_SECRET 未配置' }, { status: 500 })
  }
  if (request.headers.get('authorization') !== `Bearer ${expected}`) {
    return NextResponse.json({ ok: false, error: '未授权' }, { status: 401 })
  }

  try {
    const results = await syncAllAccounts()
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '同步失败' },
      { status: 500 },
    )
  }
}
