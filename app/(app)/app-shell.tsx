'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { LogoutButton } from './logout-button'

const NAV_ITEMS = [
  { href: '/', label: '仪表盘', icon: '📊' },
  { href: '/components', label: '元件列表', icon: '🔌' },
  { href: '/transactions', label: '流水记录', icon: '🧾' },
  { href: '/reports', label: '统计报表', icon: '📈' },
  { href: '/import', label: '导入导出', icon: '📥' },
  { href: '/settings', label: '设置', icon: '⚙️' },
]

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  return (
    <>
      {NAV_ITEMS.map((item) => {
        const active = item.href === '/' ? pathname === '/' : pathname.startsWith(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm ${
              active ? 'bg-blue-50 font-medium text-blue-700' : 'text-neutral-700 hover:bg-neutral-100'
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        )
      })}
    </>
  )
}

/** 响应式外壳：md+ 左侧边栏，md- 顶部栏 + 抽屉菜单 */
type BuildInfo = {
  commit: string | null
  message: string | null
}

function BuildInfo({ info }: { info: BuildInfo }) {
  if (!info.commit) {
    return <p className="px-2 text-xs text-neutral-400">未提供 Git 信息</p>
  }

  return (
    <div className="px-2 text-xs leading-5 text-neutral-400" title={info.message ?? undefined}>
      <div className="font-mono">提交 {info.commit}</div>
      {info.message && <div className="truncate">{info.message}</div>}
    </div>
  )
}

export function AppShell({ children, buildInfo }: { children: React.ReactNode; buildInfo: BuildInfo }) {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-neutral-50 md:flex-row">
      {/* 移动端顶部栏 */}
      <header className="flex items-center justify-between border-b border-neutral-200 bg-white px-4 py-3 md:hidden">
        <div>
          <div className="text-base font-bold">元件库存管理</div>
          <div className="text-xs text-neutral-400">LCSC Inventory</div>
        </div>
        <button
          onClick={() => setMenuOpen(true)}
          className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm"
          aria-label="打开菜单"
        >
          ☰ 菜单
        </button>
      </header>

      {/* 移动端抽屉 */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" onClick={() => setMenuOpen(false)}>
          <div className="absolute inset-0 bg-black/40" />
          <div
            className="absolute inset-y-0 left-0 flex w-64 flex-col bg-white p-3 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between border-b border-neutral-200 px-3 pb-3">
              <span className="font-bold">元件库存管理</span>
              <button onClick={() => setMenuOpen(false)} className="rounded p-1 text-neutral-400 hover:bg-neutral-100" aria-label="关闭菜单">
                ✕
              </button>
            </div>
            <nav className="flex-1 space-y-0.5">
              <NavLinks onNavigate={() => setMenuOpen(false)} />
            </nav>
            <div className="border-t border-neutral-200 pt-2">
              <BuildInfo info={buildInfo} />
              <LogoutButton />
            </div>
          </div>
        </div>
      )}

      {/* 桌面侧边栏 */}
      <aside className="hidden w-52 shrink-0 flex-col border-r border-neutral-200 bg-white md:flex">
        <div className="border-b border-neutral-200 px-4 py-4">
          <div className="text-base font-bold">元件库存管理</div>
          <div className="text-xs text-neutral-400">LCSC Inventory</div>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          <NavLinks />
        </nav>
        <div className="border-t border-neutral-200 p-2">
          <BuildInfo info={buildInfo} />
          <LogoutButton />
        </div>
      </aside>

      <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
    </div>
  )
}
