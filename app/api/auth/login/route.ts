import { NextResponse, type NextRequest } from 'next/server'
import {
  createSessionToken,
  sessionCookieOptions,
  verifyPassword,
  SESSION_COOKIE,
} from '@/lib/session'

function isSecureRequest(request: NextRequest): boolean {
  const forwardedProto = request.headers.get('x-forwarded-proto')?.split(',')[0]?.trim()
  return forwardedProto === 'https' || request.nextUrl.protocol === 'https:'
}

export async function POST(request: NextRequest) {
  const expected = process.env.APP_PASSWORD
  if (!expected) {
    return NextResponse.json(
      { ok: false, error: '服务端未配置 APP_PASSWORD，请检查环境变量' },
      { status: 500 },
    )
  }

  const isJson = request.headers.get('content-type')?.includes('application/json')
  let password: unknown = null
  try {
    if (isJson) {
      ({ password } = await request.json())
    } else {
      password = (await request.formData()).get('password')
    }
  } catch {
    return NextResponse.json({ ok: false, error: '请求体无效' }, { status: 400 })
  }

  if (typeof password !== 'string' || !verifyPassword(password, expected)) {
    return NextResponse.json({ ok: false, error: '密码错误' }, { status: 401 })
  }

  const token = await createSessionToken()
  const res = isJson
    ? NextResponse.json({ ok: true })
    : NextResponse.redirect(new URL('/', request.url), 303)
  res.cookies.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(isSecureRequest(request)),
  )
  return res
}
