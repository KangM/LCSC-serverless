'use client'

import { useMemo, useRef, useState } from 'react'
import { Button, Input, Modal } from './ui'
import type { ComponentDetail } from '@/lib/lcsc'

interface OcrLine {
  text: string
  score: number
}

/**
 * 拍照 OCR 入库弹窗：
 * 拍照/上传 → 服务端识别 → 文本按空格分割成 tag（chip），点击选择关键词 →
 * 搜索立创 → 选元件 → onPicked(partNumber)
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
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualTag, setManualTag] = useState('')
  const [recognizing, setRecognizing] = useState(false)
  const [searching, setSearching] = useState(false)
  const [candidates, setCandidates] = useState<ComponentDetail[] | null>(null)
  const [error, setError] = useState('')

  /** 识别文本 → 按空格分割 → 去重/过滤 → tags */
  const tags = useMemo(() => {
    const seen = new Set<string>()
    const result: string[] = []
    for (const line of lines) {
      for (const token of line.text.split(/\s+/)) {
        const t = token.trim()
        if (!t) continue
        if (!seen.has(t)) {
          seen.add(t)
          result.push(t)
        }
      }
    }
    return result
  }, [lines])

  function reset() {
    setPreview('')
    setLines([])
    setSelected(new Set())
    setManualTag('')
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
      const recognized: OcrLine[] = data.lines ?? []
      setLines(recognized)
      // 默认全选识别出的 tag
      const all = new Set<string>()
      for (const line of recognized) {
        for (const token of line.text.split(/\s+/)) {
          const t = token.trim()
          if (t) all.add(t)
        }
      }
      setSelected(all)
    } catch {
      setError('识别失败，请重试')
    } finally {
      setRecognizing(false)
    }
  }

  function toggleTag(tag: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      return next
    })
  }

  function addManualTag() {
    const t = manualTag.trim()
    if (!t) return
    setSelected((prev) => new Set(prev).add(t))
    setManualTag('')
  }

  async function searchLcsc() {
    const keywords = [...selected]
    if (!keywords.length) {
      setError('请至少选择一个关键词')
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

        {/* 识别结果 → tags */}
        {tags.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-neutral-500">
                识别出 <span className="font-medium">{lines.length}</span> 行，点击 tag 选择搜索关键词：
              </p>
              <Button size="sm" variant="secondary" onClick={searchLcsc} disabled={searching}>
                {searching ? '搜索中…' : `搜索立创（${selected.size}）`}
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = selected.has(tag)
                return (
                  <button
                    key={tag}
                    onClick={() => toggleTag(tag)}
                    className={`rounded-full border px-2.5 py-1 font-mono text-xs transition ${
                      active
                        ? 'border-blue-500 bg-blue-600 text-white'
                        : 'border-neutral-300 bg-white text-neutral-600 hover:border-blue-300'
                    }`}
                  >
                    {tag}
                  </button>
                )
              })}
            </div>
            {/* 手动添加关键词 */}
            <div className="flex gap-2">
              <Input
                value={manualTag}
                onChange={(e) => setManualTag(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && addManualTag()}
                placeholder="手动添加关键词（如 GRM188R71C104KA01D）"
                className="flex-1"
              />
              <Button variant="secondary" onClick={addManualTag} disabled={!manualTag.trim()}>
                + 添加
              </Button>
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
          <p className="text-xs text-neutral-400">点击元件进入入库确认（数量默认为 1）</p>
        )}
      </div>
    </Modal>
  )
}
