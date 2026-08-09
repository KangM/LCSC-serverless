import { NextResponse, type NextRequest } from 'next/server'
import {
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
  SESSION_COOKIE,
} from '@/lib/session'

export async function POST(request: NextRequest) {
  const expected = process.env.APP_PASSWORD
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: '服务端未配置 APP_PASSWORD，请检查环境变量' },
      { status: 500 },
    )
  }

  let password: unknown = null
  try {
    ({ password } = await request.json())
  } catch {
    return NextResponse.json({ ok: false, error: '请求体不是有效 JSON' }, { status: 400 })
  }

  if (typeof password !== 'string' || !verifyPassword(password, expected)) {
    return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 })
  }

  const token = await createSessionToken()
  const res = NextResponse.json({ ok: true })
  res.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(process.env.NODE_ENV === 'production'),
  )
  return res
}
