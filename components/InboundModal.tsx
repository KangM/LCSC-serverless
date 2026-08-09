'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, Modal, Badge } from './ui'
import { QrScanModal } from './QrScanModal'
import { OcrModal } from './OcrModal'
import { parseLcscQrCode } from '@/lib/qr'
import type { ComponentDetail } from '@/lib/lcsc'

type Step = 'input' | 'confirm'
type QueryMode = 'lookup' | 'search'

export function InboundModal({
  open,
  initialPartNumber,
  onClose,
  onDone,
}: {
  open: boolean
  initialPartNumber?: string
  onClose: () => void
  onDone: (partNumber: string) => void
}) {
  const [step, setStep] = useState<Step>('input')
  const [queryMode, setQueryMode] = useState<QueryMode>('lookup')
  const [keyword, setKeyword] = useState(initialPartNumber ?? '')
  const [detail, setDetail] = useState<ComponentDetail | null>(null)
  const [candidates, setCandidates] = useState<ComponentDetail[] | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [ocrOpen, setOcrOpen] = useState(false)

  const reset = useCallback(() => {
    setStep('input')
    setQueryMode('lookup')
    setKeyword(initialPartNumber ?? '')
    setDetail(null)
    setCandidates(null)
    setQuantity(1)
    setNote('')
    setError('')
    setQrOpen(false)
    setOcrOpen(false)
  }, [initialPartNumber])

  // 打开弹窗且带初始编号（列表页行内入库 / OCR 选元件）时自动查询详情
  useEffect(() => {
    if (open && initialPartNumber) {
      setKeyword(initialPartNumber)
      void lookup(initialPartNumber)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPartNumber])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  async function lookup(pn: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/lcsc/lookup?pn=${encodeURIComponent(pn)}`)
      const data = await res.json()
      if (!res.ok || !data.item) {
        setError(data.error || '未找到该元件')
        setStep('input')
        return
      }
      setDetail(data.item)
      setStep('confirm')
    } catch {
      setError('查询失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  async function search(k: string) {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/lcsc/search?k=${encodeURIComponent(k)}&page=1`)
      const data = await res.json()
      if (!res.ok || !data.items?.length) {
        setError(data.error || '没有匹配结果')
        setCandidates([])
        return
      }
      setCandidates(data.items)
    } catch {
      setError('搜索失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }

  async function submit() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/components', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          partNumber: detail!.partNumber,
          quantity,
          note: note || undefined,
          detail,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '入库失败')
        return
      }
      onDone(data.item.partNumber)
      onClose()
    } catch {
      setError('入库失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  const pickCandidate = (item: ComponentDetail) => {
    setDetail(item)
    setCandidates(null)
    setStep('confirm')
  }

  /** 扫码结果 → 解析 → 编号查详情（预填数量）/ 仅 MPN 则关键词搜索 */
  const handleQrDecoded = useCallback((text: string) => {
    setQrOpen(false)
    const parsed = parseLcscQrCode(text)
    if (!parsed) {
      setError(`无法识别该二维码内容：${text.slice(0, 60)}`)
      return
    }
    setError('')
    setQueryMode('lookup')
    if (parsed.partNumber) {
      if (parsed.qty) setQuantity(parsed.qty)
      setKeyword(parsed.partNumber)
      void lookup(parsed.partNumber)
    } else if (parsed.mpn) {
      setKeyword(parsed.mpn)
      void search(parsed.mpn)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal open={open} title="元件入库" onClose={onClose}>
      {step === 'input' && (
        <div className="space-y-4">
          <div>
            <Label>立创编号 / 厂商型号（MPN）</Label>
            <div className="flex gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && lookup(keyword)}
                placeholder="如 C14663 或 GRM188R71C104KA01D"
                autoFocus
              />
              <Button onClick={() => lookup(keyword)} disabled={loading || !keyword.trim()}>
                {loading ? '查询中…' : '查询'}
              </Button>
              <Button variant="secondary" onClick={() => setQrOpen(true)} title="扫描立创二维码">
                扫码
              </Button>
            </div>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>

          <div className="flex items-center gap-2 text-xs text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200" />
            或按关键词搜索
            <span className="h-px flex-1 bg-neutral-200" />
          </div>

          <div>
            <Label>关键词搜索（立创）</Label>
            <div className="flex gap-2">
              <Input
                value={queryMode === 'search' ? keyword : ''}
                placeholder="输入关键词后点搜索，如 0402 电容"
                onChange={(e) => {
                  setQueryMode('search')
                  setKeyword(e.target.value)
                }}
                onKeyDown={(e) => e.key === 'Enter' && search(keyword)}
              />
              <Button variant="secondary" onClick={() => search(keyword)} disabled={loading || !keyword.trim()}>
                搜索
              </Button>
              <Button variant="secondary" onClick={() => setOcrOpen(true)} title="拍照识别元件丝印/标签">
                拍照识别
              </Button>
            </div>
          </div>

          {candidates && (
            <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-neutral-200">
              {candidates.length === 0 ? (
                <p className="p-3 text-sm text-neutral-400">无匹配结果</p>
              ) : (
                candidates.map((c) => (
                  <button
                    key={c.partNumber}
                    onClick={() => pickCandidate(c)}
                    className="flex w-full items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2 text-left text-sm last:border-0 hover:bg-blue-50"
                  >
                    <span className="min-w-0">
                      <span className="font-mono text-xs text-blue-600">{c.partNumber}</span>
                      <span className="ml-2 truncate">{c.name}</span>
                    </span>
                    <span className="shrink-0 text-xs text-neutral-400">
                      {c.brand} · {c.packageName} · ¥{c.price ?? '-'}
                    </span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {step === 'confirm' && detail && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-neutral-200 p-3">
            {detail.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.imageUrl}
                alt={detail.partNumber}
                className="h-16 w-16 shrink-0 rounded object-contain"
                referrerPolicy="no-referrer"
              />
            )}
            <div className="min-w-0 text-sm">
              <div className="font-medium">{detail.name ?? '未知元件'}</div>
              <div className="mt-0.5 font-mono text-xs text-neutral-500">
                {detail.partNumber} {detail.mpn ? `· ${detail.mpn}` : ''}
              </div>
              <div className="mt-1 flex flex-wrap gap-1">
                {detail.brand && <Badge>{detail.brand}</Badge>}
                {detail.packageName && <Badge color="blue">{detail.packageName}</Badge>}
                {detail.category && <Badge color="amber">{detail.category}</Badge>}
              </div>
              <div className="mt-1 text-xs text-neutral-500">
                ¥{detail.price ?? '-'} / 个
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>入库数量</Label>
              <Input
                type="number"
                min={1}
                value={quantity}
                onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
              />
            </div>
            <div>
              <Label>备注（可选）</Label>
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="如 新购、到货" />
            </div>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep('input')}>
              返回
            </Button>
            <Button onClick={submit} disabled={loading}>
              {loading ? '提交中…' : '确认入库'}
            </Button>
          </div>
        </div>
      )}

      <QrScanModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onDecoded={handleQrDecoded}
      />
      <OcrModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onPicked={(pn) => {
          setOcrOpen(false)
          setKeyword(pn)
          void lookup(pn)
        }}
      />
    </Modal>
  )
}
