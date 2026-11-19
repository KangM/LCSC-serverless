'use client'

/**
 * components/BoxView.tsx — 按收纳盒看库存（左侧盒列表 + 右侧格位网格）。
 *
 * 设计取舍：
 *  - 点格子**直接开元件详情弹窗**，与列表页点元件名完全一致，
 *    不做「先选中、再点打开」的二段式 —— 多一次点击就是多一次走神。
 *  - 格子固定高度、固定列宽，封装名超长一律省略号（title 里放全名），
 *    否则 C0402_0.6mm 这种封装名会把整列撑歪。
 *  - 空位照样渲染：满容量铺满，"哪几格还空着"本身就是要看的。
 *  - 网格朝向和实物一致：**A–H 横着排在顶部（列），1–9 竖着往下（行）**，
 *    所以位号 R1G4 就是「G 列第 4 行」；悬停时高亮整行整列（含行头列头），照着数不会数错。
 *  - 桌面端整块占满一屏（`100dvh - 页面头部`），左栏只按盒数量撑高、不跟着右栏拉长，
 *    右栏格位超出时自己滚 —— 翻格位时左栏的盒列表始终停在原处。
 *    减掉的 9rem = main 上下 padding 3rem + 标题行 2.75rem + 视图切换行约 3.25rem；
 *    改页面头部结构时这个数要跟着改（改大了下面会留白，改小了整页又会出现滚动条）。
 */

import { useMemo, useState } from 'react'
import { buildBoxLayout, headlineOf, type BoxGroup } from '@/lib/boxes'
import type { BoxComponentRow } from '@/lib/db'
import { cn } from './ui'

const UNPLACED_KEY = '__unplaced__'

type Accent = {
  text: string
  soft: string
  bar: string
  rim: string
}

/** 类名必须写全，Tailwind 只扫源码里的字面量，拼字符串会被裁掉 */
const ACCENTS: Record<string, Accent> = {
  R: { text: 'text-blue-600', soft: 'bg-blue-50', bar: 'bg-blue-500', rim: 'ring-blue-200' },
  CL: { text: 'text-emerald-600', soft: 'bg-emerald-50', bar: 'bg-emerald-500', rim: 'ring-emerald-200' },
  M: { text: 'text-amber-600', soft: 'bg-amber-50', bar: 'bg-amber-500', rim: 'ring-amber-200' },
  B: { text: 'text-violet-600', soft: 'bg-violet-50', bar: 'bg-violet-500', rim: 'ring-violet-200' },
}
const NEUTRAL_ACCENT: Accent = {
  text: 'text-neutral-500',
  soft: 'bg-neutral-100',
  bar: 'bg-neutral-400',
  rim: 'ring-neutral-200',
}

function accentOf(prefix: string): Accent {
  return ACCENTS[prefix] ?? NEUTRAL_ACCENT
}

/** 盒图标：用几何线条画，比 emoji 在不同系统上更一致 */
function BoxGlyph({ prefix, className }: { prefix: string; className?: string }) {
  const common = {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
  }
  if (prefix === 'R') {
    // 锯齿 = 电阻符号
    return (
      <svg {...common}>
        <path d="M2 12h3.2l1.4-4 2.8 8 2.8-8 2.8 8 1.4-4H22" />
      </svg>
    )
  }
  if (prefix === 'CL') {
    // 两条平行板 = 电容符号
    return (
      <svg {...common}>
        <path d="M2 12h6.5M9.5 5.5v13M14.5 5.5v13M15.5 12H22" />
      </svg>
    )
  }
  if (prefix === 'B') {
    // 立体箱子 = 大件
    return (
      <svg {...common}>
        <path d="M12 3 21 7.5v9L12 21 3 16.5v-9L12 3Z" />
        <path d="M3 7.5 12 12l9-4.5M12 12v9" />
      </svg>
    )
  }
  if (prefix === 'M') {
    // 带引脚的方块 = 杂件（芯片/三极管之类）
    return (
      <svg {...common}>
        <rect x="7" y="7" width="10" height="10" rx="2" />
        <path d="M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4" />
      </svg>
    )
  }
  // 未知前缀：问号盒
  return (
    <svg {...common}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.2 2.4c-.6.2-.7.7-.7 1.3v.3M12 17h.01" />
    </svg>
  )
}

