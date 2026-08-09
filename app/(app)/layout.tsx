import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { AppShell } from './app-shell'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 服务端二次校验（proxy.ts 之外的纵深防御）
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const authed = token ? await verifySessionToken(token) : false
  if (!authed) redirect('/login')

  return <AppShell>{children}</AppShell>
}
