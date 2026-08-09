/**
 * proxy.ts — 全局认证保护（Next.js 16 取代 middleware.ts 的文件约定）
 *
 * 逻辑：
 *   - 未登录访问受保护页面/API → 重定向 /login?next=<原路径>
 *   - 已登录访问 /login → 重定向首页
 * 放行：登录接口、静态资源（_next、public 文件）。
 *
 * 注意：proxy 在 CDN/edge 上独立执行，只依赖本文件 import 的纯函数模块。
 */
import { NextResponse, type NextRequest } from 'next/server'
import { SESSION_COOKIE, verifySessionToken } from './lib/session'

export async function proxy(request: NextRequest) {
  const t0 = performance.now()
  const token = request.cookies.get(SESSION_COOKIE)?.value
  const tAuth = performance.now()
  const authed = token ? await verifySessionToken(token) : false
  console.log(`[perf] proxy auth ${(performance.now() - tAuth).toFixed(1)}ms token=${token ? 'yes' : 'no'}`)
  const { pathname } = request.nextUrl

  // 已登录访问登录页 → 回首页
  if (authed && pathname === '/login') {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // 未登录访问受保护页面 → 去登录页并记录原路径
  if (!authed && pathname !== '/login') {
    const url = new URL('/login', request.url)
    if (pathname !== '/') url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  console.log(`[perf] proxy total ${(performance.now() - t0).toFixed(1)}ms ${pathname}`)
  return NextResponse.next()
}

export const config = {
  // 负向匹配：排除登录接口与静态资源
  matcher: [
    '/((?!api/auth/login|_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)',
  ],
}
