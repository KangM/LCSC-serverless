'use client'

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { Card } from './ui'

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b']

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-neutral-500">{title}</h2>
      <div className="h-72">{children}</div>
    </Card>
  )
}

export function ReportCharts({
  byCategory,
  byPackage,
  daily,
  topOutgoing,
}: {
  byCategory: Array<{ category: string; value: number }>
  byPackage: Array<{ packageName: string; value: number }>
  daily: Array<{ day: string; inQty: number; outQty: number }>
  topOutgoing: Array<{ partNumber: string; name: string | null; qty: number }>
}) {
  const topData = topOutgoing.map((t) => ({ name: t.name ?? t.partNumber, 出库数量: t.qty }))
  const dailyData = daily.map((d) => ({
    day: d.day.slice(5),
    入库: d.inQty,
    出库: d.outQty,
  }))

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="库存价值 · 按分类">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={byCategory} dataKey="value" nameKey="category" innerRadius={45} outerRadius={90}
              label={(e: { percent?: number; category?: string }) =>
                (e.percent ?? 0) > 0.05 ? `${e.category} ${((e.percent ?? 0) * 100).toFixed(0)}%` : ''}>
              {byCategory.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `¥${Number(v).toFixed(2)}`} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="库存价值 · 按封装">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={byPackage} dataKey="value" nameKey="packageName" innerRadius={45} outerRadius={90}
              label={(e: { percent?: number; packageName?: string }) =>
                (e.percent ?? 0) > 0.05 ? `${e.packageName} ${((e.percent ?? 0) * 100).toFixed(0)}%` : ''}>
              {byPackage.map((_, i) => (
                <Cell key={i} fill={COLORS[(i + 3) % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip formatter={(v) => `¥${Number(v).toFixed(2)}`} />
            <Legend />
          </PieChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="近 30 天出入库趋势">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={dailyData} margin={{ top: 8, right: 16, left: -12, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="day" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="入库" stroke="#10b981" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="出库" stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="热门出库 TOP 10">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={topData} margin={{ top: 8, right: 16, left: -12, bottom: 40 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-30} textAnchor="end" height={60} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="出库数量" fill="#3b82f6" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>
    </div>
  )
}
