'use client'

import { useMemo, useRef, useState } from 'react'
import { Button, Input, Modal } from './ui'
import { FullscreenLoader } from './FullscreenLoader'

interface OcrLine {
  text: string
  score: number
}

/**
 * 拍照 OCR 入库弹窗：
 * 拍照/上传 → 服务端识别 → 文本按空格分割成 tag（chip），点击选择关键词 →
 * 「搜索立创」把选中的关键词交给父级打开搜索结果窗口。
 */
export function OcrModal({
  open,
  onClose,
  onSearch,
}: {
  open: boolean
  onClose: () => void
  onSearch: (keywords: string[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState('')
  const [lines, setLines] = useState<OcrLine[]>([])
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [manualTag, setManualTag] = useState('')
  const [recognizing, setRecognizing] = useState(false)
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
    setError('')
    if (fileRef.current) fileRef.current.value = ''
  }

  async function recognize(file: File) {
    setRecognizing(true)
    setError('')
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
        // 外部视觉 API 可能较慢，30 秒超时
        signal: AbortSignal.timeout(30_000),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '识别失败')
        setLines([])
        return
      }
      setLines(data.lines ?? [])
      // 默认全不选，由用户点选关键词
      setSelected(new Set())
    } catch (e) {
      setError(
        e instanceof Error && e.name === 'TimeoutError' ? '识别超时（30 秒），请检查 OCR 服务或重试' : '识别失败，请重试',
      )
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

  function doSearch() {
    const keywords = [...selected]
    if (!keywords.length) {
      setError('请至少选择一个关键词')
      return
    }
    onSearch(keywords)
  }

  return (
    <>
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

        {/* 识别结果 → tags（默认全不选） */}
        {tags.length > 0 && (
          <div className="space-y-3">
            <p className="text-sm text-neutral-500">
              识别出 <span className="font-medium">{lines.length}</span> 行，点击 tag 选择搜索关键词：
            </p>
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
            <div className="flex justify-end">
              <Button onClick={doSearch} disabled={selected.size === 0}>
                搜索立创（{selected.size}）
              </Button>
            </div>
          </div>
        )}
        </div>
      </Modal>
      {recognizing && <FullscreenLoader message="正在识别图片，请稍候…" />}
    </>
  )
}
