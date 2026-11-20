/**
 * lib/purchase-orders.ts — 采购订单（淘宝 / 立创商城）数据访问层
 *
 * 核心概念：**在途量** = 订单行数量 − 已核销量，且只统计「已发货未签收」的订单。
 * BOM 核对的可用量 = 库存 + 在途，避免「明明买了还在路上」被误判为缺料。
 *
 * 多账户：purchase_accounts 一行一个账号一份 Cookie，同一个平台可以配多个
 * （个人号 / 公司采购号），订单各自同步但汇入同一个在途池。
 *
 * 核销：到货后把订单行转成库存——改库存、写 in 流水、累加 consumed_quantity
 * 三步放进同一个 libSQL batch，保证在途与库存同时变化、不会重复计数。
 */
import 'server-only'
import { getDb, normalizePartNumber } from './db'

import type {
  AccountSource,
  ConsumeEntry,
  ConsumeResult,
  PurchaseAccount,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderItem,
  PurchaseSource,
  PurchaseSummary,
  ShipmentState,
  SyncStatus,
} from './purchase-types'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export type {
  AccountSource,
  ConsumeEntry,
  ConsumeResult,
  PurchaseAccount,
  PurchaseOrder,
  PurchaseOrderInput,
  PurchaseOrderItem,
  PurchaseOrderItemInput,
  PurchaseSource,
  PurchaseSummary,
  ShipmentState,
  SyncStatus,
} from './purchase-types'

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

type SqlRow = Record<string, unknown>

/**
 * 标题归一化：只保留字母数字与汉字，用于别名匹配。
 * 「0603 10K 1% 电阻 100只」与「0603 10k 1%电阻(100只)」归一化后一致。
 */
export function normalizeKeyword(raw: string): string {
  return raw.toLowerCase().replace(/[^0-9a-z\u4e00-\u9fa5]+/g, '')
}

function toNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function mapAccount(row: SqlRow): PurchaseAccount {
  const cookie = String(row.cookie ?? '')
  return {
    id: Number(row.id),
    source: row.source as AccountSource,
    label: String(row.label ?? ''),
    username: (row.username as string) ?? null,
    cookieSet: cookie.length > 0,
    cookieTail: cookie ? cookie.slice(-6) : null,
    cookieUpdatedAt: (row.cookie_updated_at as string) ?? null,
    enabled: toNumber(row.enabled) === 1,
    lastSyncAt: (row.last_sync_at as string) ?? null,
    lastSyncStatus: (row.last_sync_status as SyncStatus) ?? null,
    lastSyncMessage: (row.last_sync_message as string) ?? null,
  }
}

function mapItem(row: SqlRow): PurchaseOrderItem {
  const quantity = toNumber(row.quantity)
  const consumed = toNumber(row.consumed_quantity)
  return {
    id: Number(row.id),
    orderId: Number(row.order_id),
    lineNo: row.line_no == null ? null : toNumber(row.line_no),
    supplierPartNo: (row.supplier_part_no as string) ?? null,
    mpn: (row.mpn as string) ?? null,
    title: String(row.title ?? ''),
    quantity,
    unitPrice: row.unit_price == null ? null : Number(row.unit_price),
    matchedPartNumber: (row.matched_part_number as string) ?? null,
    matchSource: (row.match_source as string) ?? null,
    consumedQuantity: consumed,
    pendingQuantity: Math.max(0, quantity - consumed),
    note: (row.note as string) ?? null,
  }
}

function normalizeState(value: unknown): ShipmentState {
  const raw = String(value ?? '').trim()
  return (['pending', 'shipped', 'received', 'cancelled', 'unknown'] as const).includes(raw as ShipmentState)
    ? (raw as ShipmentState)
    : 'unknown'
}

// ---------------------------------------------------------------------------
// 账户（多账户 Cookie）
// ---------------------------------------------------------------------------

export async function listAccounts(): Promise<PurchaseAccount[]> {
  const result = await getDb().execute(
    'SELECT * FROM purchase_accounts ORDER BY source ASC, id ASC',
  )
  return result.rows.map(mapAccount)
}

