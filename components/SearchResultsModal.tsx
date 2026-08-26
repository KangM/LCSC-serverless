'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Modal } from './ui'
import type { ComponentDetail } from '@/lib/lcsc'

/**
 * 立创搜索结果窗口（单列列表）：
 * 每行 = 序号 + 大图 + 编号 + 名称 + 品牌/封装/价格/库存；
 * 行尾「规格」按钮默认收起，点击展开该元件的完整规格参数表。
 * 滚动到底部自动加载下一页（无限滚动）。
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
  const [inStockSet, setInStockSet] = useState<Set<string>>(new Set())
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const listRef = useRef<HTMLDivElement>(null)

  const search = useCallback(async (k: string, targetPage: number) => {
    setLoading(true)
    setError('')
    try {
      const res = await fetch(`/api/lcsc/search?k=${encodeURIComponent(k)}&page=${targetPage}`, {
        signal: AbortSignal.timeout(20_000),
      })
      const data = await res.json()
      if (!res.ok || !data.items) {
        setError(data.error || '没有匹配结果')
        if (targetPage === 1) setItems([])
        return
      }
      setItems((prev) => (targetPage === 1 ? data.items : [...prev, ...data.items]))
      setInStockSet((prev) => (targetPage === 1 ? new Set(data.inStockSet ?? []) : new Set([...prev, ...(data.inStockSet ?? [])])))
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
      setInStockSet(new Set())
      setPage(1)
      setTotalPages(0)
      setError('')
      setExpanded(new Set())
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

  function toggleExpand(pn: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(pn)) next.delete(pn)
      else next.add(pn)
      return next
    })
  }

  return (
    <Modal open={open} title="立创搜索结果" onClose={onClose} wide>
      <div className="space-y-3">
        {/* 关键词（可修改重搜） */}
        <div className="flex gap-2">
          <Input
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && resubmit()}
            placeholder="输入关键词搜索立创"
            autoFocus
            className="min-w-0 flex-1"
          />
          <Button onClick={resubmit} disabled={loading || !keyword.trim()} className="shrink-0">
            搜索
          </Button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* 结果列表（单列）+ 无限滚动 */}
        <div ref={listRef} onScroll={onScroll} className="max-h-[60vh] space-y-2 overflow-y-auto pr-1">
          {items.length === 0 && !loading && !error && (
            <p className="py-10 text-center text-sm text-neutral-400">输入关键词后点击搜索</p>
          )}
          {items.map((c, idx) => {
            const isExpanded = expanded.has(c.partNumber)
            const specs = Object.entries(c.specifications ?? {})
            return (
              <div key={c.partNumber} className="rounded-lg border border-neutral-200 hover:border-blue-300">
                <div className="flex items-start gap-3 p-2.5">
                  <span className="mt-1 w-7 shrink-0 text-center text-sm text-neutral-400">{idx + 1}</span>
                  {c.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.imageUrl}
                      alt={c.partNumber}
                      className="h-16 w-16 shrink-0 rounded border border-neutral-100 bg-white object-contain"
                      referrerPolicy="no-referrer"
                      loading="lazy"
                    />
                  ) : (
                    <div className="h-16 w-16 shrink-0 rounded bg-neutral-100" />
                  )}
                  {/* 信息区 */}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.name ?? c.partNumber}</div>
                    <div className="font-mono text-xs text-blue-600">{c.partNumber}</div>
                    <div className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-neutral-500">
                      {c.brand && <span>{c.brand}</span>}
                      {c.packageName && <span>封装 {c.packageName}</span>}
                      {c.category && <span>{c.category}</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-medium text-neutral-800">立创价格 ¥{c.price ?? '-'}</span>
                      <span className="text-neutral-400">库存 {c.stockQuantity ?? '-'}</span>
                      {inStockSet.has(c.partNumber) ? (
                        <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-700">在库</span>
                      ) : (
                        <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-500">未入库</span>
                      )}
                    </div>
                    <a
                      href="#"
                      onClick={(e) => {
                        e.preventDefault()
                        toggleExpand(c.partNumber)
                      }}
                      className="mt-1 inline-block text-xs text-blue-600 hover:underline"
                    >
                      {isExpanded ? '▾ 收起规格参数' : '▸ 展开规格参数'}
                    </a>
                  </div>
                  {isExpanded && (
                    <div className="w-52 shrink-0 self-stretch rounded bg-neutral-50/70 px-2 py-1.5">
                        {specs.length === 0 ? (
                          <p className="text-xs text-neutral-400">暂无规格参数</p>
                        ) : (
                          <table className="w-full text-xs">
                            <tbody>
                              {specs.map(([k, v]) => (
                                <tr key={k} className="border-b border-neutral-100 last:border-0">
                                  <td className="w-1/3 py-1 pr-2 text-neutral-500">{k}</td>
                                  <td className="py-1 text-neutral-700">{v}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                    </div>
                  )}
                  <Button size="sm" onClick={() => onPicked(c.partNumber)} className="shrink-0">
                    入库
                  </Button>
                </div>
              </div>
            )
          })}
          {loading && <p className="py-3 text-center text-xs text-neutral-400">加载中…</p>}
          {!loading && items.length > 0 && page >= totalPages && (
            <p className="py-3 text-center text-xs text-neutral-400">已加载全部结果</p>
          )}
        </div>
      </div>
    </Modal>
  )
}
