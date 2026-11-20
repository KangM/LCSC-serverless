/**
 * lib/orders/lcsc-client.ts — 立创商城订单抓取
 *
 * 走会员站的 order-api（member.szlcsc.com 的 XHR 接口），只需要登录 Cookie，
 * 没有滑块、没有签名，比淘宝干净得多。
 *
 * 几个实测结论（2026-11-20 用真实账号验证）：
 *   - 未登录 / Cookie 失效时返回 HTTP 200 + `{"needLogin":true}`，不是 401；
 *   - 订单列表在 `result.page.dataList`，分页字段 `currPage/pageRow/totalPage/totalRow`；
 *   - 订单行自带立创编号 `productCode`（如 C7472976），能直接对上 components.part_number；
 *   - **没有「已签收」状态**：8 月的订单至今仍是 `already_send`，`realArriveTime` 为空。
 *     只有 `realArriveTime` 有值才认签收，`isArrive` 只是「预计到货日已过」，不能用来判签到。
 */
import type { PurchaseOrderInput, PurchaseOrderItemInput, ShipmentState } from '@/lib/purchase-types'

const ENDPOINT = 'https://order-api.szlcsc.com/member/order/list'
const REFERER = 'https://member.szlcsc.com/'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0'

/** Cookie 失效：需要人工重新复制一份 */
export class CookieExpiredError extends Error {
  constructor(message = '登录 Cookie 已失效，请重新复制') {
    super(message)
    this.name = 'CookieExpiredError'
  }
}

/** 接口返回了预期之外的东西（改版、风控、网络异常） */
export class UpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/** 订单状态原文 → 中文，接口也会返回一份 orderStatusMap，这里内置兜底 */
const STATUS_TEXT: Record<string, string> = {
  new: '立创商城处理中',
  wait_audit: '待审核',
  wait_pick: '备货中',
  pickup_started: '开始取货',
  sorting: '开始打包',
  already_out: '已出库',
  already_send: '已发货',
  canceled: '已取消',
}

/** 已经离开仓库、在路上的状态 */
const SHIPPED_STATUSES = new Set(['already_out', 'already_send'])

interface LcscOrderDetail {
  orderDetailId?: number
  productCode?: string | null
  productName?: string | null
  productModel?: string | null
  encapStandard?: string | null
  catalogName?: string | null
  brandName?: string | null
  purchaseNumber?: number | null
  finalNumber?: number | null
  productPrice?: number | null
  productTotalMoney?: number | null
}

interface LcscOrder {
  orderCode?: string | null
  orderStatus?: string | null
  orderTime?: string | null
  paymentTime?: string | null
  realArriveTime?: string | null
  achieveDate?: string | null
  totalMoney?: number | null
  orderTotalMoney?: number | null
  expressName?: string | null
  warehouseCode?: string | null
  orderDetailVOList?: LcscOrderDetail[] | null
}

interface LcscListResponse {
  code?: number
  ok?: boolean
  msg?: string | null
  needLogin?: boolean
  result?: {
    page?: {
      dataList?: LcscOrder[] | null
      totalPage?: number | null
      totalRow?: number | null
    } | null
  } | null
}

function toNumber(value: unknown): number | null {
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * 物流阶段判定。
 *
 * 立创侧没有「已签收」，所以：
 *   - 只有 realArriveTime 有值才算 received（实测这个字段要人工/系统确认才填）；
 *   - already_out / already_send 算 shipped（货已离开仓库，物理在路上）；
 *   - 其余（待审核/备货中/打包）算 pending，不计在途；
 *   - canceled 算取消。
 */
function toShipmentState(order: LcscOrder): ShipmentState {
  const status = String(order.orderStatus ?? '').trim()
  if (status === 'canceled') return 'cancelled'
  if (order.realArriveTime) return 'received'
  if (SHIPPED_STATUSES.has(status)) return 'shipped'
  return 'pending'
}

function toItem(detail: LcscOrderDetail, index: number): PurchaseOrderItemInput | null {
  const productCode = String(detail.productCode ?? '').trim()
  const name = String(detail.productName ?? '').trim()
  if (!name) return null

  // 立创的 purchaseNumber 是下单数量，finalNumber 是审核后的实际数量（截单时会变小）
  const finalQty = toNumber(detail.finalNumber)
  const orderedQty = toNumber(detail.purchaseNumber)
  const quantity = Math.trunc(finalQty && finalQty > 0 ? finalQty : (orderedQty ?? 0))
  if (quantity < 1) return null

  const noteParts = [detail.brandName, detail.encapStandard ? `封装 ${detail.encapStandard}` : null]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)

  return {
    lineNo: index + 1,
    supplierPartNo: productCode || null,
    mpn: detail.productModel?.trim() || null,
    title: name,
    quantity,
    unitPrice: toNumber(detail.productPrice),
    note: noteParts.length ? noteParts.join(' · ') : null,
  }
}

