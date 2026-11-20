'use client'

import { useCallback, useMemo, useState } from 'react'
import { Badge, Button, Card, Input, Label, Select, cn } from './ui'
import { PurchaseAccountsPanel } from './PurchaseAccountsPanel'
import type {
  PurchaseAccount,
  PurchaseOrder,
  PurchaseSource,
  PurchaseSummary,
  ShipmentState,
} from '@/lib/purchase-types'

const SOURCE_LABEL: Record<PurchaseSource, string> = {
  lcsc: '立创商城',
  taobao: '淘宝',
  manual: '手工',
}

const STATE_LABEL: Record<ShipmentState, string> = {
  pending: '待发货',
  shipped: '运输中',
  received: '已签收',
  cancelled: '已取消',
  unknown: '状态未知',
}

const STATE_COLOR: Record<ShipmentState, 'gray' | 'green' | 'red' | 'blue' | 'amber'> = {
  pending: 'amber',
  shipped: 'blue',
  received: 'green',
  cancelled: 'gray',
  unknown: 'gray',
}

const MATCH_LABEL: Record<string, string> = {
  lcsc_code: '立创编号',
  mpn: '厂商型号',
  alias: '标题别名',
  manual: '人工绑定',
}

interface DraftItem {
  title: string
  supplierPartNo: string
  quantity: string
  unitPrice: string
}

function emptyItem(): DraftItem {
  return { title: '', supplierPartNo: '', quantity: '', unitPrice: '' }
}

function money(value: number | null): string {
  if (value == null) return '—'
  return `¥${value.toFixed(2)}`
}

