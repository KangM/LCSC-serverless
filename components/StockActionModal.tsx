'use client'

import { useEffect, useState } from 'react'
import { Button, Input, Label, Modal } from './ui'
import { useToast } from './Toast'

export type StockMode = 'out' | 'adjust'

/**
 * 出库 / 盘点 弹窗。
 * 出库：填数量（不超过当前库存）；盘点：填实点数（自动算差额）。
 */
export function StockActionModal({
  open,
  mode,
  partNumber,
  name,
  currentStock,
  onClose,
  onDone,
}: {
  open: boolean
  mode: StockMode
  partNumber: string
  name?: string | null
  currentStock: number
  onClose: () => void
  onDone: () => void
}) {
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const toast = useToast()

  useEffect(() => {
    if (open) {
      setValue('')
      setNote('')
      setError('')
    }
  }, [open, mode, partNumber])

  const num = Number(value)
  const isOut = mode === 'out'
  const valid = Number.isInteger(num) && num >= (isOut ? 1 : 0) && (!isOut || num <= currentStock)
  const diff = isOut ? -num : num - currentStock

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/components/${encodeURIComponent(partNumber)}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isOut
            ? { action: 'out', quantity: num, note: note || undefined }
            : { action: 'adjust', actualQuantity: num, note: note || undefined },
        ),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '操作失败')
        return
      }
      toast.success(`${isOut ? '出库' : '盘点'}成功：${partNumber} ${isOut ? `-${num}` : `→${num}`}`)
      onDone()
      onClose()
    } catch {
      setError('操作失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal
      open={open}
      title={`${isOut ? '出库' : '盘点'} · ${name ? `${name} ` : ''}${partNumber}`}
      onClose={onClose}
    >
      <div className="space-y-4">
        <div className="rounded-lg bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          当前库存：<span className="font-semibold">{currentStock}</span>
        </div>

        <div>
          <Label>{isOut ? '出库数量' : '实盘数量'}</Label>
          <Input
            type="number"
            min={isOut ? 1 : 0}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={isOut ? '不超过当前库存' : '清点后的实际数量'}
            autoFocus
          />
          {!isOut && num >= 0 && num !== currentStock && (
            <p className="mt-1 text-xs text-neutral-500">
              差额 {diff > 0 ? `+${diff}` : diff}（{diff > 0 ? '盘盈' : '盘亏'}）
            </p>
          )}
        </div>

        <div>
          <Label>备注（可选）</Label>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={isOut ? '如 领用、送修' : '如 月度盘点'} />
        </div>

        {error && <p className="text-xs text-red-600">{error}</p>}
        {isOut && value && !valid && (
          <p className="text-xs text-red-600">数量无效或超出当前库存</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            取消
          </Button>
          <Button variant={isOut ? 'danger' : 'primary'} onClick={submit} disabled={!valid || loading}>
            {loading ? '提交中…' : '确认'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
