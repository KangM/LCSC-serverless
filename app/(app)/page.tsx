import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Card } from '@/components/ui'
import { DashboardQuickActions } from '@/components/DashboardQuickActions'
import { TimeText } from '@/components/TimeText'
import { dashboardStats, listLowStock, recentTransactions } from '@/lib/db'

export const metadata: Metadata = { title: '仪表盘 · 元件库存管理' }

const TYPE_LABELS: Record<string, { label: string; color: 'green' | 'red' | 'amber' }> = {
  in: { label: '入库', color: 'green' },
  out: { label: '出库', color: 'red' },
  adjust: { label: '盘点', color: 'amber' },
}

export default async function DashboardPage() {
  const [stats, lowStock, recent] = await Promise.all([
    dashboardStats(),
    listLowStock(10),
    recentTransactions(10),
  ])

  const cards = [
    { label: '元件种类', value: stats.totalComponents, icon: '🔌' },
    { label: '库存总量', value: stats.totalStock.toLocaleString(), icon: '📦' },
    { label: '库存总值', value: `¥${stats.totalValue.toFixed(2)}`, icon: '💰' },
    { label: '低库存元件', value: stats.lowStockCount, icon: '⚠️', danger: stats.lowStockCount > 0 },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">仪表盘</h1>
        <DashboardQuickActions />
      </div>

      {/* 统计卡 */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {cards.map((c) => (
          <Card key={c.label} className="flex items-center gap-3">
            <span className="text-2xl" aria-hidden>{c.icon}</span>
            <div>
              <div className={`text-2xl font-bold ${c.danger ? 'text-red-600' : ''}`}>{c.value}</div>
              <div className="text-xs text-neutral-500">{c.label}</div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 低库存预警 */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-500">低库存预警</h2>
            <Link href="/components?sort=stock&order=asc" className="text-xs text-blue-600 hover:underline">
              查看全部元件 →
            </Link>
          </div>
          {lowStock.length === 0 ? (
            <p className="text-sm text-neutral-400">库存充足，暂无预警 🎉</p>
          ) : (
            <div className="space-y-2">
              {lowStock.map((row) => (
                <Link
                  key={row.partNumber}
                  href={`/components/${row.partNumber}`}
                  className="flex items-center justify-between rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 text-sm hover:bg-red-50"
                >
                  <span className="min-w-0">
                    <span className="font-medium">{row.name ?? row.partNumber}</span>
                    <span className="ml-2 font-mono text-xs text-neutral-400">{row.partNumber}</span>
                  </span>
                  <span className="shrink-0">
                    <span className="font-semibold text-red-600">{row.stockQuantity}</span>
                    <span className="ml-1 text-xs text-neutral-400">/ 阈值 {row.threshold}</span>
                  </span>
                </Link>
              ))}
            </div>
          )}
        </Card>

        {/* 近期流水 */}
        <Card>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-neutral-500">近期流水</h2>
            <Link href="/transactions" className="text-xs text-blue-600 hover:underline">
              全部流水 →
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="text-sm text-neutral-400">暂无流水记录</p>
          ) : (
            <div className="space-y-1">
              {recent.map((t) => {
                const meta = TYPE_LABELS[t.type]
                const sign = t.type === 'out' ? '-' : t.type === 'in' ? '+' : t.quantity >= 0 ? '+' : ''
                return (
                  <div key={t.id} className="flex items-center gap-2 border-b border-neutral-100 py-1.5 text-sm last:border-0">
                    <Badge color={meta.color}>{meta.label}</Badge>
                    <Link href={`/components/${t.partNumber}`} className="font-mono text-blue-700 hover:underline">
                      {t.partNumber}
                    </Link>
                    <span className={`font-medium ${t.type === 'out' ? 'text-red-600' : t.type === 'in' ? 'text-green-600' : ''}`}>
                      {sign}{t.type === 'adjust' ? Math.abs(t.quantity) : t.quantity}
                    </span>
                    <span className="flex-1 truncate text-xs text-neutral-400">{t.note ?? ''}</span>
                    <span className="text-xs text-neutral-400">
                      <TimeText value={t.createdAt} />
                    </span>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}
