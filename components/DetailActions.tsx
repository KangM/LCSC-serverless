'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button, Input } from './ui'
import { InboundModal } from './InboundModal'
import { StockActionModal, type StockMode } from './StockActionModal'
import { useToast } from './Toast'

export function DetailActions({
  partNumber,
  name,
  stock,
  threshold,
}: {
  partNumber: string
  name?: string | null
  stock: number
  threshold: number
}) {
  const router = useRouter()
  const toast = useToast()
  const [inboundOpen, setInboundOpen] = useState(false)
  const [stockTarget, setStockTarget] = useState<{ mode: StockMode } | null>(null)
  const [editingThreshold, setEditingThreshold] = useState(false)
  const [thresholdValue, setThresholdValue] = useState(String(threshold))
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')

  const refresh = () => router.refresh()

  async function saveThreshold() {
    const t = Number(thresholdValue)
    if (!Number.isFinite(t) || t < 0) return
    const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'threshold', threshold: t }),
    })
    if (res.ok) {
      setEditingThreshold(false)
      refresh()
    }
  }

  async function refreshFromLcsc() {
    setRefreshing(true)
    setMessage('')
    try {
      const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'refresh' }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage(data.error || '刷新失败')
        toast.error(data.error || '刷新失败')
      } else {
        setMessage('已从立创刷新元件信息')
        toast.success('已从立创刷新元件信息')
        refresh()
      }
    } catch {
      setMessage('刷新失败，请重试')
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setInboundOpen(true)}>入库</Button>
        <Button variant="secondary" onClick={() => setStockTarget({ mode: 'out' })}>出库</Button>
        <Button variant="secondary" onClick={() => setStockTarget({ mode: 'adjust' })}>盘点</Button>
        <Button variant="secondary" onClick={refreshFromLcsc} disabled={refreshing}>
          {refreshing ? '刷新中…' : '刷新立创信息'}
        </Button>
      </div>

      <div className="flex items-center gap-2 text-sm text-neutral-600">
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
            <span className="font-medium">{threshold}</span>
            <Button size="sm" variant="ghost" onClick={() => setEditingThreshold(true)}>修改</Button>
          </>
        )}
      </div>

      {message && <p className="text-xs text-neutral-500">{message}</p>}

      <InboundModal
        open={inboundOpen}
        initialPartNumber={partNumber}
        onClose={() => setInboundOpen(false)}
        onDone={refresh}
      />
      {stockTarget && (
        <StockActionModal
          open
          mode={stockTarget.mode}
          partNumber={partNumber}
          name={name}
          currentStock={stock}
          onClose={() => setStockTarget(null)}
          onDone={refresh}
        />
      )}
    </div>
  )
}
