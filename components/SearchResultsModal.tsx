'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from './ui'
import type { ComponentDetail } from '@/lib/lcsc'

/**
 * 立创搜索结果独立窗口：
 * 卡片网格展示（图片 / 编号 / 名称 / 品牌 / 封装 / 价格 / 库存），
 * 滚动到底部自动加载下一页（无限滚动）。
 * 点击卡片 → onPicked(partNumber) 回到入库确认。
 */
export function SearchResultsModal({
  open,
  keyword: initialKeyword,
  onClose,
  onPicked,
}: {
  open: boolean
  keyword: string
  onClose: () => void
  onPicked: (partNumber: string) => void
}) {
  const [keyword, setKeyword] = useState(initialKeyword)
  const [searchTerm, setSearchTerm] = useState(initialKeyword)
  const [items, setItems] = useState<ComponentDetail[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const listRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (k: string, targetPage: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/lcsc/search?k=${encodeURIComponent(k)}&page=${targetPage}`)
      const data = await res.json()
      if (!res.ok || !data.items) {
        setError(data.error || '没有匹配结果')
        if (targetPage === 1) setItems([])
        return
      }
      setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]))
      setPage(data.page)
      setTotalPages(data.totalPages)
    } catch {
      setError('搜索失败，请检查网络')
    } finally {
      setLoading(false)
    }
  }, [])

  // 打开窗口时自动搜索第 1 页
  useEffect(() => {
    if (open) {
      setKeyword(initialKeyword)
      setSearchTerm(initialKeyword)
      setItems([])
      setPage(1)
      setTotalPages(0)
      setError('')
      if (initialKeyword.trim()) void search(initialKeyword, 1)
    }
  }, [open, initialKeyword, search])

  function onScroll() {
    const el = listRef.current
    if (!el || loading) return
    if (el.scrollHeight - el.scrollTop - el.clientHeight < 300 && page < totalPages) {
      void search(searchTerm, page + 1)
    }
  }

  function resubmit() {
    if (!keyword.trim()) return
    setSearchTerm(keyword.trim())
    setItems([])
    void search(keyword.trim(), 1)
  }

  return (
    <Modal open={open} title="立创搜索结果" onClose={onClose}>
      <div className="space-y-3">
        {/* 关键词（可修改重搜） */}
        <div className="flex gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resubmit()}
            placeholder="输入关键词搜索立创"
            autoFocus
          />
          <Button onClick={resubmit} disabled={loading || !keyword.trim()}>
            搜索
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* 结果卡片网格 + 无限滚动 */}
        <div
          ref={listRef}
          onScroll={onScroll}
          className="max-h-[55vh] space-y-2 overflow-y-auto pr-1"
        >
          {items.length === 0 && !loading && !error && (
            <p className="py-10 text-center text-sm text-neutral-400">输入关键词后点击搜索</p>
          )}
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {items.map((c) => (
              <button
                key={c.partNumber}
                onClick={() => onPicked(c.partNumber)}
                className="flex gap-3 rounded-lg border border-neutral-200 p-2.5 text-left hover:border-blue-400 hover:bg-blue-50/50"
              >
                {c.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={c.imageUrl}
                    alt={c.partNumber}
                    className="h-14 w-14 shrink-0 rounded border border-neutral-100 bg-white object-contain"
                    referrerPolicy="no-referrer"
                    loading="lazy"
                  />
                ) : (
                  <div className="h-14 w-14 shrink-0 rounded bg-neutral-100" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{c.name ?? c.partNumber}</div>
                  <div className="font-mono text-xs text-blue-600">{c.partNumber}</div>
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-neutral-500">
                    {c.brand && <span>{c.brand}</span>}
                    {c.packageName && <span>封装 {c.packageName}</span>}
                    {c.category && <span>{c.category}</span>}
                  </div>
                  <div className="mt-1 text-xs">
                    <span className="font-medium text-neutral-800">¥{c.price ?? '-'}</span>
                    <span className="ml-2 text-neutral-400">库存 {c.stockQuantity ?? '-'}</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
          {loading && <p className="py-3 text-center text-xs text-neutral-400">加载中…</p>}
          {!loading && items.length > 0 && page >= totalPages && (
            <p className="py-3 text-center text-xs text-neutral-400">已加载全部结果</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
