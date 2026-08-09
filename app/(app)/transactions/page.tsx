import type { Metadata } from 'next'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { TransactionFilters } from '@/components/TransactionFilters'
import { TimeText } from '@/components/TimeText'
import { TxPagination } from '@/components/TxPagination'
import { TxPartNumberCell } from '@/components/TxPartNumberCell'
import { listTransactions } from '@/lib/cache'

export const metadata: Metadata = { title: '流水记录 · 元件库存管理' }

const TYPE_META: Record<string, { label: string; color: 'green' | 'red' | 'amber' }> = {
  in: { label: '入库', color: 'green' },
  out: { label: '出库', color: 'red' },
  adjust: { label: '盘点', color: 'amber' },
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

/** 本地时区的 YYYY-MM-DD（避免 toISOString 的 UTC 偏移差一天） */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default async function TransactionsPage({ searchParams }: Props) {
  const sp = await searchParams
  const get = (key: string) => {
    const v = sp[key]
    return typeof v === 'string' ? v : undefined
  }
  const type = get('type')
  // 日期默认最近一个月
  const now = new Date()
  const monthAgo = new Date(now)
  monthAgo.setDate(now.getDate() - 30)
  const defaultFrom = fmtDate(monthAgo)
  const defaultTo = fmtDate(now)
  const from = get('from') ?? defaultFrom
  const to = get('to') ?? defaultTo
  const partNumber = get('pn')
  const page = Number(get('page')) || 1

  // 本地日期 → UTC ISO 边界（与 TransactionFilters 提交一致；已是 ISO 则保留）
  const toIso = (s: string, endOfDay: boolean) =>
    s.includes('T') ? s : endOfDay
      ? new Date(`${s}T23:59:59.999`).toISOString()
      : new Date(`${s}T00:00:00`).toISOString()
  const fromIso = toIso(from, false)
  const toIsoValue = toIso(to, true)

  const t0 = performance.now()
  const data = await listTransactions({
    partNumber,
    type: type === 'in' || type === 'out' || type === 'adjust' ? type : undefined,
    from: fromIso,
    to: toIsoValue,
    page,
    pageSize: 30,
  })
  const dbMs = (performance.now() - t0).toFixed(1)
  console.log(`[perf] page /transactions data ${dbMs}ms total=${data.total} page=${page}`)

  // CSV 导出参数与当前筛选一致（含默认日期范围，ISO 边界）
  const exportParams = new URLSearchParams()
  if (partNumber) exportParams.set('pn', partNumber)
  if (type) exportParams.set('type', type)
  exportParams.set('from', fromIso)
  exportParams.set('to', toIsoValue)
  const exportQs = exportParams.toString()

  return (
    <>
      {/* 诊断用：DB 数据阶段耗时（浏览器 Network → 响应体可看），部署排查后删除 */}
      <meta name="x-perf-page" content={`db=${dbMs}ms total=${data.total}`} />
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold">流水记录</h1>
        <a href={`/api/export/transactions${exportQs ? `?${exportQs}` : ''}`}>
          <Button variant="secondary" size="sm">导出 CSV（当前筛选）</Button>
        </a>
      </div>

      <Card>
        <TransactionFilters initial={{ partNumber: partNumber ?? '', type: type ?? '', from, to }} />
      </Card>

      <Card className="!p-0">
        {data.items.length === 0 ? (
          <EmptyState message="暂无流水记录" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-4 py-2.5">时间</th>
                <th className="px-4 py-2.5">元件</th>
                <th className="px-4 py-2.5">名称</th>
                <th className="px-4 py-2.5">类型</th>
                <th className="px-4 py-2.5 text-right">数量</th>
                <th className="px-4 py-2.5 text-right">库存变化</th>
                <th className="px-4 py-2.5">备注</th>
                <th className="px-4 py-2.5">操作人</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((t) => {
                const meta = TYPE_META[t.type]
                const sign = t.type === 'out' ? '-' : t.type === 'in' ? '+' : t.quantity >= 0 ? '+' : ''
                return (
                  <tr key={t.id} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-4 py-2 text-neutral-500">
                      <TimeText value={t.createdAt} />
                    </td>
                    <td className="px-4 py-2">
                      <TxPartNumberCell partNumber={t.partNumber} />
                    </td>
                    <td className="px-4 py-2 text-neutral-700">{t.name ?? ''}</td>
                    <td className="px-4 py-2"><Badge color={meta.color}>{meta.label}</Badge></td>
                    <td className={`px-4 py-2 text-right font-medium ${t.type === 'out' ? 'text-red-600' : t.type === 'in' ? 'text-green-600' : ''}`}>
                      {sign}{t.type === 'adjust' ? Math.abs(t.quantity) : t.quantity}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-500">
                      {t.beforeQty} → {t.afterQty}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{t.note ?? ''}</td>
                    <td className="px-4 py-2 text-neutral-500">{t.operator ?? ''}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          </div>
        )}
        <div className="p-3">
          <TxPagination totalPages={data.totalPages} />
        </div>
      </Card>
      </div>
    </>
  )
}
