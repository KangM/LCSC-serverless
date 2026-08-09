import type { Metadata } from 'next'
import { ReportCharts } from '@/components/ReportCharts'
import { dailyFlow, topOutgoing, valueByCategory, valueByPackage } from '@/lib/cache'

export const metadata: Metadata = { title: '统计报表 · 元件库存管理' }

export default async function ReportsPage() {
  const [byCategory, byPackage, daily, top] = await Promise.all([
    valueByCategory(),
    valueByPackage(),
    dailyFlow(30),
    topOutgoing(10),
  ])

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">统计报表</h1>
      <ReportCharts byCategory={byCategory} byPackage={byPackage} daily={daily} topOutgoing={top} />
    </div>
  )
}