/** 同步任务用：取启用中账号的 Cookie 原文 */
export async function listEnabledAccountCookies(): Promise<Array<{ id: number; source: AccountSource; label: string; cookie: string }>> {
  const result = await getDb().execute(
    "SELECT id, source, label, cookie FROM purchase_accounts WHERE enabled = 1 AND trim(cookie) <> '' ORDER BY source ASC, id ASC",
  )
  return result.rows.map((row) => ({
    id: Number(row.id),
    source: row.source as AccountSource,
    label: String(row.label ?? ''),
    cookie: String(row.cookie ?? ''),
  }))
}

export async function createAccount(input: {
  source: AccountSource
  label: string
  username?: string | null
  cookie: string
}): Promise<PurchaseAccount> {
  const source: AccountSource = input.source === 'taobao' ? 'taobao' : 'lcsc'
  const label = input.label.trim()
  const cookie = input.cookie.trim()
  if (!label) throw new Error('账号名称不能为空')
  if (!cookie) throw new Error('Cookie 不能为空')

  const now = new Date().toISOString()
  const result = await getDb().execute({
    sql: `INSERT INTO purchase_accounts (source, label, username, cookie, cookie_updated_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)`,
    args: [source, label, input.username?.trim() || null, cookie, now, now],
  })
  const id = Number(result.lastInsertRowid)
  const created = await getDb().execute({ sql: 'SELECT * FROM purchase_accounts WHERE id = ?', args: [id] })
  return mapAccount(created.rows[0])
}

export async function updateAccount(
  id: number,
  patch: { label?: string; username?: string | null; cookie?: string; enabled?: boolean },
): Promise<PurchaseAccount> {
  const sets: string[] = []
  const args: Array<string | number | null> = []
  const now = new Date().toISOString()

  if (patch.label !== undefined) {
    const label = patch.label.trim()
    if (!label) throw new Error('账号名称不能为空')
    sets.push('label = ?')
    args.push(label)
  }
  if (patch.username !== undefined) {
    sets.push('username = ?')
    args.push(patch.username?.trim() || null)
  }
  if (patch.cookie !== undefined) {
    const cookie = patch.cookie.trim()
    if (!cookie) throw new Error('Cookie 不能为空')
    sets.push('cookie = ?', 'cookie_updated_at = ?')
    args.push(cookie, now)
    // 换 Cookie 后清掉上次的失败状态，避免界面一直提示过期
    sets.push('last_sync_status = NULL', 'last_sync_message = NULL')
  }
  if (patch.enabled !== undefined) {
    sets.push('enabled = ?')
    args.push(patch.enabled ? 1 : 0)
  }
  if (sets.length === 0) throw new Error('没有需要修改的字段')

  sets.push('updated_at = ?')
  args.push(now, id)
  await getDb().execute({ sql: `UPDATE purchase_accounts SET ${sets.join(', ')} WHERE id = ?`, args })

  const result = await getDb().execute({ sql: 'SELECT * FROM purchase_accounts WHERE id = ?', args: [id] })
  if (!result.rows.length) throw new Error('账号不存在')
  return mapAccount(result.rows[0])
}

export async function deleteAccount(id: number): Promise<void> {
  // 外键约束在 SQLite 下默认不生效，显式把订单的 account_id 置空
  await getDb().batch(
    [
      { sql: 'UPDATE purchase_orders SET account_id = NULL WHERE account_id = ?', args: [id] },
      { sql: 'DELETE FROM purchase_accounts WHERE id = ?', args: [id] },
    ],
    'write',
  )
}

/** 同步结果回写（Cookie 失效、成功、网络错误） */
export async function markAccountSync(
  id: number,
  status: SyncStatus,
  message?: string | null,
): Promise<void> {
  await getDb().execute({
    sql: `UPDATE purchase_accounts
          SET last_sync_at = ?, last_sync_status = ?, last_sync_message = ?, updated_at = ?
          WHERE id = ?`,
    args: [new Date().toISOString(), status, message?.slice(0, 500) ?? null, new Date().toISOString(), id],
  })
}

// ---------------------------------------------------------------------------
// 订单读取
// ---------------------------------------------------------------------------

/**
 * 订单列表（含行项目）。
 * 两条查询而不是 N+1：先按条件取订单，再用 IN 一次性取全部行。
 */
