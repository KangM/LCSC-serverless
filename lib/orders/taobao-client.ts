/**
 * lib/orders/taobao-client.ts — 淘宝「已买到的宝贝」抓取
 *
 * 淘宝订单数据不在 HTML 里，要走 mtop 的 XHR 接口，每次请求都要带签名：
 *   sign = md5(token & t & appKey & data)     token 取自 Cookie 里的 _m_h5_tk 前缀
 * 这个算法是公开的，能自己算。
 *
 * 但要注意两件事（实测 + 经验）：
 *   1. Cookie 可能被轮换/失效，接口会返回 FAIL_SYS_SESSION_EXPIRED；
 *   2. 一旦命中风控，接口返回带 `_tmd_` 的滑块挑战，**这时候换什么 Cookie 都没用**，
 *      只能人工过滑块。所以这条链路不能当唯一来源，必须配截图/粘贴兜底。
 *
 * 返回结构各版本差异大，这里按「已知多套结构 + 启发式定位」解析，
 * 订单原始数据同时存进 purchase_orders.raw，解析失败也不会丢数据。
 */
import crypto from 'node:crypto'
import type { PurchaseOrderInput, PurchaseOrderItemInput, ShipmentState } from '@/lib/purchase-types'

const ENDPOINT = 'https://h5api.m.taobao.com/h5/mtop.taobao.order.queryboughtlistv2/1.0/'
const APP_KEY = '12574478'
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/157.0.0.0 Safari/537.36 Edg/157.0.0.0'

export class CookieExpiredError extends Error {
  constructor(message = '淘宝登录 Cookie 已失效，请重新复制') {
    super(message)
    this.name = 'CookieExpiredError'
  }
}

/** 命中滑块 / 风控：重试只会加剧，必须人工处理 */
export class RiskControlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'RiskControlError'
  }
}

export class UpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UpstreamError'
  }
}

/** 从 Cookie 里取 mtop token：同名 Cookie 可能有多份，最后一份生效 */
export function extractH5Token(cookie: string): string | null {
  const matches = [...cookie.matchAll(/_m_h5_tk=([a-f0-9]{32})_(\d+)/g)]
  return matches.length ? matches[matches.length - 1][1] : null
}

function sign(token: string, timestamp: string, data: string): string {
  return crypto.createHash('md5').update(`${token}&${timestamp}&${APP_KEY}&${data}`).digest('hex')
}

// ---------------------------------------------------------------------------
// 解析（结构多变，全部按启发式取值）
// ---------------------------------------------------------------------------

type Json = Record<string, unknown>

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** 按候选键顺序取第一个非空值 */
function pick(source: Json, keys: string[]): unknown {
  for (const key of keys) {
    const value = source[key]
    if (value !== undefined && value !== null && value !== '') return value
  }
  return undefined
}

function pickString(source: Json, keys: string[]): string | null {
  const value = pick(source, keys)
  if (value === undefined) return null
  const text = String(value).trim()
  return text ? text : null
}

