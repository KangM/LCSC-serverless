import type { Metadata } from 'next'
import { OrdersClient } from '@/components/OrdersClient'
import { listAccounts, listOrders, purchaseSummary } from '@/lib/purchase-orders'

export const metadata: Metadata = { title: '采购订单 · 元件库存管理' }

export default async function OrdersPage() {
  // 订单随时会变（核销、手工补录），首屏直接在服务端取，不做缓存
  const [orders, accounts, summary] = await Promise.all([
    listOrders({ limit: 100 }),
    listAccounts(),
    purchaseSummary(),
  ])

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">采购订单</h1>
      <OrdersClient initialOrders={orders} initialAccounts={accounts} initialSummary={summary} />
    </div>
  )
}
