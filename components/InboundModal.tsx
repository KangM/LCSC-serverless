'use client'

import { useCallback, useEffect, useState } from 'react'
import { Button, Input, Label, Modal, Badge } from './ui'
import { QrScanModal } from './QrScanModal'
import { OcrModal } from './OcrModal'
import { SearchResultsModal } from './SearchResultsModal'
import { parseLcscQrCode } from '@/lib/qr'
import { useToast } from './Toast'
import type { ComponentDetail } from '@/lib/lcsc'

/**
 * 元件入库弹窗。
 * 一个输入框智能判断：C 编号 → 精确查询立创；其他关键词 → 打开独立搜索结果窗口（无限滚动）。
 * 另有扫码（立创料盘二维码）与拍照识别（OCR）两条通道。
 */
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
  const [step, setStep] = useState<'input' | 'confirm'>('input')
  const [keyword, setKeyword] = useState(initialPartNumber ?? '')
  const [detail, setDetail] = useState<ComponentDetail | null>(null)
  const [quantity, setQuantity] = useState(1)
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [qrOpen, setQrOpen] = useState(false)
  const [ocrOpen, setOcrOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const toast = useToast()

  const reset = useCallback(() => {
    setStep('input')
    setKeyword(initialPartNumber ?? '')
    setDetail(null)
    setQuantity(1)
    setNote('')
    setError('')
    setQrOpen(false)
    setOcrOpen(false)
    setSearchOpen(false)
  }, [initialPartNumber])

  useEffect(() => {
    if (open) reset()
  }, [open, reset])

  // 打开弹窗且带初始编号（列表页行内入库 / OCR / 扫码选中）时自动查询详情
  useEffect(() => {
    if (open && initialPartNumber) {
      setKeyword(initialPartNumber)
      void lookup(initialPartNumber)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialPartNumber])

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

  /** 单输入框智能判断：C 编号 → 精确查询；其他 → 打开搜索结果窗口 */
  function submitKeyword() {
    const kw = keyword.trim()
    if (!kw) return
    setError('')
    if (/^C\d+$/i.test(kw)) {
      void lookup(kw)
    } else {
      setSearchOpen(true)
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
      toast.success(`入库成功：${data.item.partNumber} +${quantity}`)
      onDone(data.item.partNumber)
      onClose()
    } catch {
      setError('入库失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  /** 扫码结果 → 解析 → 编号查详情（预填数量）/ 仅 MPN 则打开搜索窗口 */
  const handleQrDecoded = useCallback((text: string) => {
    setQrOpen(false)
    const parsed = parseLcscQrCode(text)
    if (!parsed) {
      setError(`无法识别该二维码内容：${text.slice(0, 60)}`)
      return
    }
    setError('')
    if (parsed.partNumber) {
      if (parsed.qty) setQuantity(parsed.qty)
      setKeyword(parsed.partNumber)
      void lookup(parsed.partNumber)
    } else if (parsed.mpn) {
      setKeyword(parsed.mpn)
      setSearchOpen(true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <Modal open={open} title="元件入库" onClose={onClose}>
      {step === 'input' && (
        <div className="space-y-4">
          <div>
            <Label>立创编号 / 型号 / 关键词</Label>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitKeyword()}
                placeholder="C 编号精确查；其他自动搜索立创"
                autoFocus
                className="min-w-0 flex-1"
              />
              {/* 按钮组：查询 / 扫码 / 拍照识别 */}
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-neutral-300 bg-white">
                <button
                  onClick={submitKeyword}
                  disabled={loading || !keyword.trim()}
                  className="bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {loading ? '查询中…' : '查询'}
                </button>
                <button
                  onClick={() => setQrOpen(true)}
                  title="扫描立创料盘二维码"
                  className="border-l border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
                >
                  📷 扫码
                </button>
                <button
                  onClick={() => setOcrOpen(true)}
                  title="拍照识别元件丝印/标签"
                  className="border-l border-neutral-300 px-3 py-2 text-sm text-neutral-700 transition hover:bg-neutral-50"
                >
                  🤖 拍照识别
                </button>
              </div>
            </div>
            <p className="mt-2 text-xs text-neutral-400">
              输入 C 开头编号（如 C14663）直接查详情；输入型号或关键词打开搜索结果窗口
            </p>
            {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
          </div>
        </div>
      )}

      {step === 'confirm' && detail && (
        <div className="space-y-4">
          <div className="flex gap-3 rounded-lg border border-neutral-200 p-3">
            {detail.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={detail.imageUrl}
                alt={detail.partNumber}
                className="h-16 w-16 shrink-0 rounded object-contain"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="h-16 w-16 shrink-0 rounded bg-neutral-100" />
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

      {/* 独立搜索结果窗口（无限滚动） */}
      <SearchResultsModal
        open={searchOpen}
        keyword={keyword}
        onClose={() => setSearchOpen(false)}
        onPicked={(pn) => {
          setSearchOpen(false)
          setKeyword(pn)
          void lookup(pn)
        }}
      />
      <QrScanModal
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        onDecoded={handleQrDecoded}
      />
      <OcrModal
        open={ocrOpen}
        onClose={() => setOcrOpen(false)}
        onSearch={(keywords) => {
          // 识别选词后：关闭 OCR，用选中的关键词打开立创搜索结果窗口
          const joined = keywords.join(' ')
          setOcrOpen(false)
          setKeyword(joined)
          setSearchOpen(true)
        }}
      />
    </Modal>
  )
}
