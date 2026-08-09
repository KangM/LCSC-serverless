'use client'

import { useRef, useState } from 'react'
import { Button, Modal } from './ui'
import type { ComponentDetail } from '@/lib/lcsc'

interface OcrLine {
  text: string
  score: number
}

/**
 * 拍照 OCR 入库弹窗：
 * 拍照/上传 → 服务端识别 → 展示可编辑文本行（勾选关键词）→ 搜索立创 → 选元件 → onPicked(partNumber)
 */
export function OcrModal({
  open,
  onClose,
  onPicked,
}: {
  open: boolean
  onClose: () => void
  onPicked: (partNumber: string) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState('')
  const [lines, setLines] = useState<OcrLine[]>([])
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<Record<number, string>>({})
  const [recognizing, setRecognizing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ComponentDetail[] | null>(null)
  const [error, setError] = useState('')

  function reset() {
    setPreview('')
    setLines([])
    setChecked(new Set())
    setEditing({})
    setCandidates(null)
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function recognize(file: File) {
    setRecognizing(true)
    setError('')
    setCandidates(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
      setPreview(dataUrl)

      const res = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '识别失败')
        setLines([])
        return
      }
      setLines(data.lines ?? [])
      setChecked(new Set((data.lines ?? []).map((_: unknown, i: number) => i)))
      setEditing(Object.fromEntries((data.lines ?? []).map((l: OcrLine, i: number) => [i, l.text])))
    } catch {
      setError('识别失败，请重试')
    } finally {
      setRecognizing(false)
    }
  }

  async function searchLcsc() {
    const keywords = [...checked].map((i) => (editing[i] ?? lines[i]?.text ?? '').trim()).filter(Boolean)
    if (!keywords.length) {
      setError('请至少勾选一个关键词')
      return
    }
    setSearching(true)
    setError('')
    try {
      const seen = new Map<string, ComponentDetail>()
      for (const kw of keywords.slice(0, 5)) {
        const res = await fetch(`/api/lcsc/search?k=${encodeURIComponent(kw)}&page=1`)
        if (!res.ok) continue
        const data = await res.json()
        for (const item of data.items ?? []) {
          if (!seen.has(item.partNumber)) seen.set(item.partNumber, item)
        }
      }
      if (seen.size === 0) {
        setError('没有在立创找到匹配元件，请换关键词试试')
        setCandidates([])
        return
      }
      setCandidates([...seen.values()].slice(0, 20))
    } catch {
      setError('搜索失败，请重试')
    } finally {
      setSearching(false)
    }
  }

  function toggle(i: number) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(i)) next.delete(i)
      else next.add(i)
      return next
    })
  }

  return (
    <Modal open={open} title="拍照识别入库" onClose={() => { reset(); onClose() }}>
      <div className="space-y-4">
        {/* 拍照/上传 */}
        <div className="flex items-center justify-center gap-3 rounded-lg border-2 border-dashed border-neutral-300 p-4">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && recognize(e.target.files[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={recognizing}>
            {recognizing ? '识别中…' : preview ? '重新拍照/上传' : '拍照或上传图片'}
          </Button>
        </div>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="待识别" className="mx-auto max-h-40 rounded-lg object-contain" />
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* 识别结果：勾选 + 可编辑 */}
        {lines.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">识别到 {lines.length} 行，勾选要搜索的关键词：</p>
              <Button size="sm" variant="secondary" onClick={searchLcsc} disabled={searching}>
                {searching ? '搜索中…' : '搜索立创'}
              </Button>
            </div>
            <div className="max-h-48 space-y-1 overflow-y-auto">
              {lines.map((line, i) => (
                <label key={i} className="flex cursor-pointer items-center gap-2 rounded border border-neutral-200 px-2 py-1.5 text-sm hover:bg-neutral-50">
                  <input type="checkbox" checked={checked.has(i)} onChange={() => toggle(i)} className="accent-blue-600" />
                  <input
                    value={editing[i] ?? line.text}
                    onChange={(e) => setEditing((prev) => ({ ...prev, [i]: e.target.value }))}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 bg-transparent outline-none"
                  />
                  <span className="shrink-0 text-xs text-neutral-400">{Math.round(line.score * 100)}%</span>
                </label>
              ))}
            </div>
          </div>
        )}

        {/* 立创搜索结果 */}
        {candidates && (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-neutral-200">
            {candidates.length === 0 ? (
              <p className="p-3 text-sm text-neutral-400">无匹配结果</p>
            ) : (
              candidates.map((c) => (
                <button
                  key={c.partNumber}
                  onClick={() => { reset(); onPicked(c.partNumber) }}
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

        {candidates && candidates.length > 0 && (
          <p className="text-xs text-neutral-400">
            点击元件进入入库确认（数量默认为 1）
          </p>
        )}
      </div>
    </Modal>
  )
}