export function BoxView({
  items,
  onPick,
}: {
  items: BoxComponentRow[]
  onPick: (partNumber: string) => void
}) {
  const layout = useMemo(() => buildBoxLayout(items), [items])

  // 默认进第一个盒；数据刷新后若原盒消失（全删了）自动回退
  const [activeKey, setActiveKey] = useState<string>(layout.boxes[0]?.key ?? UNPLACED_KEY)
  const [query, setQuery] = useState('')
  const [hover, setHover] = useState<{ row: number; column: string } | null>(null)

  const keyword = query.trim().toLowerCase()
  const hit = useMemo(() => {
    if (!keyword) return null
    const test = (item: BoxComponentRow | undefined) => {
      if (!item) return false
      return [item.reference, item.name, item.value, item.packageName, item.mpn, item.partNumber].some((field) =>
        (field ?? '').toLowerCase().includes(keyword),
      )
    }
    return test
  }, [keyword])

  // 数据刷新后原盒可能消失（盒里的料全删了），此时回退到第一个盒，
  // 而不是渲染空白 —— 否则页面看着像坏了
  const activeBox = layout.boxes.find((box) => box.key === activeKey) ?? layout.boxes[0] ?? null
  const showUnplaced = activeKey === UNPLACED_KEY && layout.unplaced.length > 0

  /** 每个盒里命中多少个 —— 搜索时左栏直接显示，不用逐个点进去找 */
  const hitCount = useMemo(() => {
    if (!hit) return null
    const counts = new Map<string, number>()
    for (const box of layout.boxes) {
      let n = 0
      for (const item of box.cells.values()) if (hit(item)) n += 1
      counts.set(box.key, n)
    }
    counts.set(UNPLACED_KEY, layout.unplaced.filter(hit).length)
    return counts
  }, [hit, layout])

  const usedTotal = layout.totalItems - layout.unplaced.length

  return (
    <div className="box-pane-in flex flex-col gap-3 lg:h-[calc(100dvh-9rem)] lg:min-h-[520px]">
      {/* 总览 */}
      <div className="flex shrink-0 flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm">
        <span className="flex items-center gap-1.5">
          <span className="text-lg leading-none font-semibold">{layout.boxes.length}</span>
          <span className="text-xs text-neutral-500">个盒</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-lg leading-none font-semibold">{layout.totalItems}</span>
          <span className="text-xs text-neutral-500">个元件</span>
        </span>
        <span className="flex items-center gap-1.5">
          <span className="text-lg leading-none font-semibold">
            {usedTotal}
            <span className="text-sm font-normal text-neutral-400">/{layout.totalCapacity}</span>
          </span>
          <span className="text-xs text-neutral-500">格已用</span>
        </span>
        {layout.unplaced.length > 0 && (
          <span className="flex items-center gap-1.5 text-xs text-amber-600">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
            {layout.unplaced.length} 个还没归位
          </span>
        )}
        <span className="ml-auto hidden text-xs text-neutral-400 sm:block">
          点任意格子查看元件详情
        </span>
      </div>

      <div className="grid min-h-0 flex-1 gap-3 lg:grid-cols-[248px_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)]">
        {/* 左：盒列表。只按盒数量撑高，盒多时自己滚，不跟着右栏一起拉长 */}
        <aside className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-2 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0 lg:pr-1">
          {layout.boxes.map((box, index) => {
            const accent = accentOf(box.prefix)
            const used = box.cells.size
            const percent = Math.round((used / box.capacity) * 100)
            const active = activeBox?.key === box.key && !showUnplaced
            const count = hitCount?.get(box.key)
            return (
              <button
                key={box.key}
                type="button"
                onClick={() => {
                  setActiveKey(box.key)
                  setHover(null)
                }}
                style={{ animationDelay: `${index * 45}ms` }}
                className={cn(
                  'box-cell-in group flex w-[190px] shrink-0 flex-col rounded-xl border p-2.5 text-left transition duration-150 lg:w-auto',
                  active
                    ? 'border-blue-300 bg-blue-50/60 shadow-[0_2px_10px_-4px_rgba(29,78,216,.35)]'
                    : 'border-neutral-200 bg-white hover:border-neutral-300 hover:bg-neutral-50',
                )}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                      active ? 'bg-white' : accent.soft,
                      accent.text,
                    )}
                  >
                    <BoxGlyph prefix={box.prefix} className="h-[18px] w-[18px]" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-neutral-800">{box.title}</span>
                    <span className="block font-mono text-[11px] text-neutral-400">{box.key}</span>
                  </span>
                  {count != null && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold',
                        count > 0 ? 'bg-amber-100 text-amber-700' : 'bg-neutral-100 text-neutral-400',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </div>

                <div className="mt-2 flex items-baseline justify-between text-[11px]">
                  <span className="text-neutral-400">
                    <span className={cn('font-semibold', active ? accent.text : 'text-neutral-600')}>{used}</span>
                    <span className="text-neutral-300"> / {box.capacity}</span>
                  </span>
                  <span className={cn('font-mono tabular-nums', active ? accent.text : 'text-neutral-400')}>{percent}%</span>
                </div>
                <div className="mt-1 h-1 overflow-hidden rounded-full bg-neutral-200/70">
                  <div
                    className={cn('box-bar-in h-full rounded-full', accent.bar)}
                    style={{ width: `${Math.max(percent, 2)}%`, animationDelay: `${index * 45 + 120}ms` }}
                  />
                </div>
              </button>
            )
          })}

          {layout.unplaced.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setActiveKey(UNPLACED_KEY)
                setHover(null)
              }}
              className={cn(
                'flex w-[190px] shrink-0 items-center gap-2 rounded-xl border border-dashed p-2.5 text-left transition lg:w-auto',
                showUnplaced
                  ? 'border-amber-300 bg-amber-50/60'
                  : 'border-neutral-300 bg-white hover:border-amber-300 hover:bg-amber-50/40',
              )}
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
                <BoxGlyph prefix="" className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-neutral-800">未归位</span>
                <span className="block text-[11px] text-neutral-400">没有合规位号</span>
              </span>
              <span className="shrink-0 rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">
                {layout.unplaced.length}
              </span>
            </button>
          )}
        </aside>

        {/* 右：格位。标题栏与图例固定，只有中间网格滚动 */}
        <section className="flex min-h-0 min-w-0 flex-col rounded-xl border border-neutral-200 bg-white p-3">
          {showUnplaced ? (
            <UnplacedPane items={layout.unplaced} keyword={keyword} onPick={onPick} />
          ) : activeBox ? (
            <>
              <div className="mb-3 flex shrink-0 flex-wrap items-end justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold text-neutral-900">{activeBox.title}</h2>
                    <span className="rounded-md bg-neutral-100 px-1.5 py-0.5 font-mono text-[11px] text-neutral-500">
                      {activeBox.key}
                    </span>
                    {hitCount && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700">
                        命中 {hitCount.get(activeBox.key) ?? 0}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    {activeBox.cells.size} / {activeBox.capacity} 格已用 · {activeBox.rows.length} 行 ×{' '}
                    {activeBox.columns.length} 列
                  </p>
                </div>
                <label className="relative">
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-neutral-400"
                  >
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3.5-3.5" strokeLinecap="round" />
                  </svg>
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="过滤这一盒：位号 / 型号 / 值"
                    className="w-56 rounded-lg border border-neutral-300 bg-white py-1.5 pr-2 pl-8 text-xs text-neutral-700 placeholder:text-neutral-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 focus:outline-none"
                  />
                </label>
              </div>

              {/* 网格：和实物同向 —— 顶部 A–H 是横轴，最左 1–9 是纵轴，格子内部再省略 */}
              <div className="-mr-1 min-h-0 flex-1 overflow-y-auto pr-1">
                <div
                  className="grid gap-1.5"
                  style={{ gridTemplateColumns: `26px repeat(${activeBox.columns.length}, minmax(0, 1fr))` }}
                  onPointerLeave={() => setHover(null)}
                >
                  {/* 列头吸顶：右栏滚动时列号不能跟着走，否则看一眼格子不知道是第几列 */}
                  <div className="sticky top-0 z-10 bg-white" />
                  {activeBox.columns.map((column) => (
                    <div
                      key={`h${column}`}
                      className={cn(
                        'sticky top-0 z-10 border-b border-neutral-100 bg-white pt-0.5 pb-1 text-center font-mono text-[10px] transition-colors',
                        hover?.column === column ? 'font-semibold text-blue-600' : 'text-neutral-400',
                      )}
                    >
                      {column}
                    </div>
                  ))}

                  {activeBox.rows.map((row, rowIndex) => (
                    <BoxRow
                      key={row}
                      row={row}
                      rowIndex={rowIndex}
                      columns={activeBox.columns}
                      box={activeBox}
                      hover={hover}
                      setHover={setHover}
                      hit={hit}
                      onPick={onPick}
                    />
                  ))}
                </div>
              </div>

              {/* 图例 */}
              <div className="mt-3 flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-neutral-100 pt-2 text-[11px] text-neutral-400">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm border border-neutral-300 bg-white" />
                  有料（点开详情）
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm border border-dashed border-neutral-300 bg-neutral-50" />
                  空位
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-2 rounded-sm bg-red-400" />
                  低于阈值
                </span>
              </div>
            </>
          ) : (
            <p className="py-16 text-center text-sm text-neutral-400">还没有任何盒位数据</p>
          )}
        </section>
      </div>
    </div>
  )
}

