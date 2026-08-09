import Link from 'next/link'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session'
import { LogoutButton } from './logout-button'

const NAV_ITEMS = [
  { href: '/', label: '仪表盘', icon: '📊' },
  { href: '/components', label: '元件列表', icon: '🔌' },
  { href: '/transactions', label: '流水记录', icon: '🧾' },
  { href: '/reports', label: '统计报表', icon: '📈' },
  { href: '/import', label: '导入导出', icon: '📥' },
  { href: '/settings', label: '设置', icon: '⚙️' },
]

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  // 服务端二次校验（proxy.ts 之外的纵深防御）
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  const authed = token ? await verifySessionToken(token) : false
  if (!authed) redirect('/login')

  return (
    <div className="flex min-h-screen bg-neutral-50">
      <aside className="flex w-52 shrink-0 flex-col border-r border-neutral-200 bg-white">
        <div className="border-b border-neutral-200 px-4 py-4">
          <div className="text-base font-bold">元件库存管理</div>
          <div className="text-xs text-neutral-400">LCSC Inventory</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-100"
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-neutral-200 p-2">
          <LogoutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">{children}</main>
    </div>
  )
}