function toOrderInput(order: LcscOrder): PurchaseOrderInput | null {
  const orderNo = String(order.orderCode ?? '').trim()
  if (!orderNo) return null

  const items = (order.orderDetailVOList ?? [])
    .map((detail, index) => toItem(detail, index))
    .filter((item): item is PurchaseOrderItemInput => item !== null)
  if (!items.length) return null

  const shipmentState = toShipmentState(order)
  const status = String(order.orderStatus ?? '')
  const noteParts = [
    order.expressName ? `快递 ${order.expressName}` : null,
    order.warehouseCode ? `仓库 ${order.warehouseCode}` : null,
  ].filter(Boolean)

  return {
    source: 'lcsc',
    orderNo,
    statusText: STATUS_TEXT[status] ?? status ?? null,
    shipmentState,
    orderedAt: order.orderTime ?? null,
    shippedAt: null,
    receivedAt: order.realArriveTime ?? null,
    totalAmount: toNumber(order.orderTotalMoney) ?? toNumber(order.totalMoney),
    note: noteParts.length ? noteParts.join(' · ') : null,
    raw: order,
    items,
  }
}

/**
 * 解析一页响应（纯函数，便于离线验证）。
 * 未登录时立创返回 HTTP 200 + `{ needLogin: true }`，在这里统一转成 CookieExpiredError。
 */
export function parseLcscOrders(body: unknown): {
  orders: PurchaseOrderInput[]
  totalPage: number
  rawCount: number
} {
  const payload = (body ?? {}) as LcscListResponse

  if (payload.needLogin) throw new CookieExpiredError('立创登录 Cookie 已失效，请重新复制')
  if (payload.code !== undefined && payload.code !== 200) {
    throw new UpstreamError(`立创订单接口报错（code=${payload.code}）：${payload.msg ?? '无描述'}`)
  }
  if (payload.ok === false) {
    throw new UpstreamError(`立创订单接口返回失败：${payload.msg ?? '无描述'}`)
  }

  const pageData = payload.result?.page
  const list = pageData?.dataList ?? []
  const orders: PurchaseOrderInput[] = []
  const seen = new Set<string>()
  for (const raw of list) {
    const order = toOrderInput(raw)
    if (!order || seen.has(order.orderNo)) continue
    seen.add(order.orderNo)
    orders.push(order)
  }

  const totalPage = Number(pageData?.totalPage ?? 1)
  return {
    orders,
    totalPage: Number.isFinite(totalPage) ? totalPage : 1,
    rawCount: list.length,
  }
}

/**
 * 拉取全部订单（分页直到 totalPage）。
 *
 * 只翻到 `maxPages` 为止，避免 Cookie 有效但账号订单极多时把同步拖成几分钟。
 */
export async function fetchLcscOrders(
  cookie: string,
  options: { pageSize?: number; maxPages?: number } = {},
): Promise<PurchaseOrderInput[]> {
  const pageSize = Math.min(100, Math.max(1, options.pageSize ?? 50))
  const maxPages = Math.max(1, options.maxPages ?? 5)
  const orders: PurchaseOrderInput[] = []
  const seen = new Set<string>()

  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${ENDPOINT}?currentPage=${page}&pageSize=${pageSize}`
    let response: Response
    try {
      response = await fetch(url, {
        headers: {
          accept: 'application/json',
          'accept-language': 'zh-CN,zh;q=0.9',
          origin: REFERER.slice(0, -1),
          referer: REFERER,
          'user-agent': USER_AGENT,
          cookie,
        },
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      })
    } catch (error) {
      throw new UpstreamError(
        `连接立创订单接口失败：${error instanceof Error ? error.message : '网络异常'}`,
      )
    }

    if (!response.ok) {
      throw new UpstreamError(`立创订单接口返回 HTTP ${response.status}`)
    }

    const body = await response.json().catch(() => null)
    if (!body) throw new UpstreamError('立创订单接口返回的不是 JSON')

    const parsed = parseLcscOrders(body)
    for (const order of parsed.orders) {
      if (seen.has(order.orderNo)) continue
      seen.add(order.orderNo)
      orders.push(order)
    }

    if (page >= parsed.totalPage || parsed.rawCount === 0) break
  }

  return orders
}
