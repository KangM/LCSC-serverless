'use client'

import { useEffect, useState } from 'react'
import { Badge, Button, Card, Input, Modal } from './ui'
import { TimeText } from './TimeText'
import { InboundModal } from './InboundModal'
import { StockActionModal, type StockMode } from './StockActionModal'
import { useToast } from './Toast'
import type { ComponentRow, TransactionRow } from '@/lib/db'

const TYPE_META: Record<string, { label: string; color: 'green' | 'red' | 'amber' }> = {
  in: { label: '入库', color: 'green' },
  out: { label: '出库', color: 'red' },
  adjust: { label: '盘点', color: 'amber' },
}

/**
 * 元件详情弹窗（列表/流水页点元件名打开，不再跳转页面）。
 * 数据通过 API 实时获取，操作（入库/出库/盘点/刷新/阈值）完成后重新加载。
 */
export function ComponentDetailModal({
  open,
  partNumber,
  onClose,
  onChanged,
  onDeleted,
}: {
  open: boolean
  partNumber: string
  onClose: () => void
  onChanged?: () => void
  onDeleted?: (partNumber: string) => void
}) {
  const toast = useToast()
  const [row, setRow] = useState<ComponentRow | null>(null)
  const [txs, setTxs] = useState<TransactionRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  // 弹窗操作状态
  const [inboundOpen, setInboundOpen] = useState(false)
  const [stockTarget, setStockTarget] = useState<{ mode: StockMode } | null>(null)
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [thresholdValue, setThresholdValue] = useState('0')
  const [refreshing, setRefreshing] = useState(false)
  const [deleting, setDeleting] = useState(false)

  async function load() {
    setLoading(true)
    setError('')
    try {
      const [detailRes, txRes] = await Promise.all([
        fetch(`/api/components/${encodeURIComponent(partNumber)}`, { signal: AbortSignal.timeout(15_000) }),
        fetch(`/api/components/${encodeURIComponent(partNumber)}/transactions`, { signal: AbortSignal.timeout(15_000) }),
      ])
      const detail = await detailRes.json()
      const tx = await txRes.json()
      if (!detailRes.ok || !detail.item) {
        setError(detail.error || '元件不存在')
        setRow(null)
        return
      }
      setRow(detail.item)
      setThresholdValue(String(detail.item.threshold ?? 0))
      setTxs(tx.items ?? [])
    } catch {
      setError('加载失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && partNumber) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, partNumber])

  async function saveThreshold() {
    const t = Number(thresholdValue)
    if (!Number.isFinite(t) || t < 0) return
    const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'threshold', threshold: t }),
    })
    if (!res.ok) {
      toast.error('阈值保存失败')
      return
    }
    toast.success('阈值已更新')
    setEditingThreshold(false)
    void load()
    onChanged?.()
  }

  async function refreshFromLcsc() {
    setRefreshing(true)
    try {
      const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || '刷新失败')
        return
      }
      toast.success('已从立创刷新元件信息')
      void load()
      onChanged?.()
    } catch {
      toast.error('刷新失败，请重试')
    } finally {
      setRefreshing(false)
    }
  }

  async function deleteAndReinbound() {
    if (!window.confirm(`将隐藏 ${partNumber}、库存归零并释放其位号。历史流水会保留，重新入库即可恢复。`)) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error || '删除失败')
        return
      }
      toast.success('已标记删除并释放位号，请重新入库')
      onDeleted?.(partNumber)
      onChanged?.()
      onClose()
    } catch {
      toast.error('删除失败，请重试')
    } finally {
      setDeleting(false)
    }
  }

  const done = () => {
    void load()
    onChanged?.()
  }

  const low = row ? row.threshold > 0 && row.stockQuantity <= row.threshold : false
  const specs = row ? Object.entries(row.specifications) : []

  return (
    <Modal open={open} title={row ? (row.name ?? row.partNumber) : partNumber} onClose={onClose} wide>
      {loading && !row && <p className="py-8 text-center text-sm text-neutral-400">加载中…</p>}
      {error && !row && <p className="py-8 text-center text-sm text-red-600">{error}</p>}

      {row && (
        <div className="space-y-4">
          {/* 信息卡 */}
          <div className="flex items-start gap-4">
            {row.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={row.imageUrl}
                alt={row.partNumber}
                className="h-32 w-32 shrink-0 rounded-lg border border-neutral-200 bg-white object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-32 w-32 shrink-0 rounded-lg border border-neutral-200 bg-white" />
            )}
            <div className="min-w-0 flex-1">
              <h2 className="text-lg font-semibold">{row.name ?? row.partNumber}</h2>
              <div className="mt-0.5 font-mono text-sm text-neutral-500">
                {row.partNumber}
                {row.mpn ? ` · ${row.mpn}` : ''}
              </div>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {row.brand && <Badge>{row.brand}</Badge>}
                {row.packageName && <Badge color="blue">{row.packageName}</Badge>}
                {row.category && <Badge color="amber">{row.category}</Badge>}
              </div>
              <div className="mt-2 flex gap-4 text-sm text-neutral-600">
                {row.price != null && <span>立创价格 ¥{row.price}</span>}
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
              {row.description && <p className="mt-1.5 text-sm text-neutral-500">{row.description}</p>}
            </div>
          </div>

          {/* 库存 + 操作 */}
          <Card>
            <div className="flex flex-wrap items-center gap-3">
              <span className={`text-2xl font-bold ${low ? 'text-red-600' : ''}`}>{row.stockQuantity}</span>
              <span className="text-sm text-neutral-400">件</span>
              {low && <Badge color="red">低于阈值</Badge>}

              <div className="ml-auto flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setInboundOpen(true)}>入库</Button>
                <Button size="sm" variant="secondary" onClick={() => setStockTarget({ mode: 'out' })}>出库</Button>
                <Button size="sm" variant="secondary" onClick={() => setStockTarget({ mode: 'adjust' })}>盘点</Button>
                <Button size="sm" variant="secondary" onClick={refreshFromLcsc} disabled={refreshing}>
                  {refreshing ? '刷新中…' : '刷新立创信息'}
                </Button>
                {onDeleted && (
                  <Button size="sm" variant="danger" onClick={deleteAndReinbound} disabled={deleting}>
                    {deleting ? '删除中…' : '删除并重新入库'}
                  </Button>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-sm text-neutral-600">
              <span>低库存阈值：</span>
              {editingThreshold ? (
                <>
                  <Input
                    type="number"
                    min={0}
                    value={thresholdValue}
                    onChange={(e) => setThresholdValue(e.target.value)}
                    className="w-24 !py-1"
                    autoFocus
                  />
                  <Button size="sm" onClick={saveThreshold}>保存</Button>
                  <Button size="sm" variant="secondary" onClick={() => setEditingThreshold(false)}>取消</Button>
                </>
              ) : (
                <>
                  <span className="font-medium">{row.threshold}</span>
                  <Button size="sm" variant="ghost" onClick={() => setEditingThreshold(true)}>修改</Button>
                </>
              )}
            </div>
            {row.lastFetchedAt && (
              <p className="mt-2 text-xs text-neutral-400">
                最近从立创更新：<TimeText value={row.lastFetchedAt} />
              </p>
            )}
          </Card>

          {/* 规格参数 */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-500">规格参数</h3>
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
          </div>

          {/* 流水 */}
          <div>
            <h3 className="mb-2 text-sm font-semibold text-neutral-500">出入库记录</h3>
            {txs.length === 0 ? (
              <p className="text-sm text-neutral-400">暂无记录</p>
            ) : (
              <div className="max-h-56 overflow-y-auto">
                {txs.map((t) => {
                  const meta = TYPE_META[t.type]
                  const sign = t.type === 'out' ? '-' : t.type === 'in' ? '+' : t.quantity >= 0 ? '+' : ''
                  return (
                    <div key={t.id} className="flex items-center gap-3 border-b border-neutral-100 py-1.5 text-sm last:border-0">
                      <Badge color={meta.color}>{meta.label}</Badge>
                      <span className="w-16 text-right font-medium">
                        {sign}{t.type === 'adjust' ? Math.abs(t.quantity) : t.quantity}
                      </span>
                      <span className="flex-1 truncate text-neutral-500">{t.note ?? ''}</span>
                      {t.referenceDesignator && <span className="text-xs text-neutral-500">位号 {t.referenceDesignator}</span>}
                      {t.purchasePrice != null && <span className="text-xs text-neutral-500">入手 ¥{t.purchasePrice}</span>}
                      <span className="text-xs text-neutral-400">{t.beforeQty} → {t.afterQty}</span>
                      <span className="w-36 shrink-0 text-right text-xs text-neutral-400">
                        <TimeText value={t.createdAt} />
                      </span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 内嵌操作弹窗 */}
          <InboundModal
            open={inboundOpen}
            initialPartNumber={partNumber}
            onClose={() => setInboundOpen(false)}
            onDone={done}
          />
          {stockTarget && (
            <StockActionModal
              open
              mode={stockTarget.mode}
              partNumber={row.partNumber}
              name={row.name}
              currentStock={row.stockQuantity}
              onClose={() => setStockTarget(null)}
              onDone={done}
            />
          )}
        </div>
      )}
    </Modal>
  )
}
