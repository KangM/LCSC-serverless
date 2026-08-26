import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { AppShell } from './app-shell'

// cacheComponents 默认启用 PPR 预渲染；本段页面依赖 cookies/searchParams 等动态数据
// 且未按 Suspense 拆分，保持阻塞式动态渲染（与开启缓存前行为一致）。
export const instant = false

function buildInfo() {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA
  const message = process.env.VERCEL_GIT_COMMIT_MESSAGE
  return {
    commit: sha ? sha.slice(0, 7) : null,
    message: message?.trim() || null,
  }
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 服务端二次校验（proxy.ts 之外的纵深防御）
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const authed = token ? await verifySessionToken(token) : false
  if (!authed) redirect('/login')

  return <AppShell buildInfo={buildInfo()}>{children}</AppShell>
}
