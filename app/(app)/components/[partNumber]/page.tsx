import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { Badge, Card } from '@/components/ui'
import { DetailActions } from '@/components/DetailActions'
import { TimeText } from '@/components/TimeText'
import { getComponent, listTransactions } from '@/lib/cache'

export const metadata: Metadata = { title: '元件详情 · 元件库存管理' }

const TYPE_LABELS: Record<string, { label: string; color: 'green' | 'red' | 'amber' }> = {
  in: { label: '入库', color: 'green' },
  out: { label: '出库', color: 'red' },
  adjust: { label: '盘点', color: 'amber' },
}

type Props = { params: Promise<{ partNumber: string }> }

export default async function ComponentDetailPage({ params }: Props) {
  const { partNumber } = await params
  const [row, txs] = await Promise.all([
    getComponent(partNumber),
    listTransactions({ partNumber, pageSize: 50 }),
  ])
  if (!row) notFound()

  const low = row.threshold > 0 && row.stockQuantity <= row.threshold
  const specs = Object.entries(row.specifications)

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        {row.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={row.imageUrl}
            alt={row.partNumber}
            className="h-24 w-24 rounded-lg border border-neutral-200 bg-white object-contain"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="h-24 w-24 rounded-lg border border-neutral-200 bg-white" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold">{row.name ?? row.partNumber}</h1>
          <div className="mt-1 font-mono text-sm text-neutral-500">
            {row.partNumber}
            {row.mpn ? ` · ${row.mpn}` : ''}
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {row.brand && <Badge>{row.brand}</Badge>}
            {row.packageName && <Badge color="blue">{row.packageName}</Badge>}
            {row.category && <Badge color="amber">{row.category}</Badge>}
          </div>
          <div className="mt-2 flex gap-4 text-sm text-neutral-600">
            {row.price != null && <span>价格 ¥{row.price}</span>}
            {row.productUrl && (
              <a href={row.productUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                立创商品页 ↗
              </a>
            )}
            {row.datasheetUrl && (
              <a href={row.datasheetUrl} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                数据手册 ↗
              </a>
            )}
          </div>
          {row.description && (
            <p className="mt-2 text-sm text-neutral-500">{row.description}</p>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* 库存卡 */}
        <Card className="lg:col-span-1">
          <h2 className="mb-2 text-sm font-semibold text-neutral-500">库存状态</h2>
          <div className="flex items-baseline gap-2">
            <span className={`text-3xl font-bold ${low ? 'text-red-600' : ''}`}>{row.stockQuantity}</span>
            <span className="text-sm text-neutral-400">件</span>
            {low && <Badge color="red">低于阈值</Badge>}
          </div>
          <div className="mt-4">
            <DetailActions
              partNumber={row.partNumber}
              name={row.name}
              stock={row.stockQuantity}
              threshold={row.threshold}
            />
          </div>
          <p className="mt-3 text-xs text-neutral-400">
            最近从立创更新：{row.lastFetchedAt ? <TimeText value={row.lastFetchedAt} /> : '从未'}
          </p>
        </Card>

        {/* 规格参数 */}
        <Card className="lg:col-span-2">
          <h2 className="mb-3 text-sm font-semibold text-neutral-500">规格参数</h2>
          {specs.length === 0 ? (
            <p className="text-sm text-neutral-400">暂无规格数据</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {specs.map(([k, v]) => (
                  <tr key={k} className="border-b border-neutral-100 last:border-0">
                    <td className="w-1/3 py-1.5 pr-2 text-neutral-500">{k}</td>
                    <td className="py-1.5">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      {/* 流水时间线 */}
      <Card>
        <h2 className="mb-3 text-sm font-semibold text-neutral-500">出入库记录</h2>
        {txs.items.length === 0 ? (
          <p className="text-sm text-neutral-400">暂无记录</p>
        ) : (
          <div className="space-y-0">
            {txs.items.map((t) => {
              const meta = TYPE_LABELS[t.type]
              const sign = t.type === 'out' ? '-' : t.type === 'in' ? '+' : t.quantity >= 0 ? '+' : ''
              return (
                <div key={t.id} className="flex items-center gap-3 border-b border-neutral-100 py-2 text-sm last:border-0">
                  <Badge color={meta.color}>{meta.label}</Badge>
                  <span className="w-16 text-right font-medium">
                    {sign}{t.type === 'adjust' ? Math.abs(t.quantity) : t.quantity}
                  </span>
                  <span className="flex-1 text-neutral-500">
                    {t.note ?? ''}
                  </span>
                  <span className="text-xs text-neutral-400">
                    {t.beforeQty} → {t.afterQty}
                  </span>
                  <span className="w-36 text-right text-xs text-neutral-400">
                    <TimeText value={t.createdAt} />
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
