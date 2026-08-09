'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Input, Pagination, Select } from './ui'
import { InboundModal } from './InboundModal'
import { StockActionModal, type StockMode } from './StockActionModal'
import { ComponentDetailModal } from './ComponentDetailModal'
import { ImageHoverZoom } from './ImageHoverZoom'
import type { ComponentRow } from '@/lib/db'

export interface ListState {
  q: string
  category: string
  packageName: string
  sort: string
  order: string
  page: number
}

const SORT_OPTIONS = [
  { value: 'updated', label: '最近更新' },
  { value: 'name', label: '名称' },
  { value: 'brand', label: '品牌' },
  { value: 'package', label: '封装' },
  { value: 'category', label: '分类' },
  { value: 'stock', label: '库存量' },
  { value: 'price', label: '价格' },
]

export function ComponentListClient({
  initial,
  categories,
  packages,
  state,
}: {
  initial: { items: ComponentRow[]; total: number; page: number; pageSize: number; totalPages: number }
  categories: string[]
  packages: string[]
  state: ListState
}) {
  const router = useRouter()
  const [q, setQ] = useState(state.q)
  const [category, setCategory] = useState(state.category)
  const [packageName, setPackageName] = useState(state.packageName)
  const [sort, setSort] = useState(state.sort)
  const [order, setOrder] = useState(state.order)

  const [inboundOpen, setInboundOpen] = useState(false)
  const [initialPn, setInitialPn] = useState<string | undefined>()
  const [stockTarget, setStockTarget] = useState<{ mode: StockMode; row: ComponentRow } | null>(null)
  const [detailPn, setDetailPn] = useState<string | null>(null)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkQty, setBulkQty] = useState('')

  const allSelected = useMemo(
    () => initial.items.length > 0 && initial.items.every((r) => selected.has(r.partNumber)),
    [initial.items, selected],
  )

  function apply(partial: Partial<ListState>) {
    const next = { q, category, packageName, sort, order, page: 1, ...partial }
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.category) sp.set('category', next.category)
    if (next.packageName) sp.set('package', next.packageName)
    if (next.sort && next.sort !== 'updated') sp.set('sort', next.sort)
    if (next.order && next.order !== 'desc') sp.set('order', next.order)
    if (next.page > 1) sp.set('page', String(next.page))
    const qs = sp.toString()
    router.replace(qs ? `/components?${qs}` : '/components')
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(initial.items.map((r) => r.partNumber)))
  }

  function toggleOne(pn: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(pn)) next.delete(pn)
      else next.add(pn)
      return next
    })
  }

  async function bulkStockOut() {
    const qty = Number(bulkQty)
    if (!Number.isInteger(qty) || qty < 1) return
    for (const pn of selected) {
      await fetch(`/api/components/${encodeURIComponent(pn)}/stock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'out', quantity: qty, note: '批量出库' }),
      })
    }
    setBulkOpen(false)
    setBulkQty('')
    setSelected(new Set())
    router.refresh()
  }

  const refresh = () => router.refresh()

  return (
    <div className="space-y-4">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="w-56">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply({ q })}
            placeholder="搜索编号 / MPN / 名称"
          />
        </div>
        <div className="w-40">
          <Select value={category} onChange={(e) => { setCategory(e.target.value); apply({ category: e.target.value }) }}>
            <option value="">全部分类</option>
            {categories.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </Select>
        </div>
        <div className="w-40">
          <Select value={packageName} onChange={(e) => { setPackageName(e.target.value); apply({ packageName: e.target.value }) }}>
            <option value="">全部封装</option>
            {packages.map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </Select>
        </div>
        <div className="w-36">
          <Select value={sort} onChange={(e) => { setSort(e.target.value); apply({ sort: e.target.value }) }}>
            {SORT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </Select>
        </div>
        <div className="w-28">
          <Select value={order} onChange={(e) => { setOrder(e.target.value); apply({ order: e.target.value }) }}>
            <option value="desc">降序</option>
            <option value="asc">升序</option>
          </Select>
        </div>
        <Button variant="secondary" onClick={() => apply({ q, category, packageName })}>搜索</Button>
        <div className="flex-1" />
        <Button
          onClick={() => {
            setInitialPn(undefined)
            setInboundOpen(true)
          }}
        >
          + 入库
        </Button>
      </div>

      {/* 分类快速筛选 chips */}
      {categories.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-neutral-400">分类：</span>
          <button
            onClick={() => apply({ category: '' })}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              !category ? 'border-blue-500 bg-blue-600 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:border-blue-300'
            }`}
          >
            全部
          </button>
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => apply({ category: c })}
              className={`rounded-full border px-2.5 py-1 text-xs transition ${
                category === c ? 'border-blue-500 bg-blue-600 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:border-blue-300'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      )}

      {/* 批量选择栏 */}
      {selected.size > 0 && (
        <div className="flex items-center justify-between rounded-lg bg-blue-50 px-4 py-2 text-sm text-blue-700">
          <span>已选 {selected.size} 项</span>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={bulkQty}
              onChange={(e) => setBulkQty(e.target.value)}
              placeholder="出库数量"
              className="w-28 !py-1.5"
            />
            <Button size="sm" variant="danger" onClick={bulkStockOut} disabled={!bulkQty}>
              批量出库
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setSelected(new Set())}>取消</Button>
          </div>
        </div>
      )}

      {/* 表格：单元格统一 px-4 → 列间 32px、首尾 16px（space-around 效果） */}
      <div className="overflow-x-auto rounded-xl border border-neutral-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
              <th className="w-10 px-4 py-2.5">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} className="accent-blue-600" />
              </th>
              <th className="px-4 py-2.5">元件</th>
              <th className="px-4 py-2.5 text-right">库存</th>
              <th className="px-4 py-2.5">品牌</th>
              <th className="px-4 py-2.5">封装</th>
              <th className="px-4 py-2.5">分类</th>
              <th className="px-4 py-2.5 text-right">价格</th>
            </tr>
          </thead>
          <tbody>
            {initial.items.length === 0 ? (
              <tr><td colSpan={7}><EmptyState message="没有元件，点击右上角「+ 入库」添加" /></td></tr>
            ) : (
              initial.items.map((row) => {
                const low = row.threshold > 0 && row.stockQuantity <= row.threshold
                return (
                  <tr key={row.partNumber} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50">
                    <td className="px-4 py-2">
                      <input
                        type="checkbox"
                        checked={selected.has(row.partNumber)}
                        onChange={() => toggleOne(row.partNumber)}
                        className="accent-blue-600"
                      />
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2">
                        {row.imageUrl ? (
                          <ImageHoverZoom src={row.imageUrl} alt={row.partNumber} className="h-8 w-8 shrink-0 rounded object-contain" />
                        ) : (
                          <div className="h-8 w-8 shrink-0 rounded bg-neutral-100" />
                        )}
                        <div className="min-w-0">
                          <button
                            onClick={() => setDetailPn(row.partNumber)}
                            className="text-left font-medium text-blue-700 hover:underline"
                          >
                            {row.name ?? row.partNumber}
                          </button>
                          <div className="font-mono text-xs text-neutral-400">
                            {row.partNumber}
                            {row.mpn ? ` · ${row.mpn}` : ''}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <span className={low ? 'font-semibold text-red-600' : 'font-medium'}>
                        {row.stockQuantity}
                      </span>
                      {low && <Badge color="red">低</Badge>}
                    </td>
                    <td className="px-4 py-2 text-neutral-600">{row.brand ?? '-'}</td>
                    <td className="px-4 py-2 text-neutral-600">{row.packageName ?? '-'}</td>
                    <td className="px-4 py-2 text-neutral-600">
                      {row.category ? (
                        <button
                          onClick={() => apply({ category: row.category ?? undefined })}
                          className="text-blue-600 hover:underline"
                          title={`筛选分类：${row.category}`}
                        >
                          {row.category}
                        </button>
                      ) : (
                        '-'
                      )}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-600">
                      {row.price != null ? `¥${row.price}` : '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={initial.page} totalPages={initial.totalPages} onPageChange={(p) => apply({ page: p })} />

      {/* 弹窗 */}
      <InboundModal
        open={inboundOpen}
        initialPartNumber={initialPn}
        onClose={() => setInboundOpen(false)}
        onDone={refresh}
      />
      {stockTarget && (
        <StockActionModal
          open
          mode={stockTarget.mode}
          partNumber={stockTarget.row.partNumber}
          name={stockTarget.row.name}
          currentStock={stockTarget.row.stockQuantity}
          onClose={() => setStockTarget(null)}
          onDone={refresh}
        />
      )}
      <ComponentDetailModal
        open={detailPn !== null}
        partNumber={detailPn ?? ''}
        onClose={() => setDetailPn(null)}
        onChanged={refresh}
      />
    </div>
  )
}