export async function listOrders(
  filter: { source?: PurchaseSource; shipmentState?: ShipmentState; q?: string; limit?: number } = {},
): Promise<PurchaseOrder[]> {
  const where: string[] = []
  const args: Array<string | number> = []
  if (filter.source) {
    where.push('o.source = ?')
    args.push(filter.source)
  }
  if (filter.shipmentState) {
    where.push('o.shipment_state = ?')
    args.push(filter.shipmentState)
  }
  if (filter.q && filter.q.trim()) {
    where.push(`(o.order_no LIKE ? OR EXISTS (
      SELECT 1 FROM purchase_order_items i
      WHERE i.order_id = o.id AND (i.title LIKE ? OR i.mpn LIKE ? OR i.supplier_part_no LIKE ?)
    ))`)
    const like = `%${filter.q.trim()}%`
    args.push(like, like, like, like)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''
  const limit = Math.min(500, Math.max(1, filter.limit ?? 100))

  const orderRows = await getDb().execute({
    sql: `SELECT o.*, a.label AS account_label
          FROM purchase_orders o
          LEFT JOIN purchase_accounts a ON a.id = o.account_id
          ${whereSql}
          ORDER BY COALESCE(o.shipped_at, o.ordered_at, o.created_at) DESC, o.id DESC
          LIMIT ?`,
    args: [...args, limit],
  })
  if (orderRows.rows.length === 0) return []

  const ids = orderRows.rows.map((row) => Number(row.id))
  const itemRows = await getDb().execute({
    sql: `SELECT * FROM purchase_order_items
          WHERE order_id IN (${ids.map(() => '?').join(',')})
          ORDER BY order_id ASC, line_no ASC, id ASC`,
    args: ids,
  })

  const itemsByOrder = new Map<number, PurchaseOrderItem[]>()
  for (const row of itemRows.rows) {
    const item = mapItem(row)
    const list = itemsByOrder.get(item.orderId) ?? []
    list.push(item)
    itemsByOrder.set(item.orderId, list)
  }

  return orderRows.rows.map((row) => {
    const shipmentState = normalizeState(row.shipment_state)
    const items = itemsByOrder.get(Number(row.id)) ?? []
    const incomingQuantity =
      shipmentState === 'shipped'
        ? items.reduce((sum, item) => sum + item.pendingQuantity, 0)
        : 0
    return {
      id: Number(row.id),
      source: row.source as PurchaseSource,
      accountId: row.account_id == null ? null : Number(row.account_id),
      accountLabel: (row.account_label as string) ?? null,
      orderNo: String(row.order_no ?? ''),
      statusText: (row.status_text as string) ?? null,
      shipmentState,
      orderedAt: (row.ordered_at as string) ?? null,
      receivedAt: (row.received_at as string) ?? null,
      totalAmount: row.total_amount == null ? null : Number(row.total_amount),
      note: (row.note as string) ?? null,
      syncedAt: (row.synced_at as string) ?? null,
      items,
      incomingQuantity,
    }
  })
}

/** 在途量：元件编号 → 未核销件数（只含「已发货未签收」的订单） */
export async function getIncomingByPartNumber(): Promise<Map<string, number>> {
  const result = await getDb().execute(`
    SELECT UPPER(trim(i.matched_part_number)) AS pn,
           SUM(i.quantity - i.consumed_quantity) AS qty
    FROM purchase_order_items i
    JOIN purchase_orders o ON o.id = i.order_id
    WHERE o.shipment_state = 'shipped'
      AND i.matched_part_number IS NOT NULL
      AND trim(i.matched_part_number) <> ''
      AND i.quantity > i.consumed_quantity
    GROUP BY UPPER(trim(i.matched_part_number))
  `)
  const map = new Map<string, number>()
  for (const row of result.rows) {
    const pn = String(row.pn ?? '').trim()
    const qty = toNumber(row.qty)
    if (pn && qty > 0) map.set(pn, qty)
  }
  return map
}

/** 订单页头部的汇总指标 */
export async function purchaseSummary(): Promise<PurchaseSummary> {
  const result = await getDb().execute(`
    SELECT
      (SELECT COUNT(*) FROM purchase_orders) AS order_count,
      (SELECT COUNT(DISTINCT o.id) FROM purchase_orders o
        JOIN purchase_order_items i ON i.order_id = o.id
        WHERE o.shipment_state = 'shipped' AND i.quantity > i.consumed_quantity) AS incoming_order_count,
      (SELECT COALESCE(SUM(i.quantity - i.consumed_quantity), 0)
        FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id
        WHERE o.shipment_state = 'shipped' AND i.quantity > i.consumed_quantity) AS incoming_quantity,
      (SELECT COALESCE(SUM((i.quantity - i.consumed_quantity) * COALESCE(i.unit_price, 0)), 0)
        FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id
        WHERE o.shipment_state = 'shipped' AND i.quantity > i.consumed_quantity) AS incoming_value
  `)
  const row = result.rows[0] ?? {}
  return {
    orderCount: toNumber(row.order_count),
    incomingOrderCount: toNumber(row.incoming_order_count),
    incomingQuantity: toNumber(row.incoming_quantity),
    incomingValue: toNumber(row.incoming_value),
  }
}

// ---------------------------------------------------------------------------
// 行项目匹配
// ---------------------------------------------------------------------------

/**
 * 给订单行找库存元件，按可靠性从高到低：
 *   1. lcsc_code — 立创行自带 C 编号，直接对上（最可靠）
 *   2. mpn       — 厂商型号精确匹配（不区分大小写）
 *   3. alias     — 人工绑定过的标题别名
 * 匹配不到就留空，等人工绑定（绑定后可记住别名，下次自动命中）。
 */
export async function matchOrderItem(item: {
  source: PurchaseSource
  supplierPartNo?: string | null
  mpn?: string | null
  title: string
}): Promise<{ partNumber: string; source: string } | null> {
  const client = getDb()

  const code = item.supplierPartNo?.trim()
  if (code && /^C\d+$/i.test(code)) {
    const pn = normalizePartNumber(code)
    const hit = await client.execute({
      sql: "SELECT part_number FROM components WHERE part_number = ? AND status = 'active'",
      args: [pn],
    })
    if (hit.rows.length) return { partNumber: pn, source: 'lcsc_code' }
  }

  const mpn = item.mpn?.trim()
  if (mpn) {
    const hit = await client.execute({
      sql: "SELECT part_number FROM components WHERE UPPER(trim(mpn)) = ? AND status = 'active' LIMIT 1",
      args: [mpn.toUpperCase()],
    })
    if (hit.rows.length) return { partNumber: String(hit.rows[0].part_number), source: 'mpn' }
  }

  const keyword = normalizeKeyword(item.title)
  if (keyword) {
    const hit = await client.execute({
      sql: `SELECT a.part_number FROM purchase_item_aliases a
            JOIN components c ON c.part_number = a.part_number AND c.status = 'active'
            WHERE a.source = ? AND a.keyword = ?
            ORDER BY a.id DESC LIMIT 1`,
      args: [item.source, keyword],
    })
    if (hit.rows.length) return { partNumber: String(hit.rows[0].part_number), source: 'alias' }
  }

  return null
}

/** 人工绑定：把订单行指向某个元件，可选记住标题别名供下次自动匹配 */
export async function bindOrderItem(
  itemId: number,
  partNumber: string,
  options: { rememberAlias?: boolean } = {},
): Promise<void> {
  const pn = normalizePartNumber(partNumber)
  const client = getDb()
  const exists = await client.execute({
    sql: "SELECT part_number FROM components WHERE part_number = ? AND status = 'active'",
    args: [pn],
  })
  if (!exists.rows.length) throw new Error(`元件 ${pn} 不在库存中`)

  const item = await client.execute({
    sql: `SELECT i.*, o.source AS order_source FROM purchase_order_items i
          JOIN purchase_orders o ON o.id = i.order_id WHERE i.id = ?`,
    args: [itemId],
  })
  if (!item.rows.length) throw new Error('订单行不存在')

  const stmts: Parameters<ReturnType<typeof getDb>['batch']>[0] = [
    {
      sql: "UPDATE purchase_order_items SET matched_part_number = ?, match_source = 'manual', updated_at = ? WHERE id = ?",
      args: [pn, new Date().toISOString(), itemId],
    },
  ]
  if (options.rememberAlias) {
    const keyword = normalizeKeyword(String(item.rows[0].title ?? ''))
    if (keyword) {
      stmts.push({
        sql: `INSERT INTO purchase_item_aliases (source, keyword, part_number) VALUES (?, ?, ?)
              ON CONFLICT(source, keyword, part_number) DO NOTHING`,
        args: [String(item.rows[0].order_source ?? 'manual'), keyword, pn],
      })
    }
  }
  await client.batch(stmts, 'write')
}

// ---------------------------------------------------------------------------
// 订单写入
// ---------------------------------------------------------------------------

/**
 * 写入订单（按 source + order_no 幂等 upsert）。
 * 行项目按「平台行号」对齐：同步时整体替换该订单的行，但**保留已核销量**，
 * 否则重复同步会把到货记录抹掉、在途凭空复活。
 */
export async function upsertOrder(input: PurchaseOrderInput): Promise<number> {
  const source = input.source
  const orderNo = input.orderNo.trim()
  if (!orderNo) throw new Error('订单号不能为空')
  if (!input.items.length) throw new Error('订单至少要有一行')

  const client = getDb()
  const now = new Date().toISOString()
  const shipmentState = normalizeState(input.shipmentState)

  const existing = await client.execute({
    sql: 'SELECT id FROM purchase_orders WHERE source = ? AND order_no = ?',
    args: [source, orderNo],
  })
  const orderId = existing.rows.length
    ? Number(existing.rows[0].id)
    : Number(
        (
          await client.execute({
            sql: `INSERT INTO purchase_orders
                    (source, account_id, order_no, status_text, shipment_state, ordered_at, shipped_at,
                     received_at, total_amount, note, raw, synced_at, updated_at)
                  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            args: [
              source,
              input.accountId ?? null,
              orderNo,
              input.statusText ?? null,
              shipmentState,
              input.orderedAt ?? null,
              input.shippedAt ?? null,
              input.receivedAt ?? null,
              input.totalAmount ?? null,
              input.note ?? null,
              input.raw === undefined ? null : JSON.stringify(input.raw),
              now,
              now,
            ],
          })
        ).lastInsertRowid,
      )

  if (existing.rows.length) {
    await client.execute({
      sql: `UPDATE purchase_orders SET
              account_id = COALESCE(?, account_id),
              status_text = COALESCE(?, status_text),
              shipment_state = ?,
              ordered_at = COALESCE(?, ordered_at),
              shipped_at = COALESCE(?, shipped_at),
              received_at = COALESCE(?, received_at),
              total_amount = COALESCE(?, total_amount),
              note = COALESCE(?, note),
              raw = COALESCE(?, raw),
              synced_at = ?, updated_at = ?
            WHERE id = ?`,
      args: [
        input.accountId ?? null,
        input.statusText ?? null,
        shipmentState,
        input.orderedAt ?? null,
        input.shippedAt ?? null,
        input.receivedAt ?? null,
        input.totalAmount ?? null,
        input.note ?? null,
        input.raw === undefined ? null : JSON.stringify(input.raw),
        now,
        now,
        orderId,
      ],
    })
  }

  // 已存在的行：按 line_no（或 supplier_part_no + title）取回已核销量
  const previousRows = await client.execute({
    sql: 'SELECT id, line_no, supplier_part_no, title, consumed_quantity, matched_part_number, match_source FROM purchase_order_items WHERE order_id = ?',
    args: [orderId],
  })
  const previous = previousRows.rows.map((row) => ({
    id: Number(row.id),
    lineNo: row.line_no == null ? null : Number(row.line_no),
    supplierPartNo: (row.supplier_part_no as string) ?? null,
    title: String(row.title ?? ''),
    consumed: toNumber(row.consumed_quantity),
    matched: (row.matched_part_number as string) ?? null,
    matchSource: (row.match_source as string) ?? null,
  }))

  const stmts: Parameters<typeof client.batch>[0] = []
  const keepIds = new Set<number>()

  for (const [index, item] of input.items.entries()) {
    const quantity = Math.max(1, Math.trunc(item.quantity))
    const lineNo = item.lineNo ?? index + 1
    const match =
      previous.find((prev) => prev.lineNo === lineNo)
      ?? previous.find((prev) => prev.supplierPartNo && prev.supplierPartNo === item.supplierPartNo)
      ?? previous.find((prev) => prev.title === item.title)

    const explicit = item.matchedPartNumber ? normalizePartNumber(item.matchedPartNumber) : null
    const matched = explicit ?? match?.matched ?? null
    const matchSource = explicit ? 'manual' : (match?.matchSource ?? null)

    if (match) {
      keepIds.add(match.id)
      stmts.push({
        sql: `UPDATE purchase_order_items SET
                line_no = ?, supplier_part_no = ?, mpn = ?, title = ?, quantity = ?, unit_price = ?,
                matched_part_number = ?, match_source = ?, note = ?, updated_at = ?
              WHERE id = ?`,
        args: [
          lineNo,
          item.supplierPartNo?.trim() || null,
          item.mpn?.trim() || null,
          item.title,
          quantity,
          item.unitPrice ?? null,
          matched,
          matchSource,
          item.note ?? null,
          now,
          match.id,
        ],
      })
    } else {
      stmts.push({
        sql: `INSERT INTO purchase_order_items
                (order_id, line_no, supplier_part_no, mpn, title, quantity, unit_price,
                 matched_part_number, match_source, note, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          orderId,
          lineNo,
          item.supplierPartNo?.trim() || null,
          item.mpn?.trim() || null,
          item.title,
          quantity,
          item.unitPrice ?? null,
          matched,
          matchSource,
          item.note ?? null,
          now,
        ],
      })
    }
  }

  // 平台侧已不存在的行：没核销过就删掉，核销过则保留（保住历史入库依据）
  for (const prev of previous) {
    if (keepIds.has(prev.id)) continue
    if (prev.consumed > 0) {
      stmts.push({
        sql: 'UPDATE purchase_order_items SET quantity = consumed_quantity, updated_at = ? WHERE id = ?',
        args: [now, prev.id],
      })
    } else {
      stmts.push({ sql: 'DELETE FROM purchase_order_items WHERE id = ?', args: [prev.id] })
    }
  }

  if (stmts.length) await client.batch(stmts, 'write')
  return orderId
}

/** 手工录入订单：先建单，再逐行尝试自动匹配 */
export async function createManualOrder(input: PurchaseOrderInput): Promise<number> {
  const orderId = await upsertOrder(input)

  const rows = await getDb().execute({
    sql: `SELECT id, supplier_part_no, mpn, title, matched_part_number FROM purchase_order_items
          WHERE order_id = ? AND (matched_part_number IS NULL OR matched_part_number = '')`,
    args: [orderId],
  })
  for (const row of rows.rows) {
    const hit = await matchOrderItem({
      source: input.source,
      supplierPartNo: (row.supplier_part_no as string) ?? null,
      mpn: (row.mpn as string) ?? null,
      title: String(row.title ?? ''),
    })
    if (!hit) continue
    await getDb().execute({
      sql: 'UPDATE purchase_order_items SET matched_part_number = ?, match_source = ?, updated_at = ? WHERE id = ?',
      args: [hit.partNumber, hit.source, new Date().toISOString(), Number(row.id)],
    })
  }
  return orderId
}

export async function deleteOrder(id: number): Promise<void> {
  await getDb().batch(
    [
      { sql: 'DELETE FROM purchase_order_items WHERE order_id = ?', args: [id] },
      { sql: 'DELETE FROM purchase_orders WHERE id = ?', args: [id] },
    ],
    'write',
  )
}

/** 手动推进物流阶段（如平台没给状态时自己标已签收） */
export async function setOrderState(id: number, state: ShipmentState): Promise<void> {
  const now = new Date().toISOString()
  await getDb().execute({
    sql: `UPDATE purchase_orders SET shipment_state = ?, updated_at = ?,
            received_at = CASE WHEN ? = 'received' THEN COALESCE(received_at, ?) ELSE received_at END
          WHERE id = ?`,
    args: [state, now, state, now, id],
  })
}

// ---------------------------------------------------------------------------
// 核销入库
// ---------------------------------------------------------------------------


/**
 * 到货核销：把订单行转成库存。
 *
 * 一个 batch 内完成三件事——库存加、流水写、已核销量累加，
 * 保证「在途减少」和「库存增加」同时发生，不会出现两头都算或两头都不算。
 * 已核销量不会超过订单数量（部分到货就部分核销）。
 */
export async function consumeOrderItems(
  entries: ConsumeEntry[],
  operator?: string,
): Promise<ConsumeResult[]> {
  if (entries.length === 0) throw new Error('没有需要核销的行')
  const client = getDb()
  const now = new Date().toISOString()
  const results: ConsumeResult[] = []
  const stmts: Parameters<typeof client.batch>[0] = []

  for (const entry of entries) {
    const itemRows = await client.execute({
      sql: `SELECT i.*, o.order_no AS order_no, o.source AS order_source
            FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id
            WHERE i.id = ?`,
      args: [entry.itemId],
    })
    if (!itemRows.rows.length) throw new Error(`订单行 ${entry.itemId} 不存在`)
    const item = itemRows.rows[0]

    const partNumber = (item.matched_part_number as string) ?? ''
    if (!partNumber) throw new Error(`「${item.title}」还没绑定库存元件，先绑定再核销`)

    const ordered = toNumber(item.quantity)
    const consumed = toNumber(item.consumed_quantity)
    const pending = Math.max(0, ordered - consumed)
    const quantity = Math.trunc(Number(entry.quantity))
    if (!Number.isFinite(quantity) || quantity < 1) throw new Error(`核销数量无效：${entry.quantity}`)
    if (quantity > pending) {
      throw new Error(`「${item.title}」未核销数量只有 ${pending}，不能核销 ${quantity}`)
    }

    const current = await client.execute({
      sql: 'SELECT stock_quantity, status FROM components WHERE part_number = ?',
      args: [partNumber],
    })
    if (!current.rows.length) throw new Error(`元件 ${partNumber} 不在库存中`)
    const beforeQty = toNumber(current.rows[0].stock_quantity)
    const afterQty = beforeQty + quantity

    const note = entry.note?.trim()
      || `到货核销 · 订单 ${item.order_no}`

    stmts.push({
      sql: "UPDATE components SET stock_quantity = ?, status = 'active', updated_at = ? WHERE part_number = ?",
      args: [afterQty, now, partNumber],
    })
    stmts.push({
      sql: `INSERT INTO transactions
              (part_number, type, quantity, before_qty, after_qty, reference_designator, purchase_price, note, operator)
            VALUES (?, 'in', ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        partNumber,
        quantity,
        beforeQty,
        afterQty,
        entry.referenceDesignator?.trim() || null,
        entry.purchasePrice ?? (item.unit_price == null ? null : Number(item.unit_price)),
        note,
        operator ?? null,
      ],
    })
    stmts.push({
      sql: 'UPDATE purchase_order_items SET consumed_quantity = consumed_quantity + ?, updated_at = ? WHERE id = ?',
      args: [quantity, now, entry.itemId],
    })

    results.push({
      itemId: entry.itemId,
      partNumber,
      title: String(item.title ?? ''),
      quantity,
      beforeQty,
      afterQty,
      remaining: pending - quantity,
    })
  }

  await client.batch(stmts, 'write')

  // 全部核销完的订单自动标记为已签收，避免列表里一直显示「运输中」
  const orderIds = [...new Set(
    (
      await client.execute({
        sql: `SELECT DISTINCT order_id FROM purchase_order_items WHERE id IN (${entries.map(() => '?').join(',')})`,
        args: entries.map((entry) => entry.itemId),
      })
    ).rows.map((row) => Number(row.order_id)),
  )]
  for (const orderId of orderIds) {
    const left = await client.execute({
      sql: 'SELECT COUNT(*) AS c FROM purchase_order_items WHERE order_id = ? AND quantity > consumed_quantity',
      args: [orderId],
    })
    if (toNumber(left.rows[0]?.c) === 0) {
      await client.execute({
        sql: `UPDATE purchase_orders SET shipment_state = 'received', received_at = COALESCE(received_at, ?), updated_at = ?
              WHERE id = ? AND shipment_state <> 'cancelled'`,
        args: [now, now, orderId],
      })
    }
  }

  try {
    const { revalidateTag } = await import('next/cache')
    revalidateTag('inventory', { expire: 0 })
  } catch {
    // 非 Next 运行时（脚本直跑）
  }

  return results
}
