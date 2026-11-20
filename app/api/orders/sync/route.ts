import { NextResponse, type NextRequest } from 'next/server'
import { syncAccount, syncAllAccounts } from '@/lib/orders/sync'

/**
 * POST /api/orders/sync — 从平台拉订单进在途池
 *
 * body 两种形态：
 *   { accountId: 3 }  只同步这一个账号（前端「同步」按钮）
 *   {}                同步全部启用中的账号（定时任务）
 *
 * 注意：这里 HTTP 200 只代表「同步流程跑完了」，具体成败看 results[].status，
 * Cookie 失效 / 触发滑块都算正常业务结果，不该用 4xx 表达。
 */

// 多个账号串行拉取，留足时间
export const maxDuration = 120

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)

  try {
    if (body?.accountId != null) {
      const accountId = Number(body.accountId)
      if (!Number.isInteger(accountId) || accountId <= 0) {
        return NextResponse.json({ ok: false, error: 'accountId 无效' }, { status: 400 })
      }
      const result = await syncAccount(accountId)
      return NextResponse.json({ ok: true, results: [result] })
    }

    const results = await syncAllAccounts()
    return NextResponse.json({ ok: true, results })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '同步失败' },
      { status: 400 },
    )
  }
}
