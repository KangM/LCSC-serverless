/**
 * lib/purchase-types.ts — 采购订单的共享类型（客户端/服务端通用）
 *
 * 单独成文件是为了让客户端组件能 import 类型：
 * lib/purchase-orders.ts 带 'server-only'，客户端直接引用会编译报错。
 */

export type PurchaseSource = 'lcsc' | 'taobao' | 'manual'
export type AccountSource = 'lcsc' | 'taobao'
export type ShipmentState = 'pending' | 'shipped' | 'received' | 'cancelled' | 'unknown'
export type SyncStatus = 'ok' | 'cookie_expired' | 'error'

export interface PurchaseAccount {
  id: number
  source: AccountSource
  label: string
  username: string | null
  /** Cookie 是否已配置（接口永远不返回 Cookie 原文） */
  cookieSet: boolean
  /** Cookie 末尾几位，便于确认填的是哪个账号 */
  cookieTail: string | null
  cookieUpdatedAt: string | null
  enabled: boolean
  lastSyncAt: string | null
  lastSyncStatus: SyncStatus | null
  lastSyncMessage: string | null
}

export interface PurchaseOrderItem {
  id: number
  orderId: number
  lineNo: number | null
  supplierPartNo: string | null
  mpn: string | null
  title: string
  quantity: number
  unitPrice: number | null
  matchedPartNumber: string | null
  matchSource: string | null
  consumedQuantity: number
  /** 尚未核销的数量（真正计入在途的部分） */
  pendingQuantity: number
  note: string | null
}

export interface PurchaseOrder {
  id: number
  source: PurchaseSource
  accountId: number | null
  accountLabel: string | null
  orderNo: string
  statusText: string | null
  shipmentState: ShipmentState
  orderedAt: string | null
  receivedAt: string | null
  totalAmount: number | null
  note: string | null
  syncedAt: string | null
  items: PurchaseOrderItem[]
  /** 该订单当前计入在途的件数（仅已发货未签收的订单非零） */
  incomingQuantity: number
}

export interface PurchaseSummary {
  orderCount: number
  incomingOrderCount: number
  incomingQuantity: number
  incomingValue: number
}

export interface ConsumeResult {
  itemId: number
  partNumber: string
  title: string
  quantity: number
  beforeQty: number
  afterQty: number
  /** 该行核销后还剩多少在途 */
  remaining: number
}

/** 手工录入 / 同步时提交的一行 */
export interface PurchaseOrderItemInput {
  lineNo?: number | null
  supplierPartNo?: string | null
  mpn?: string | null
  title: string
  quantity: number
  unitPrice?: number | null
  matchedPartNumber?: string | null
  note?: string | null
}

export interface PurchaseOrderInput {
  source: PurchaseSource
  accountId?: number | null
  orderNo: string
  statusText?: string | null
  shipmentState?: ShipmentState
  orderedAt?: string | null
  shippedAt?: string | null
  receivedAt?: string | null
  totalAmount?: number | null
  note?: string | null
  raw?: unknown
  items: PurchaseOrderItemInput[]
}

export interface ConsumeEntry {
  itemId: number
  /** 本次实收数量，允许小于订单数量（部分到货 / 少量破损） */
  quantity: number
  purchasePrice?: number | null
  referenceDesignator?: string | null
  note?: string | null
}

/** 同步回来的单笔订单摘要（用于界面回显「拉了哪几单」） */
export interface SyncedOrderBrief {
  orderNo: string
  shipmentState: ShipmentState
  itemCount: number
  quantity: number
}

/** 单个账号的同步结果 */
export interface SyncAccountResult {
  accountId: number
  source: AccountSource
  label: string
  status: SyncStatus
  message: string
  /** 平台侧拉到几单 */
  fetched: number
  /** 实际写入/更新几单 */
  imported: number
  /** 自动匹配上的订单行数 */
  matchedItems: number
  orders: SyncedOrderBrief[]
}
