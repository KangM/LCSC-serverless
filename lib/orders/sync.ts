/**
 * lib/orders/sync.ts — 把平台订单同步进本地在途池
 *
 * 一条账号一条链路：取 Cookie → 拉订单 → 幂等 upsert → 自动匹配元件 → 回写同步状态。
 * 所有账号串行执行：淘宝对频率敏感，并发只会更容易触发风控。
 */
import 'server-only'
import {
  autoMatchOrderItems,
  getAccountWithCookie,
  listEnabledAccountCookies,
  markAccountSync,
  upsertOrder,
} from '../purchase-orders'
import type {
  PurchaseSource,
  SyncAccountResult,
  SyncStatus,
  SyncedOrderBrief,
} from '../purchase-types'
import { fetchLcscOrders } from './lcsc-client'
import { fetchTaobaoOrders } from './taobao-client'

export type { SyncAccountResult, SyncedOrderBrief } from '../purchase-types'

async function revalidateInventory(): Promise<void> {
  try {
    const { revalidateTag } = await import('next/cache')
    revalidateTag('inventory', { expire: 0 })
  } catch {
    // 脚本直跑时没有 Next 运行时
  }
}

function errorKind(error: unknown): { status: SyncStatus; message: string } {
  const name = error instanceof Error ? error.name : ''
  const message = error instanceof Error ? error.message : '同步失败'

  if (name === 'CookieExpiredError') return { status: 'cookie_expired', message }
  if (name === 'RiskControlError') {
    return { status: 'error', message: `${message}（过完滑块后重新复制 Cookie）` }
  }
  return { status: 'error', message }
}

/** 同步单个账号 */
export async function syncAccount(accountId: number): Promise<SyncAccountResult> {
  const account = await getAccountWithCookie(accountId)
  if (!account) throw new Error('账号不存在')

  const base: SyncAccountResult = {
    accountId: account.id,
    source: account.source,
    label: account.label,
    status: 'ok',
    message: '',
    fetched: 0,
    imported: 0,
    matchedItems: 0,
    orders: [],
  }

  if (!account.cookie.trim()) {
    const message = '账号没有配置 Cookie，无法同步'
    await markAccountSync(account.id, 'error', message)
    return { ...base, status: 'error', message }
  }

  let diagnostics = ''
  try {
    let fetched: Awaited<ReturnType<typeof fetchLcscOrders>> = []
    if (account.source === 'lcsc') {
      fetched = await fetchLcscOrders(account.cookie)
    } else {
      const result = await fetchTaobaoOrders(account.cookie)
      fetched = result.orders
      diagnostics = result.diagnostics
    }

    const orders: SyncedOrderBrief[] = []
    let matchedItems = 0
    for (const input of fetched) {
      const orderId = await upsertOrder({
        ...input,
        source: account.source as PurchaseSource,
        accountId: account.id,
      })
      matchedItems += await autoMatchOrderItems(orderId, account.source as PurchaseSource)
      orders.push({
        orderNo: input.orderNo,
        shipmentState: input.shipmentState ?? 'unknown',
        itemCount: input.items.length,
        quantity: input.items.reduce((sum, item) => sum + item.quantity, 0),
      })
    }

    const incoming = orders.filter((order) => order.shipmentState === 'shipped').length
    const parts = [
      fetched.length === 0 ? '平台侧没有可同步的订单' : `拉到 ${fetched.length} 单（其中 ${incoming} 单在途）`,
      matchedItems > 0 ? `自动匹配 ${matchedItems} 行` : '没有新匹配到元件的行',
    ]
    if (diagnostics) parts.push(diagnostics)
    const message = parts.join('，')

    await markAccountSync(account.id, 'ok', message)
    await revalidateInventory()

    return {
      ...base,
      status: 'ok',
      message,
      fetched: fetched.length,
      imported: orders.length,
      matchedItems,
      orders,
    }
  } catch (error) {
    const { status, message } = errorKind(error)
    await markAccountSync(account.id, status, message)
    return { ...base, status, message }
  }
}

/** 同步所有启用中的账号（串行，避免同时打平台接口） */
export async function syncAllAccounts(): Promise<SyncAccountResult[]> {
  const accounts = await listEnabledAccountCookies()
  const results: SyncAccountResult[] = []
  for (const account of accounts) {
    results.push(await syncAccount(account.id))
    // 淘宝连续请求容易触发限流，账号之间留一点间隔
    if (account.source === 'taobao') {
      await new Promise((resolve) => setTimeout(resolve, 1200))
    }
  }
  return results
}