/** 一行：行头 + 该行所有格子。单独成组件，悬停时只有受影响的行走 diff */
function BoxRow({
  row,
  rowIndex,
  columns,
  box,
  hover,
  setHover,
  hit,
  onPick,
}: {
  /** 行号 1–9，纵轴 */
  row: number
  rowIndex: number
  /** 列字母 A–H，横轴 */
  columns: string[]
  box: BoxGroup
  hover: { row: number; column: string } | null
  setHover: (value: { row: number; column: string } | null) => void
  hit: ((item: BoxComponentRow | undefined) => boolean) | null
  onPick: (partNumber: string) => void
}) {
  const rowHot = hover?.row === row

  return (
    <>
      <div
        className={cn(
          'flex items-center justify-center rounded-md font-mono text-[11px] transition-colors',
          rowHot ? 'bg-blue-50 font-semibold text-blue-600' : 'text-neutral-400',
        )}
      >
        {row}
      </div>
      {columns.map((column, colIndex) => {
        const item = box.cells.get(`${column}${row}`)
        const matched = hit ? hit(item) : true
        const dimmed = Boolean(hit) && Boolean(item) && !matched
        const highlighted = Boolean(hit) && Boolean(item) && matched
        // 悬停时整行整列都带上淡蓝底，包括有料的格子 —— 只让空格变色时，
        // 行/列看起来是断开的，反而不容易顺着数过去
        const inLine = hover ? hover.row === row || hover.column === column : false
        const isSelf = hover ? hover.row === row && hover.column === column : false
        // 交错进场：按「行优先」的顺序铺开，视觉上像从左上角扫下来
        const delay = Math.min((rowIndex * columns.length + colIndex) * 3, 260)

        if (!item) {
          return (
            <div
              key={`${column}${row}`}
              className={cn(
                'box-cell-in flex min-h-[68px] items-center justify-center rounded-lg border border-dashed transition-colors',
                inLine ? 'border-blue-300 bg-blue-50/60' : 'border-neutral-300 bg-neutral-50',
                hit && 'opacity-40',
              )}
              style={{ animationDelay: `${delay}ms` }}
              aria-hidden
            />
          )
        }

        const low = item.threshold > 0 && item.stock <= item.threshold
        // 悬停提示里把品名、规格、封装都带上：格子里只放得下一行识别字，其余靠悬停补
        const tip = [item.reference, item.name || item.mpn, item.value, item.packageName, `${item.stock} pcs`]
          .filter((part) => Boolean(part))
          .join(' · ')
        return (
          <button
            key={`${column}${row}`}
            type="button"
            onClick={() => onPick(item.partNumber)}
            onPointerEnter={() => setHover({ row, column })}
            onFocus={() => setHover({ row, column })}
            title={tip}
            style={{ animationDelay: `${delay}ms` }}
            className={cn(
              'box-cell-in group relative flex min-h-[68px] flex-col justify-between rounded-lg border px-2 py-1.5 text-left transition duration-150',
              'hover:-translate-y-0.5 hover:border-blue-400 hover:shadow-[0_6px_14px_-6px_rgba(29,78,216,.4)]',
              'focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:outline-none',
              inLine && !isSelf
                ? 'border-blue-200 bg-blue-50/70'
                : low
                  ? 'border-red-200 bg-red-50/40'
                  : 'border-neutral-200 bg-white',
              dimmed && 'opacity-25',
              highlighted && 'ring-2 ring-amber-300 ring-offset-1',
            )}
          >
            {/* 位号：格子里最重的一层，找料先认它 */}
            <span className="flex items-center gap-1">
              <span className="truncate text-[14px] leading-none font-bold tracking-tight text-neutral-900">
                {item.reference}
              </span>
              {low && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />}
            </span>

            {/* 识别行：R/CL 盒按值排，看值最快；杂件/大件用品名 —— 它们的「值」
                常是「正向压降 3.3V」这类描述，当标题认不出是什么料 */}
            <span className="truncate text-[11.5px] leading-none font-semibold text-blue-700">
              {headlineOf(item, box.prefix) || '—'}
            </span>

            {/* 封装 + 数量：固定在底行，两边都限宽，长封装名省略 */}
            <span className="flex items-baseline gap-1">
              <span
                className="min-w-0 flex-1 truncate font-mono text-[10px] leading-none text-neutral-400"
                title={item.packageName}
              >
                {item.packageName || '—'}
              </span>
              <span
                className={cn(
                  'shrink-0 font-mono text-[10.5px] leading-none tabular-nums',
                  low ? 'font-semibold text-red-600' : 'text-neutral-500',
                )}
                title={`库存 ${item.stock}`}
              >
                {item.stock}
              </span>
            </span>
          </button>
        )
      })}
    </>
  )
}

