import type { Metadata } from 'next'
import Link from 'next/link'
import { Badge, Button, Card, EmptyState } from '@/components/ui'
import { TransactionFilters } from '@/components/TransactionFilters'
import { TxPagination } from '@/components/TxPagination'
import { listTransactions } from '@/lib/db'

export const metadata: Metadata = { title: '流水记录 · 元件库存管理' }

const TYPE_META: Record<string, { label: string; color: 'green' | 'red' | 'amber' }> = {
  in: { label: '入库', color: 'green' },
  out: { label: '出库', color: 'red' },
  adjust: { label: '盘点', color: 'amber' },
}

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> }

export default async function TransactionsPage({ searchParams }: Props) {
  const sp = await searchParams
  const get = (key: string) => {
    const v = sp[key]
    return typeof v === 'string' ? v : undefined
  }
  const type = get('type')
  const from = get('from')
  const to = get('to')
  const partNumber = get('pn')
  const page = Number(get('page')) || 1

  const data = await listTransactions({
    partNumber,
    type: type === 'in' || type === 'out' || type === 'adjust' ? type : undefined,
    from,
    to,
    page,
    pageSize: 30,
  })

  // CSV 导出参数与当前筛选一致
  const exportParams = new URLSearchParams()
  if (partNumber) exportParams.set('pn', partNumber)
  if (type) exportParams.set('type', type)
  if (from) exportParams.set('from', from)
  if (to) exportParams.set('to', to)
  const exportQs = exportParams.toString()

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">流水记录</h1>
        <a href={`/api/export/transactions${exportQs ? `?${exportQs}` : ''}`}>
          <Button variant="secondary" size="sm">导出 CSV（当前筛选）</Button>
        </a>
      </div>

      <Card>
        <TransactionFilters initial={{ partNumber: partNumber ?? '', type: type ?? '', from: from ?? '', to: to ?? '' }} />
      </Card>

      <Card className="!p-0">
        {data.items.length === 0 ? (
          <EmptyState message="暂无流水记录" />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="px-4 py-2.5">时间</th>
                <th className="px-4 py-2.5">元件</th>
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
                      {new Date(t.createdAt).toLocaleString('zh-CN')}
                    </td>
                    <td className="px-4 py-2">
                      <Link href={`/components/${t.partNumber}`} className="font-mono text-blue-700 hover:underline">
                        {t.partNumber}
                      </Link>
                    </td>
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
        )}
        <div className="p-3">
          <TxPagination totalPages={data.totalPages} />
        </div>
      </Card>
    </div>
  )
}
