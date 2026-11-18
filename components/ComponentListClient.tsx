'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, EmptyState, Input, Pagination, Select, cn } from './ui'
import { InboundModal } from './InboundModal'
import { StockActionModal, type StockMode } from './StockActionModal'
import { ComponentDetailModal } from './ComponentDetailModal'
import { ImageHoverZoom } from './ImageHoverZoom'
import { BoxView } from './BoxView'
import type { BoxComponentRow, ComponentRow } from '@/lib/db'
import { majorOf, type CategoryGroup } from '@/lib/categories'

export interface ListState {
  q: string
  /** 大类（立创一级目录） */
  major: string
  /** 小类（立创二级目录，对应 components.category） */
  category: string
  packageName: string
  status: 'active' | 'deleted' | 'all'
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
  { value: 'price', label: '立创价格' },
]

export function ComponentListClient({
  initial,
  groups,
  packages,
  boxItems,
  state,
}: {
  initial: { items: ComponentRow[]; total: number; page: number; pageSize: number; totalPages: number }
  groups: CategoryGroup[]
  packages: string[]
  /** 盒视图用的全量数据（不分页），由页面单独查一次 */
  boxItems: BoxComponentRow[]
  state: ListState
}) {
  const router = useRouter()
  const [q, setQ] = useState(state.q)
  const [major, setMajor] = useState(state.major)
  const [category, setCategory] = useState(state.category)
  const [packageName, setPackageName] = useState(state.packageName)
  const [status, setStatus] = useState<ListState['status']>(state.status)
  const [sort, setSort] = useState(state.sort)
  const [order, setOrder] = useState(state.order)

  const [inboundOpen, setInboundOpen] = useState(false)
  const [initialPn, setInitialPn] = useState<string | undefined>()
  const [stockTarget, setStockTarget] = useState<{ mode: StockMode; row: ComponentRow } | null>(null)
  const [detailPn, setDetailPn] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkQty, setBulkQty] = useState('')
  /**
   * 视图切换放在客户端状态里、不同步 URL：切视图只是换个看法，
   * 不该触发一次服务端往返（尤其盒视图还要重新读全量数据）。
   * 代价是刷新后回到列表 —— 可接受，列表才是默认视角。
   */
  const [view, setView] = useState<'list' | 'box'>('list')

  /** 盒视图点格子 → 开详情，与列表页点元件名是同一个弹窗 */
  const openDetail = useCallback((partNumber: string) => setDetailPn(partNumber), [])

  const selectableItems = useMemo(() => initial.items.filter((row) => row.status === 'active'), [initial.items])
  const allSelected = useMemo(
    () => selectableItems.length > 0 && selectableItems.every((r) => selected.has(r.partNumber)),
    [selectableItems, selected],
  )

  function apply(partial: Partial<ListState>) {
    const next = { q, major, category, packageName, status, sort, order, page: 1, ...partial }
    const sp = new URLSearchParams()
    if (next.q) sp.set('q', next.q)
    if (next.major) sp.set('major', next.major)
    if (next.category) sp.set('category', next.category)
    if (next.packageName) sp.set('package', next.packageName)
    if (next.status !== 'active') sp.set('status', next.status)
    if (next.sort && next.sort !== 'updated') sp.set('sort', next.sort)
    if (next.order && next.order !== 'desc') sp.set('order', next.order)
    if (next.page > 1) sp.set('page', String(next.page))
    const qs = sp.toString()
    router.replace(qs ? `/components?${qs}` : '/components')
  }

  /** 选大类：清掉小类 */
  function selectMajor(next: string) {
    setMajor(next)
    setCategory('')
    apply({ major: next, category: '' })
  }

  /** 选小类：自动补上它所属的大类，选中后两级 chips 状态一致 */
  function selectMinor(next: string) {
    const nextMajor = next ? majorOf(next) : major
    setMajor(nextMajor)
    setCategory(next)
    apply({ major: nextMajor, category: next })
  }

  /** 当前选中的大类（用于展开小类 chips） */
  const activeGroup = useMemo(
    () => groups.find((group) => group.major === major) ?? null,
    [groups, major],
  )

  const chipClass = (active: boolean) =>
    `rounded-full border px-2.5 py-1 text-xs transition ${
      active ? 'border-blue-500 bg-blue-600 text-white' : 'border-neutral-300 bg-white text-neutral-600 hover:border-blue-300'
    }`

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableItems.map((r) => r.partNumber)))
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

  const listView = (
    <>
      {/* 工具栏 */}
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-neutral-200 bg-white p-3">
        <div className="w-56">
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && apply({ q })}
            placeholder="搜索编号 / MPN / 名称 / 规格"
          />
        </div>
        <div className="w-32">
          <Select value={major} onChange={(e) => selectMajor(e.target.value)}>
            <option value="">全部大类</option>
            {groups.map((group) => (
              <option key={group.major} value={group.major}>{group.major}（{group.count}）</option>
            ))}
          </Select>
        </div>
        <div className="w-44">
          <Select value={category} onChange={(e) => selectMinor(e.target.value)}>
            <option value="">全部小类</option>
            {activeGroup
              ? activeGroup.minors.map((minor) => (
                  <option key={minor.name} value={minor.name}>{minor.name}（{minor.count}）</option>
                ))
              : groups.map((group) => (
                  <optgroup key={group.major} label={group.major}>
                    {group.minors.map((minor) => (
                      <option key={minor.name} value={minor.name}>{minor.name}（{minor.count}）</option>
                    ))}
                  </optgroup>
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
        <div className="w-28">
          <Select value={status} onChange={(e) => {
            const value = e.target.value as ListState['status']
            setStatus(value)
            apply({ status: value })
          }}>
            <option value="active">正常</option>
            <option value="deleted">已删除</option>
            <option value="all">全部状态</option>
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
        <Button variant="secondary" onClick={() => apply({ q, major, category, packageName, status })}>搜索</Button>
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

      {/* 两级分类筛选：大类 chips，选中大类后再展开该类小类 */}
      {groups.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-8 shrink-0 text-xs text-neutral-400">大类</span>
            <button onClick={() => selectMajor('')} className={chipClass(!major)}>全部</button>
            {groups.map((group) => (
              <button
                key={group.major}
                onClick={() => selectMajor(group.major)}
                className={chipClass(major === group.major)}
                title={`筛选大类：${group.major}`}
              >
                {group.major}
                <span className="ml-1 opacity-60">{group.count}</span>
              </button>
            ))}
          </div>
          {activeGroup && activeGroup.minors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="w-8 shrink-0 text-xs text-neutral-400">小类</span>
              <button onClick={() => selectMinor('')} className={chipClass(!category)}>全部</button>
              {activeGroup.minors.map((minor) => (
                <button
                  key={minor.name}
                  onClick={() => selectMinor(minor.name)}
                  className={chipClass(category === minor.name)}
                  title={`筛选小类：${minor.name}`}
                >
                  {minor.name}
                  <span className="ml-1 opacity-60">{minor.count}</span>
                </button>
              ))}
            </div>
          )}
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
              <th className="px-4 py-2.5 text-center">位号</th>
              <th className="px-4 py-2.5 text-center">规格参数</th>
              <th className="px-4 py-2.5 text-center">库存</th>
              <th className="px-4 py-2.5 text-center">品牌</th>
              <th className="px-4 py-2.5 text-center">封装</th>
              <th className="px-4 py-2.5 text-center">分类（大类 / 小类）</th>
              <th className="px-4 py-2.5 text-right">立创价格</th>
            </tr>
          </thead>
          <tbody>
            {initial.items.length === 0 ? (
              <tr><td colSpan={9}><EmptyState message="没有元件，点击右上角「+ 入库」添加" /></td></tr>
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
                        disabled={row.status === 'deleted'}
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
                          {row.status === 'deleted' && <Badge color="red">已删除</Badge>}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-2 text-center text-neutral-600">{row.referenceDesignator ?? '-'}</td>
                    <td className="w-[28rem] min-w-[28rem] px-4 py-2 align-top">
                      {Object.entries(row.specifications).length === 0 ? (
                        <span className="text-xs text-neutral-400">暂无规格参数</span>
                      ) : (
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-left text-xs leading-5">
                          {Object.entries(row.specifications).slice(0, 4).map(([key, value]) => (
                            <div key={key} className="contents">
                              <dt className="whitespace-nowrap text-neutral-500">{key}</dt>
                              <dd className="break-words text-neutral-700">{value}</dd>
                            </div>
                          ))}
                        </dl>
                      )}
                    </td>
                    <td className="px-4 py-2 text-center">
                      <span className={low ? 'font-semibold text-red-600' : 'font-medium'}>
                        {row.stockQuantity}
                      </span>
                      {low && <Badge color="red">低</Badge>}
                    </td>
                    <td className="px-4 py-2 text-center text-neutral-600">{row.brand ?? '-'}</td>
                    <td className="px-4 py-2 text-center text-neutral-600">{row.packageName ?? '-'}</td>
                    <td className="px-4 py-2 text-center">
                      {row.category ? (
                        <button
                          onClick={() => selectMinor(row.category ?? '')}
                          className="leading-5 hover:underline"
                          title={`筛选小类：${row.category}`}
                        >
                          <span className="block text-[11px] text-neutral-400">{majorOf(row.category)}</span>
                          <span className="block text-blue-600">{row.category}</span>
                        </button>
                      ) : (
                        <span className="text-neutral-400">-</span>
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
    </>
  )

  return (
    <div className="space-y-4">
      {/* 视图切换：列表（默认）/ 按收纳盒 */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex items-center gap-0.5 rounded-lg border border-neutral-200 bg-white p-0.5 shadow-sm">
          {(
            [
              { value: 'list', label: '列表', hint: '逐行核对、筛选、批量操作' },
              { value: 'box', label: '盒视图', hint: '按收纳盒看格位，点格子看详情' },
            ] as const
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setView(option.value)}
              title={option.hint}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition',
                view === option.value
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'text-neutral-600 hover:bg-neutral-100',
              )}
            >
              <ViewIcon name={option.value} />
              {option.label}
            </button>
          ))}
        </div>
        <span className="text-xs text-neutral-400">
          {view === 'list'
            ? `共 ${initial.total} 个元件`
            : `${boxItems.length} 个元件 · 按物理盒排列`}
        </span>
      </div>

      {view === 'box' ? <BoxView items={boxItems} onPick={openDetail} /> : listView}

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
        onDeleted={(pn) => {
          setDetailPn(null)
          setInitialPn(pn)
          setInboundOpen(true)
        }}
      />
    </div>
  )
}

/** 视图切换的小图标：列表 = 逐行，盒视图 = 九宫格 */
function ViewIcon({ name }: { name: 'list' | 'box' }) {
  const common = {
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    className: 'h-3.5 w-3.5',
  }
  if (name === 'list') {
    return (
      <svg {...common}>
        <path d="M5.5 3.5h8M5.5 8h8M5.5 12.5h8" />
        <circle cx="2.5" cy="3.5" r=".9" fill="currentColor" stroke="none" />
        <circle cx="2.5" cy="8" r=".9" fill="currentColor" stroke="none" />
        <circle cx="2.5" cy="12.5" r=".9" fill="currentColor" stroke="none" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="2.2" y="2.2" width="4.6" height="4.6" rx="1" />
      <rect x="9.2" y="2.2" width="4.6" height="4.6" rx="1" />
      <rect x="2.2" y="9.2" width="4.6" height="4.6" rx="1" />
      <rect x="9.2" y="9.2" width="4.6" height="4.6" rx="1" />
    </svg>
  )
}