/** 未归位：没有合规位号的元件，用卡片列出来，同样点开详情 */
function UnplacedPane({
  items,
  keyword,
  onPick,
}: {
  items: BoxComponentRow[]
  keyword: string
  onPick: (partNumber: string) => void
}) {
  if (items.length === 0) {
    return <p className="py-16 text-center text-sm text-neutral-400">所有元件都已经归位 🎉</p>
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto pr-1">
      <div className="mb-3">
        <h2 className="text-base font-semibold text-neutral-900">未归位</h2>
        <p className="mt-0.5 text-xs text-neutral-500">
          这些元件没有合规的位号（格式如 R1B1），或位号所在格子已被占用。入库时补一个位号就会出现在对应的盒里。
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item, index) => {
          const matched =
            !keyword ||
            [item.reference, item.name, item.value, item.packageName, item.mpn, item.partNumber].some((field) =>
              (field ?? '').toLowerCase().includes(keyword),
            )
          return (
            <button
              key={item.partNumber}
              type="button"
              onClick={() => onPick(item.partNumber)}
              style={{ animationDelay: `${Math.min(index * 12, 200)}ms` }}
              className={cn(
                'box-cell-in flex flex-col gap-1 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-left transition hover:border-blue-300 hover:shadow-sm',
                !matched && 'opacity-25',
              )}
            >
              <span className="truncate text-[13px] font-semibold text-neutral-900">{item.name || item.mpn}</span>
              <span className="truncate text-[11px] text-blue-700">{item.value || '—'}</span>
              <span className="flex items-baseline gap-2 font-mono text-[10px] text-neutral-400">
                <span className="truncate">{item.packageName || '—'}</span>
                <span className="ml-auto shrink-0">{item.stock}</span>
              </span>
              <span className="truncate font-mono text-[10px] text-neutral-300">{item.partNumber}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