function fmtDay(value: string | null): string {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return value.slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 采购订单页：手工录入 / 查看在途 / 到货核销。
 *
 * 订单只在「运输中」状态计入 BOM 核对的在途量；核销入库后该行在途归零、
 * 库存增加，两边同时变化，不会重复计数。
 */
export function OrdersClient({
  initialOrders,
  initialAccounts,
  initialSummary,
}: {
  initialOrders: PurchaseOrder[]
  initialAccounts: PurchaseAccount[]
  initialSummary: PurchaseSummary
}) {
  const [orders, setOrders] = useState<PurchaseOrder[]>(initialOrders)
  const [accounts, setAccounts] = useState<PurchaseAccount[]>(initialAccounts)
  const [summary, setSummary] = useState<PurchaseSummary | null>(initialSummary)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)

  // 首屏默认展开「运输中」的订单——那才是用户要看的在途明细
  const [expanded, setExpanded] = useState<Set<number>>(
    () => new Set(initialOrders.filter((order) => order.shipmentState === 'shipped').map((order) => order.id)),
  )
  const [bindInput, setBindInput] = useState<Record<number, string>>({})
  const [rememberAlias, setRememberAlias] = useState(true)
  const [consumeInput, setConsumeInput] = useState<Record<number, string>>({})

  const [showForm, setShowForm] = useState(false)
  const [draft, setDraft] = useState({
    source: 'taobao' as PurchaseSource,
    accountId: '',
    orderNo: '',
    shipmentState: 'pending' as ShipmentState,
    orderedAt: '',
    totalAmount: '',
    note: '',
    items: [emptyItem()] as DraftItem[],
  })

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [orderRes, accountRes] = await Promise.all([
        fetch('/api/orders?limit=100'),
        fetch('/api/orders/accounts'),
      ])
      const orderData = await orderRes.json()
      const accountData = await accountRes.json()
      if (!orderRes.ok || !orderData?.ok) throw new Error(orderData?.error || '订单加载失败')
      setOrders(orderData.orders as PurchaseOrder[])
      setSummary(orderData.summary as PurchaseSummary)
      setAccounts((accountData?.accounts ?? []) as PurchaseAccount[])
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [])

  async function api(url: string, method: string, body?: unknown): Promise<boolean> {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const res = await fetch(url, {
        method,
        ...(body === undefined
          ? {}
          : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.error || `操作失败（HTTP ${res.status}）`)
      await load()
      return true
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败')
      return false
    } finally {
      setBusy(false)
    }
  }

  const shippedAccounts = useMemo(
    () => accounts.filter((account) => account.enabled),
    [accounts],
  )

  const draftTotal = draft.items.reduce((sum, item) => {
    const qty = Number(item.quantity)
    const price = Number(item.unitPrice)
    return Number.isFinite(qty) && Number.isFinite(price) ? sum + qty * price : sum
  }, 0)

  async function submitDraft() {
    const items = draft.items
      .map((item) => ({
        title: item.title.trim(),
        supplierPartNo: item.supplierPartNo.trim() || null,
        quantity: Math.trunc(Number(item.quantity)),
        unitPrice: item.unitPrice.trim() === '' ? null : Number(item.unitPrice),
      }))
      .filter((item) => item.title && item.quantity > 0)

    if (!draft.orderNo.trim()) {
      setError('请填写订单号')
      return
    }
    if (items.length === 0) {
      setError('至少填一行：商品名称 + 数量')
      return
    }

    const ok = await api('/api/orders', 'POST', {
      source: draft.source,
      accountId: draft.accountId ? Number(draft.accountId) : null,
      orderNo: draft.orderNo,
      shipmentState: draft.shipmentState,
      orderedAt: draft.orderedAt || null,
      totalAmount: draft.totalAmount.trim() === '' ? null : Number(draft.totalAmount),
      note: draft.note.trim() || null,
      items,
    })
    if (ok) {
      setNotice('订单已保存')
      setDraft({
        source: draft.source,
        accountId: draft.accountId,
        orderNo: '',
        shipmentState: 'pending',
        orderedAt: '',
        totalAmount: '',
        note: '',
        items: [emptyItem()],
      })
      setShowForm(false)
    }
  }

  async function bindItem(itemId: number) {
    const partNumber = (bindInput[itemId] ?? '').trim()
    if (!partNumber) {
      setError('请输入要绑定的立创编号，如 C14663')
      return
    }
    const ok = await api(`/api/orders/items/${itemId}`, 'PATCH', { partNumber, rememberAlias })
    if (ok) {
      setBindInput((prev) => ({ ...prev, [itemId]: '' }))
      setNotice(`已绑定 ${partNumber.toUpperCase()}`)
    }
  }

  async function consume(orderId: number, itemId: number, pending: number) {
    const raw = consumeInput[itemId]
    const quantity = raw === undefined || raw.trim() === '' ? pending : Math.trunc(Number(raw))
    if (!Number.isFinite(quantity) || quantity < 1) {
      setError('核销数量无效')
      return
    }
    if (quantity > pending) {
      setError(`这一行未核销数量只有 ${pending}`)
      return
    }
    const ok = await api(`/api/orders/${orderId}/consume`, 'POST', {
      items: [{ itemId, quantity }],
    })
    if (ok) {
      setConsumeInput((prev) => ({ ...prev, [itemId]: '' }))
      setNotice(`已入库 ${quantity} 件`)
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <p className="text-xs text-neutral-500">订单总数</p>
          <p className="mt-1 text-2xl font-semibold">{summary?.orderCount ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500">运输中的订单</p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">{summary?.incomingOrderCount ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500">在途件数</p>
          <p className="mt-1 text-2xl font-semibold text-blue-600">{summary?.incomingQuantity ?? 0}</p>
        </Card>
        <Card>
          <p className="text-xs text-neutral-500">在途金额</p>
          <p className="mt-1 text-2xl font-semibold">{money(summary?.incomingValue ?? 0)}</p>
        </Card>
      </div>

      {(error || notice) && (
        <div className={cn('rounded-lg px-3 py-2 text-sm', error ? 'bg-red-50 text-red-700' : 'bg-green-50 text-green-700')}>
          {error || notice}
        </div>
      )}

      <PurchaseAccountsPanel accounts={accounts} onChanged={load} />

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-500">手工录入订单</h2>
          <Button variant="secondary" size="sm" onClick={() => setShowForm((v) => !v)}>
            {showForm ? '收起' : '录入一单'}
          </Button>
        </div>
        <p className="mb-3 text-xs text-neutral-400">
          淘宝订单抓取不稳时用这里补录。立创的行填上 C 编号会自动对上库存元件；
          淘宝只有标题，保存后到下面列表里手工绑定一次（勾「记住别名」下次自动命中）。
        </p>

        {showForm && (
          <div className="space-y-3">
            <div className="grid gap-2 sm:grid-cols-4">
              <div>
                <Label>来源</Label>
                <Select
                  value={draft.source}
                  onChange={(e) => setDraft({ ...draft, source: e.target.value as PurchaseSource, accountId: '' })}
                >
                  <option value="taobao">淘宝</option>
                  <option value="lcsc">立创商城</option>
                  <option value="manual">手工 / 其他</option>
                </Select>
              </div>
              <div>
                <Label>订单号</Label>
                <Input
                  value={draft.orderNo}
                  onChange={(e) => setDraft({ ...draft, orderNo: e.target.value })}
                  placeholder="平台订单号"
                />
              </div>
              <div>
                <Label>物流状态</Label>
                <Select
                  value={draft.shipmentState}
                  onChange={(e) => setDraft({ ...draft, shipmentState: e.target.value as ShipmentState })}
                >
                  <option value="pending">待发货（不计在途）</option>
                  <option value="shipped">运输中（计入在途）</option>
                  <option value="received">已签收（不计在途）</option>
                </Select>
              </div>
              <div>
                <Label>下单日期（可选）</Label>
                <Input
                  type="date"
                  value={draft.orderedAt}
                  onChange={(e) => setDraft({ ...draft, orderedAt: e.target.value })}
                />
              </div>
            </div>

            {draft.source !== 'manual' && shippedAccounts.some((a) => a.source === draft.source) && (
              <div className="max-w-xs">
                <Label>归属账号（可选）</Label>
                <Select
                  value={draft.accountId}
                  onChange={(e) => setDraft({ ...draft, accountId: e.target.value })}
                >
                  <option value="">不指定</option>
                  {shippedAccounts
                    .filter((account) => account.source === draft.source)
                    .map((account) => (
                      <option key={account.id} value={account.id}>{account.label}</option>
                    ))}
                </Select>
              </div>
            )}

            <div className="space-y-2">
              <Label>商品行</Label>
              {draft.items.map((item, index) => (
                <div key={index} className="grid gap-2 sm:grid-cols-[1fr_8rem_6rem_7rem_auto]">
                  <Input
                    value={item.title}
                    onChange={(e) => {
                      const items = [...draft.items]
                      items[index] = { ...item, title: e.target.value }
                      setDraft({ ...draft, items })
                    }}
                    placeholder="商品名称 / 型号"
                  />
                  <Input
                    value={item.supplierPartNo}
                    onChange={(e) => {
                      const items = [...draft.items]
                      items[index] = { ...item, supplierPartNo: e.target.value }
                      setDraft({ ...draft, items })
                    }}
                    placeholder="C14663（可选）"
                    className="font-mono"
                  />
                  <Input
                    value={item.quantity}
                    onChange={(e) => {
                      const items = [...draft.items]
                      items[index] = { ...item, quantity: e.target.value }
                      setDraft({ ...draft, items })
                    }}
                    placeholder="数量"
                    inputMode="numeric"
                  />
                  <Input
                    value={item.unitPrice}
                    onChange={(e) => {
                      const items = [...draft.items]
                      items[index] = { ...item, unitPrice: e.target.value }
                      setDraft({ ...draft, items })
                    }}
                    placeholder="单价"
                    inputMode="decimal"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:bg-red-50"
                    onClick={() => {
                      const items = draft.items.filter((_, i) => i !== index)
                      setDraft({ ...draft, items: items.length ? items : [emptyItem()] })
                    }}
                  >
                    删除
                  </Button>
                </div>
              ))}
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setDraft({ ...draft, items: [...draft.items, emptyItem()] })}
              >
                加一行
              </Button>
            </div>

            <div className="grid gap-2 sm:grid-cols-[1fr_10rem]">
              <div>
                <Label>备注（可选）</Label>
                <Input
                  value={draft.note}
                  onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  placeholder="如：补 2026 春季批次"
                />
              </div>
              <div>
                <Label>订单金额（可选）</Label>
                <Input
                  value={draft.totalAmount}
                  onChange={(e) => setDraft({ ...draft, totalAmount: e.target.value })}
                  placeholder={draftTotal > 0 ? draftTotal.toFixed(2) : '0.00'}
                  inputMode="decimal"
                />
              </div>
            </div>

            <Button onClick={submitDraft} disabled={busy}>
              {busy ? '保存中…' : '保存订单'}
            </Button>
          </div>
        )}
      </Card>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-neutral-500">订单列表</h2>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            {loading ? '刷新中…' : '刷新'}
          </Button>
        </div>

        {orders.length === 0 && !loading && (
          <Card>
            <p className="py-8 text-center text-sm text-neutral-400">
              还没有订单。可以先在「采购账号」里配好 Cookie，或手工录入一单。
            </p>
          </Card>
        )}

        {orders.map((order) => {
          const open = expanded.has(order.id)
          return (
            <Card key={order.id} className="!p-0">
              <button
                type="button"
                onClick={() =>
                  setExpanded((prev) => {
                    const next = new Set(prev)
                    if (next.has(order.id)) next.delete(order.id)
                    else next.add(order.id)
                    return next
                  })
                }
                className="flex w-full flex-wrap items-center gap-2 px-4 py-3 text-left hover:bg-neutral-50"
              >
                <span className="text-xs text-neutral-400">{open ? '▾' : '▸'}</span>
                <Badge color={order.source === 'lcsc' ? 'blue' : order.source === 'taobao' ? 'amber' : 'gray'}>
                  {SOURCE_LABEL[order.source]}
                </Badge>
                <span className="font-mono text-sm font-medium">{order.orderNo}</span>
                {order.accountLabel && (
                  <span className="text-xs text-neutral-500">{order.accountLabel}</span>
                )}
                <Badge color={STATE_COLOR[order.shipmentState]}>
                  {order.statusText || STATE_LABEL[order.shipmentState]}
                </Badge>
                {order.incomingQuantity > 0 && (
                  <Badge color="blue">在途 {order.incomingQuantity}</Badge>
                )}
                <span className="ml-auto text-xs text-neutral-400">
                  {fmtDay(order.orderedAt)} · {order.items.length} 行 · {money(order.totalAmount)}
                </span>
              </button>

              {open && (
                <div className="border-t border-neutral-100 px-4 py-3">
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                    {order.shipmentState !== 'shipped' && order.shipmentState !== 'received' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => api(`/api/orders/${order.id}`, 'PATCH', { shipmentState: 'shipped' })}
                      >
                        标记运输中
                      </Button>
                    )}
                    {order.shipmentState === 'shipped' && (
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={busy}
                        onClick={() => api(`/api/orders/${order.id}`, 'PATCH', { shipmentState: 'received' })}
                      >
                        标记已签收
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-red-600 hover:bg-red-50"
                      disabled={busy}
                      onClick={() => {
                        if (confirm(`删除订单 ${order.orderNo}？已核销产生的入库流水会保留。`)) {
                          void api(`/api/orders/${order.id}`, 'DELETE')
                        }
                      }}
                    >
                      删除订单
                    </Button>
                    {order.shipmentState !== 'shipped' && (
                      <span className="text-neutral-400">只有「运输中」的订单计入在途</span>
                    )}
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-neutral-200 text-left text-neutral-500">
                          <th className="px-2 py-2">商品</th>
                          <th className="px-2 py-2 text-right">数量</th>
                          <th className="px-2 py-2 text-right">已入库</th>
                          <th className="px-2 py-2 text-right">待核销</th>
                          <th className="px-2 py-2">匹配元件</th>
                          <th className="px-2 py-2 text-right">核销入库</th>
                        </tr>
                      </thead>
                      <tbody>
                        {order.items.map((item) => (
                          <tr key={item.id} className="border-b border-neutral-100 last:border-0">
                            <td className="max-w-[18rem] px-2 py-1.5">
                              <div className="truncate" title={item.title}>{item.title}</div>
                              {item.supplierPartNo && (
                                <div className="font-mono text-[11px] text-neutral-400">{item.supplierPartNo}</div>
                              )}
                            </td>
                            <td className="px-2 py-1.5 text-right">{item.quantity}</td>
                            <td className="px-2 py-1.5 text-right text-neutral-500">{item.consumedQuantity}</td>
                            <td className={cn('px-2 py-1.5 text-right', item.pendingQuantity > 0 ? 'text-blue-600' : 'text-neutral-300')}>
                              {item.pendingQuantity}
                            </td>
                            <td className="px-2 py-1.5">
                              {item.matchedPartNumber ? (
                                <div className="flex items-center gap-1">
                                  <span className="font-mono">{item.matchedPartNumber}</span>
                                  <span className="text-[11px] text-neutral-400">
                                    {MATCH_LABEL[item.matchSource ?? ''] ?? ''}
                                  </span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1">
                                  <Input
                                    value={bindInput[item.id] ?? ''}
                                    onChange={(e) => setBindInput((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                    placeholder="C14663"
                                    className="h-7 w-24 px-2 py-1 font-mono text-xs"
                                  />
                                  <Button
                                    variant="secondary"
                                    size="sm"
                                    disabled={busy}
                                    onClick={() => bindItem(item.id)}
                                  >
                                    绑定
                                  </Button>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-1.5">
                              <div className="flex items-center justify-end gap-1">
                                <Input
                                  value={consumeInput[item.id] ?? ''}
                                  onChange={(e) => setConsumeInput((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                  placeholder={String(item.pendingQuantity)}
                                  inputMode="numeric"
                                  disabled={!item.matchedPartNumber || item.pendingQuantity === 0}
                                  className="h-7 w-16 px-2 py-1 text-right text-xs"
                                />
                                <Button
                                  size="sm"
                                  disabled={busy || !item.matchedPartNumber || item.pendingQuantity === 0}
                                  onClick={() => consume(order.id, item.id, item.pendingQuantity)}
                                >
                                  入库
                                </Button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <label className="mt-2 flex items-center gap-2 text-[11px] text-neutral-500">
                    <input
                      type="checkbox"
                      checked={rememberAlias}
                      onChange={(e) => setRememberAlias(e.target.checked)}
                    />
                    绑定时记住商品标题，下次同标题的订单行自动匹配
                  </label>
                </div>
              )}
            </Card>
          )
        })}
      </div>
    </div>
  )
}