function pickNumber(source: Json, keys: string[]): number | null {
  const value = pick(source, keys)
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** 在对象树里找「订单数组」：元素含 subOrders / subOrderList / itemList 的数组 */
const ORDER_LIST_KEYS = ['orderList', 'mainOrders', 'orderInfoList', 'orders', 'tradeList']
const SUB_ORDER_KEYS = ['subOrders', 'subOrderList', 'itemList', 'items', 'subOrderInfoList']

function locateOrderArray(root: Json): Json[] {
  // 先按已知键直取
  for (const container of [root, isObject(root.data) ? root.data : null]) {
    if (!container) continue
    for (const key of ORDER_LIST_KEYS) {
      const value = container[key]
      if (Array.isArray(value) && value.length && isObject(value[0])) return value as Json[]
    }
  }

  // 再广度优先找：数组元素带子订单键的就是订单数组
  const queue: Array<{ node: unknown; depth: number }> = [{ node: root, depth: 0 }]
  while (queue.length) {
    const { node, depth } = queue.shift()!
    if (depth > 5 || !isObject(node)) continue
    for (const value of Object.values(node)) {
      if (Array.isArray(value) && value.length && isObject(value[0])) {
        const first = value[0] as Json
        if (SUB_ORDER_KEYS.some((key) => Array.isArray(first[key]))) return value as Json[]
        if (SUB_ORDER_KEYS.some((key) => key in first)) return value as Json[]
      }
      if (isObject(value)) queue.push({ node: value, depth: depth + 1 })
      if (Array.isArray(value)) {
        for (const child of value.slice(0, 3)) {
          if (isObject(child)) queue.push({ node: child, depth: depth + 1 })
        }
      }
    }
  }
  return []
}

function locateSubOrders(order: Json): Json[] {
  for (const key of SUB_ORDER_KEYS) {
    const value = order[key]
    if (Array.isArray(value) && value.length && isObject(value[0])) return value as Json[]
  }
  // 有些版本把子订单包在 mainOrder 里
  const mainOrder = order.mainOrder
  if (isObject(mainOrder)) return locateSubOrders(mainOrder)
  return []
}

/** 淘宝交易状态（英文枚举 / 中文文案）→ 归一化物流阶段 */
function toShipmentState(order: Json, lines: Json[]): ShipmentState {
  const statusInfo = isObject(order.statusInfo) ? order.statusInfo : null
  const raw = [
    pickString(order, ['orderStatus', 'status', 'statusText', 'tradeStatus']),
    statusInfo ? pickString(statusInfo, ['text', 'label', 'statusText']) : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toUpperCase()

  if (!raw) return 'unknown'
  if (/TRADE_CLOSED|TRADE_CANCEL|交易关闭|已取消|退款成功/.test(raw)) return 'cancelled'
  if (/TRADE_FINISHED|TRADE_SUCCESS|交易成功|已完成|确认收货/.test(raw)) return 'received'
  if (/WAIT_BUYER_CONFIRM_GOODS|卖家已发货|待收货|已发货|部分发货/.test(raw)) return 'shipped'
  if (/WAIT_BUYER_PAY|WAIT_SELLER_SEND_GOODS|等待买家付款|待付款|待发货|等待卖家发货|买家已付款/.test(raw)) {
    return 'pending'
  }
  // 子订单全发货也算在路上
  if (lines.length && lines.every((line) => /已发货|待收货/.test(String(pick(line, ['status', 'statusText']) ?? '')))) {
    return 'shipped'
  }
  return 'unknown'
}

/** 毫秒时间戳 / 字符串时间 → ISO 字符串 */
function toIsoTime(value: unknown): string | null {
  if (value == null || value === '') return null
  const n = Number(value)
  if (Number.isFinite(n) && n > 0) {
    const ms = n < 1e12 ? n * 1000 : n
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  const text = String(value).trim()
  const date = new Date(text.replace(/-/g, '/'))
  return Number.isNaN(date.getTime()) ? text : date.toISOString()
}

function toItem(line: Json, index: number): PurchaseOrderItemInput | null {
  const itemInfo = isObject(line.itemInfo) ? line.itemInfo : null
  const priceInfo = isObject(line.priceInfo) ? line.priceInfo : null

  const title =
    pickString(line, ['itemTitle', 'auctionTitle', 'title', 'itemName'])
    ?? (itemInfo ? pickString(itemInfo, ['title', 'itemTitle', 'name']) : null)
  if (!title) return null

  const quantity = Math.trunc(
    pickNumber(line, ['quantity', 'num', 'buyAmount', 'itemQuantity']) ?? 0,
  )
  if (quantity < 1) return null

  const unitPrice =
    pickNumber(line, ['price', 'auctionPrice', 'unitPrice', 'realPrice'])
    ?? (priceInfo ? pickNumber(priceInfo, ['price', 'realTotal', 'total']) : null)

  const sku =
    pickString(line, ['skuText', 'sku', 'skuInfo', 'props'])
    ?? (itemInfo ? pickString(itemInfo, ['skuText', 'sku']) : null)

  const itemId = pickString(line, ['itemId', 'auctionId', 'id', 'numIid'])

  return {
    lineNo: index + 1,
    supplierPartNo: itemId,
    mpn: null,
    title,
    quantity,
    unitPrice,
    // SKU（颜色/规格）对电子元件常常就是封装信息，留给人工绑定时参考
    note: sku,
  }
}

function toOrderInput(order: Json): PurchaseOrderInput | null {
  const mainOrder = isObject(order.mainOrder) ? order.mainOrder : order
  const orderInfo = isObject(mainOrder.orderInfo) ? mainOrder.orderInfo : null
  const statusInfo = isObject(order.statusInfo) ? order.statusInfo : (isObject(mainOrder.statusInfo) ? mainOrder.statusInfo : null)

  const orderNo = pickString(mainOrder, ['orderId', 'bizOrderId', 'id', 'tradeNo', 'orderNo'])
  if (!orderNo) return null

  const lines = locateSubOrders(order)
  const items = lines
    .map((line, index) => toItem(line, index))
    .filter((item): item is PurchaseOrderItemInput => item !== null)
  if (!items.length) return null

  const total =
    pickNumber(mainOrder, ['totalFee', 'payAmount', 'actualFee', 'total', 'orderAmount'])
    ?? (isObject(mainOrder.priceInfo) ? pickNumber(mainOrder.priceInfo as Json, ['total', 'realTotal']) : null)

  return {
    source: 'taobao',
    orderNo,
    statusText: statusInfo ? pickString(statusInfo, ['text', 'label']) : pickString(mainOrder, ['statusText', 'status']),
    shipmentState: toShipmentState(order, lines),
    orderedAt: toIsoTime(
      (orderInfo ? pick(orderInfo, ['createTime', 'gmtCreate']) : undefined)
      ?? pick(mainOrder, ['createTime', 'gmtCreate', 'orderTime']),
    ),
    shippedAt: toIsoTime(pick(mainOrder, ['consignTime', 'sendTime', 'deliveryTime'])),
    receivedAt: null,
    totalAmount: total,
    note: pickString(mainOrder, ['sellerNick', 'shopName'])
      ? `店铺 ${pickString(mainOrder, ['sellerNick', 'shopName'])}`
      : null,
    raw: order,
    items,
  }
}

// ---------------------------------------------------------------------------
// 抓取
// ---------------------------------------------------------------------------

interface MtopResponse {
  ret?: string[]
  data?: unknown
}

/**
 * 解析一页 mtop 响应（纯函数，便于用真实样本离线校准）。
 * 结构认不出来时不抛错，而是把顶层键写进 diagnostics，方便对齐字段。
 */
export function parseTaobaoOrders(body: unknown): {
  orders: PurchaseOrderInput[]
  diagnostics: string
} {
  const root = isObject(body) ? body : {}
  const orderArray = locateOrderArray(root)
  if (!orderArray.length) {
    const container = isObject(root.data) ? (root.data as Json) : root
    return {
      orders: [],
      diagnostics: `未在响应中定位到订单数组，data 顶层键：${Object.keys(container).join(', ') || '（空）'}`,
    }
  }

  const orders = orderArray
    .map((raw) => toOrderInput(raw))
    .filter((order): order is PurchaseOrderInput => order !== null)
  if (!orders.length) {
    return {
      orders: [],
      diagnostics: `定位到 ${orderArray.length} 个候选订单，但都没解析出行项目（结构可能改版）`,
    }
  }

  return { orders, diagnostics: '' }
}

/**
 * 拉取「已买到的宝贝」。
 * 订单页是无限滚动，这个接口一页通常 10~20 单，翻两页足够覆盖近期采购。
 */
export async function fetchTaobaoOrders(
  cookie: string,
  options: { pages?: number } = {},
): Promise<{ orders: PurchaseOrderInput[]; diagnostics: string }> {
  const token = extractH5Token(cookie)
  if (!token) {
    throw new CookieExpiredError('Cookie 里没有 _m_h5_tk，无法计算签名，请重新复制完整 Cookie')
  }

  const pages = Math.max(1, Math.min(5, options.pages ?? 2))
  const collected: PurchaseOrderInput[] = []
  let diagnostics = ''

  for (let page = 1; page <= pages; page += 1) {
    const data = JSON.stringify({
      tabCode: 'all',
      page,
      OrderType: 'OrderList',
      appName: 'tborder',
      appVersion: '3.0',
      condition: JSON.stringify({ directRouteToTm2Scene: '1' }),
      __needlessClearProtocol__: true,
    })
    const timestamp = Date.now().toString()
    const query = new URLSearchParams({
      jsv: '2.7.2',
      appKey: APP_KEY,
      t: timestamp,
      sign: sign(token, timestamp, data),
      v: '1.0',
      ecode: '1',
      timeout: '8000',
      dataType: 'json',
      valueType: 'original',
      ttid: '1@tbwang_windows_1.0.0#pc',
      needLogin: 'true',
      type: 'originaljson',
      isHttps: '1',
      needRetry: 'true',
      api: 'mtop.taobao.order.queryboughtlistV2',
      __customTag__: 'boughtList_all_OrderList',
      preventFallback: 'true',
    })

    let response: Response
    try {
      response = await fetch(`${ENDPOINT}?${query}`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          origin: 'https://buyertrade.taobao.com',
          referer: 'https://buyertrade.taobao.com/',
          'user-agent': USER_AGENT,
          cookie,
        },
        body: 'data=' + encodeURIComponent(data),
        signal: AbortSignal.timeout(20_000),
        cache: 'no-store',
      })
    } catch (error) {
      throw new UpstreamError(
        `连接淘宝订单接口失败：${error instanceof Error ? error.message : '网络异常'}`,
      )
    }

    const text = await response.text()
    if (!response.ok) throw new UpstreamError(`淘宝订单接口返回 HTTP ${response.status}`)
    if (text.includes('_tmd_') || text.includes('x5sec')) {
      throw new RiskControlError('淘宝触发了滑块验证（x5sec），需要人工在浏览器里过一次')
    }

    let body: MtopResponse
    try {
      body = JSON.parse(text) as MtopResponse
    } catch {
      throw new UpstreamError(`淘宝订单接口返回的不是 JSON：${text.slice(0, 120)}`)
    }

    const ret = (body.ret ?? []).join(' ')
    if (/SESSION_EXPIRED|TOKEN_EMPTY|FAIL_SYS_USER_VALIDATE|令牌过期/i.test(ret)) {
      throw new CookieExpiredError(`淘宝登录态无效（${ret}）`)
    }
    if (/FAIL_SYS_|RGV587/i.test(ret)) {
      throw new UpstreamError(`淘宝订单接口报错：${ret}`)
    }

    const parsed = parseTaobaoOrders(body)
    if (!parsed.orders.length) {
      diagnostics = parsed.diagnostics
      break
    }

    collected.push(...parsed.orders)
    if (parsed.orders.length < 5) break
    await new Promise((resolve) => setTimeout(resolve, 800))
  }

  return { orders: collected, diagnostics }
}
