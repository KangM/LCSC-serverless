import { NextResponse, type NextRequest } from 'next/server'
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
  type AccountSource,
} from '@/lib/purchase-orders'

/**
 * /api/orders/accounts — 采购账户（多账户 Cookie）管理
 *
 * 同一平台可配多个账号（个人号 / 公司采购号），每个账号一份登录 Cookie，
 * 订单分别同步、在途量合并统计。接口永远不返回 Cookie 原文，只给末尾 6 位便于辨认。
 */
export async function GET() {
  return NextResponse.json({ ok: true, accounts: await listAccounts() })
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const source: AccountSource = body?.source === 'taobao' ? 'taobao' : 'lcsc'
  try {
    const account = await createAccount({
      source,
      label: String(body?.label ?? ''),
      username: body?.username == null ? null : String(body.username),
      cookie: String(body?.cookie ?? ''),
    })
    return NextResponse.json({ ok: true, account })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '新增账号失败' },
      { status: 400 },
    )
  }
}

export async function PATCH(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const id = Number(body?.id)
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: '缺少账号 id' }, { status: 400 })
  }
  try {
    const account = await updateAccount(id, {
      ...(body?.label === undefined ? {} : { label: String(body.label) }),
      ...(body?.username === undefined ? {} : { username: body.username == null ? null : String(body.username) }),
      ...(body?.cookie === undefined ? {} : { cookie: String(body.cookie) }),
      ...(body?.enabled === undefined ? {} : { enabled: body.enabled === true }),
    })
    return NextResponse.json({ ok: true, account })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '更新账号失败' },
      { status: 400 },
    )
  }
}

export async function DELETE(request: NextRequest) {
  const id = Number(request.nextUrl.searchParams.get('id'))
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, error: '缺少账号 id' }, { status: 400 })
  }
  await deleteAccount(id)
  return NextResponse.json({ ok: true })
}
