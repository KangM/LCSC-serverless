/**
 * lib/session.ts — 无状态签名 session（单密码认证）
 *
 * token 格式: base64url({exp,jti}) + "." + base64url(HMAC-SHA256(payload))
 * 纯函数 + Web Crypto（crypto.subtle），可在 proxy.ts（edge）与
 * Route Handler（node）中共同使用，不依赖任何全局状态。
 */

export const SESSION_COOKIE = 'lcsc_session'
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 天

// ---------------------------------------------------------------------------
// 编码工具（btoa/atob 在 edge 与 node 18+ 全局可用）
// ---------------------------------------------------------------------------

function toBase64Url(data: Uint8Array): string {
  let bin = ''
  for (let i = 0; i < data.length; i++) bin += String.fromCharCode(data[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function fromBase64Url(text: string): string {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4)
  return atob(b64)
}

// ---------------------------------------------------------------------------
// HMAC
// ---------------------------------------------------------------------------

/** 恒定时间字符串比较（长度不同直接返回 false） */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('SESSION_SECRET 未配置：生产环境必须设置（openssl rand -hex 32）')
    }
    return 'dev-session-secret-change-me'
  }
  return secret
}

async function hmacSign(payloadB64: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(sessionSecret()),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64))
  return toBase64Url(new Uint8Array(sig))
}

// ---------------------------------------------------------------------------
// Session API
// ---------------------------------------------------------------------------

/** 创建带过期时间的签名 token */
export async function createSessionToken(): Promise<string> {
  const payload = JSON.stringify({
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    jti: crypto.randomUUID(),
  })
  const payloadB64 = toBase64Url(new TextEncoder().encode(payload))
  const sigB64 = await hmacSign(payloadB64)
  return `${payloadB64}.${sigB64}`
}

/** 校验签名与过期时间 */
export async function verifySessionToken(token: string): Promise<boolean> {
  if (typeof token !== 'string' || !token.includes('.')) return false
  const [payloadB64, sigB64] = token.split('.')
  if (!payloadB64 || !sigB64) return false

  let payload: { exp?: number } | null = null
  try {
    payload = JSON.parse(fromBase64Url(payloadB64))
  } catch {
    return false
  }
  if (!payload || typeof payload.exp !== 'number' || Date.now() >= payload.exp * 1000) {
    return false
  }

  const expected = await hmacSign(payloadB64)
  return timingSafeEqual(expected, sigB64)
}

/** 登录密码校验（恒定时间比较，防时序侧信道） */
export function verifyPassword(input: string, expected: string): boolean {
  return timingSafeEqual(input, expected)
}

/** session cookie 的通用选项 */
export function sessionCookieOptions(secure: boolean): {
  httpOnly: boolean
  sameSite: 'lax'
  secure: boolean
  path: string
  maxAge: number
} {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  }
}
