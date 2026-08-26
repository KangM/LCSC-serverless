/**
 * lib/db.ts — Turso / libSQL 数据访问层（服务端专用）
 *
 * 数据库连接：DATABASE_MODE=sqlite 时使用 SQLITE_DATABASE_PATH；未指定时若有
 * TURSO_DATABASE_URL 则使用 Turso，否则回退到本地 data/inventory.db。
 * 两套都是 libsql 协议，代码完全一致。
 *
 * 库存操作（stockIn / stockOut / adjust）通过 client.batch 把
 * 「改库存 + 写流水」放进同一个原子批次，保证一致性。
 */
import 'server-only'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createClient, type Client } from '@libsql/client'
import type { ComponentDetail } from './lcsc'

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

export interface ComponentRow {
  partNumber: string
  mpn: string | null
  name: string | null
  brand: string | null
  packageName: string | null
  category: string | null
  description: string | null
  price: number | null
  stockQuantity: number
  threshold: number
  productUrl: string | null
  datasheetUrl: string | null
  imageUrl: string | null
  specifications: Record<string, string>
  lastFetchedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface TransactionRow {
  id: number
  partNumber: string
  name: string | null
  type: 'in' | 'out' | 'adjust'
  quantity: number
  beforeQty: number
  afterQty: number
  note: string | null
  operator: string | null
  createdAt: string
}

export interface Paged<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ComponentQuery {
  q?: string
  category?: string
  packageName?: string
  sort?: 'name' | 'brand' | 'package' | 'category' | 'stock' | 'price' | 'updated'
  order?: 'asc' | 'desc'
  page?: number
  pageSize?: number
}

export interface TransactionQuery {
  partNumber?: string
  type?: 'in' | 'out' | 'adjust'
  from?: string
  to?: string
  page?: number
  pageSize?: number
}

// ---------------------------------------------------------------------------
// 连接
// ---------------------------------------------------------------------------

let db: Client | null = null

/**
 * SQLite 必须使用绝对 file URL；相对路径在 Next 打包环境中可能被错误解析。
 * Docker 将 SQLITE_DATABASE_PATH 指向挂载卷中的 /data/inventory.db。
 */
const sqlitePath = path.resolve(process.env.SQLITE_DATABASE_PATH ?? path.join(process.cwd(), 'data/inventory.db'))
const LOCAL_DB_URL = pathToFileURL(sqlitePath).href

function isTursoMode(): boolean {
  if (process.env.DATABASE_MODE === 'sqlite') return false
  if (process.env.DATABASE_MODE === 'turso') return true
  return Boolean(process.env.TURSO_DATABASE_URL)
}

/**
 * 获取数据库客户端（进程内单例）。
 * 打点模式：默认开启，每条 SQL 打 [perf] 日志；设 PERF_LOG=0 关闭。
 */
export function getDb(): Client {
  if (db) return db
  const remote = isTursoMode()
  if (!remote) mkdirSync(path.dirname(sqlitePath), { recursive: true })
  const raw = createClient(
    remote
      ? { url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN }
      : { url: LOCAL_DB_URL },
  )
  if (process.env.PERF_LOG === '0') {
    db = raw
    return db
  }

  // 计时包装：execute / batch 都打耗时日志（诊断导航慢用，成本微秒级）
  const sqlOf = (stmt: unknown): string => {
    if (typeof stmt === 'string') return stmt
    if (Array.isArray(stmt)) return `batch(${stmt.length})`
    if (stmt && typeof stmt === 'object' && 'sql' in stmt) return String((stmt as { sql: unknown }).sql)
    return String(stmt)
  }
  const timed =
    (method: 'execute' | 'batch') =>
    async (...args: unknown[]) => {
      const t0 = performance.now()
      try {
        const r = await (raw[method] as (...a: unknown[]) => Promise<unknown>)(...args)
        const ms = (performance.now() - t0).toFixed(1)
        console.log(`[${new Date().toISOString()}] [perf] db.${method} ${ms}ms ${sqlOf(args[0]).slice(0, 120).replace(/\s+/g, ' ')}`)
        return r
      } catch (e) {
        const ms = (performance.now() - t0).toFixed(1)
        console.log(`[${new Date().toISOString()}] [perf] db.${method} ${ms}ms FAIL ${sqlOf(args[0]).slice(0, 120).replace(/\s+/g, ' ')}`)
        throw e
      }
    }
  db = new Proxy(raw, {
    get(target, prop, receiver) {
      if (prop === 'execute') return timed('execute')
      if (prop === 'batch') return timed('batch')
      return Reflect.get(target, prop, receiver)
    },
  }) as Client
  return db
}

/**
 * 失效只读查询缓存（lib/cache.ts 的 use cache 条目，tag='inventory'）。
 * 仅在 Next 运行时生效；纯 Node 脚本（verify-dao.mjs）直跑本文件时
 * next/cache 解析失败，静默跳过（无缓存可失效）。
 */
async function invalidateCache(): Promise<void> {
  try {
    const { revalidateTag } = await import('next/cache')
    // expire: 0 → 立即过期，下次访问同步取新数据（read-your-own-writes 语义）
    revalidateTag('inventory', { expire: 0 })
  } catch {
    // 非 Next 运行时
  }
}

// ---------------------------------------------------------------------------
// 行映射（snake_case → camelCase）
// ---------------------------------------------------------------------------

type SqlRow = Record<string, unknown>

/** @libsql/client 可绑定的参数值类型 */
type InValue = string | number | bigint | boolean | null | Uint8Array | ArrayBuffer

function mapComponent(row: SqlRow): ComponentRow {
  return {
    partNumber: row.part_number as string,
    mpn: (row.mpn as string) ?? null,
    name: (row.name as string) ?? null,
    brand: (row.brand as string) ?? null,
    packageName: (row.package_name as string) ?? null,
    category: (row.category as string) ?? null,
    description: (row.description as string) ?? null,
    price: row.price == null ? null : Number(row.price),
    stockQuantity: Number(row.stock_quantity ?? 0),
    threshold: Number(row.threshold ?? 0),
    productUrl: (row.product_url as string) ?? null,
    datasheetUrl: (row.datasheet_url as string) ?? null,
    imageUrl: (row.image_url as string) ?? null,
    specifications: parseSpecs(row.specifications as string | null),
    lastFetchedAt: (row.last_fetched_at as string) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function parseSpecs(raw: string | null): Record<string, string> {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, string>)
      : {}
  } catch {
    return {}
  }
}

function mapTransaction(row: SqlRow): TransactionRow {
  return {
    id: Number(row.id),
    partNumber: row.part_number as string,
    name: (row.name as string) ?? null,
    type: row.type as TransactionRow['type'],
    quantity: Number(row.quantity),
    beforeQty: Number(row.before_qty),
    afterQty: Number(row.after_qty),
    note: (row.note as string) ?? null,
    operator: (row.operator as string) ?? null,
    createdAt: row.created_at as string,
  }
}

/** 立创编号规范化：去空白 + 大写 */
export function normalizePartNumber(pn: string): string {
  return pn.trim().toUpperCase()
}

const SORT_COLUMNS: Record<string, string> = {
  name: 'name',
  brand: 'brand',
  package: 'package_name',
  category: 'category',
  stock: 'stock_quantity',
  price: 'price',
  updated: 'updated_at',
}

// ---------------------------------------------------------------------------
// 元件查询
// ---------------------------------------------------------------------------

/** 元件列表：关键词（编号/MPN/名称）+ 分类/封装筛选 + 白名单排序 + 分页 */
export async function listComponents(query: ComponentQuery = {}): Promise<Paged<ComponentRow>> {
  const { q, category, packageName } = query
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20))
  const sortCol = SORT_COLUMNS[query.sort ?? 'updated'] ?? 'updated_at'
  const order = query.order === 'asc' ? 'ASC' : 'DESC'

  const where: string[] = []
  const args: InValue[] = []
  if (q && q.trim()) {
    where.push('(part_number LIKE ? OR mpn LIKE ? OR name LIKE ?)')
    const like = `%${q.trim()}%`
    args.push(like, like, like)
  }
  if (category && category.trim()) {
    where.push('category = ?')
    args.push(category.trim())
  }
  if (packageName && packageName.trim()) {
    where.push('package_name = ?')
    args.push(packageName.trim())
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const client = getDb()
  // 两条语句在同一个 libSQL batch 中执行，避免远程数据库的两次串行往返。
  const [totalResult, rows] = await client.batch(
    [
      {
        sql: `SELECT COUNT(*) AS c FROM components ${whereSql}`,
        args,
      },
      {
        sql: `SELECT * FROM components ${whereSql}
              ORDER BY ${sortCol} ${order}, part_number ASC
              LIMIT ? OFFSET ?`,
        args: [...args, pageSize, (page - 1) * pageSize],
      },
    ],
    'read',
  )
  const total = Number(totalResult.rows[0]?.c ?? 0)

  return {
    items: rows.rows.map(mapComponent),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/** 单个元件详情 */
export async function getComponent(partNumber: string): Promise<ComponentRow | null> {
  const result = await getDb().execute({
    sql: 'SELECT * FROM components WHERE part_number = ?',
    args: [normalizePartNumber(partNumber)],
  })
  return result.rows.length ? mapComponent(result.rows[0]) : null
}

/** 按立创编号批量查询（CSV 导入去重用） */
export async function getComponentsByPartNumbers(
  partNumbers: string[],
): Promise<Map<string, ComponentRow>> {
  const pns = [...new Set(partNumbers.map(normalizePartNumber))].filter(Boolean)
  if (!pns.length) return new Map()
  const placeholders = pns.map(() => '?').join(',')
  const result = await getDb().execute({
    sql: `SELECT * FROM components WHERE part_number IN (${placeholders})`,
    args: pns,
  })
  return new Map(result.rows.map((row) => {
    const item = mapComponent(row)
    return [item.partNumber, item]
  }))
}

/** 元件表中出现的全部分类（筛选下拉用） */
export async function listCategories(): Promise<string[]> {
  const result = await getDb().execute({
    sql: "SELECT DISTINCT category FROM components WHERE category IS NOT NULL AND category != '' ORDER BY category",
  })
  return result.rows.map((row) => row.category as string)
}

/** 元件表中出现的全部封装（筛选下拉用） */
export async function listPackageNames(): Promise<string[]> {
  const result = await getDb().execute({
    sql: "SELECT DISTINCT package_name FROM components WHERE package_name IS NOT NULL AND package_name != '' ORDER BY package_name",
  })
  return result.rows.map((row) => row.package_name as string)
}

// ---------------------------------------------------------------------------
// 元件写入
// ---------------------------------------------------------------------------

/** 从立创详情创建/更新元件静态信息（不动库存），返回受影响行数 */
export async function upsertComponentFromLcsc(detail: ComponentDetail): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO components (
            part_number, mpn, name, brand, package_name, category, description,
            price, product_url, datasheet_url, image_url, specifications, last_fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(part_number) DO UPDATE SET
            mpn = excluded.mpn, name = excluded.name, brand = excluded.brand,
            package_name = excluded.package_name, category = excluded.category,
            description = excluded.description, price = excluded.price,
            product_url = excluded.product_url, datasheet_url = excluded.datasheet_url,
            image_url = excluded.image_url, specifications = excluded.specifications,
            last_fetched_at = excluded.last_fetched_at, updated_at = excluded.updated_at`,
    args: [
      normalizePartNumber(detail.partNumber),
      detail.mpn,
      detail.name,
      detail.brand,
      detail.packageName,
      detail.category,
      detail.description,
      detail.price,
      detail.productUrl,
      detail.datasheetUrl,
      detail.imageUrl,
      JSON.stringify(detail.specifications ?? {}),
      new Date().toISOString(),
    ],
  })
  await invalidateCache()
}

/** 修改低库存预警阈值 */
export async function setThreshold(partNumber: string, threshold: number): Promise<void> {
  await getDb().execute({
    sql: 'UPDATE components SET threshold = ?, updated_at = ? WHERE part_number = ?',
    args: [Math.max(0, Math.trunc(threshold)), new Date().toISOString(), normalizePartNumber(partNumber)],
  })
  await invalidateCache()
}

// ---------------------------------------------------------------------------
// 库存操作（原子批次：改库存 + 写流水）
// ---------------------------------------------------------------------------

/**
 * 入库：元件不存在且有立创详情时先建行，再增加库存并写流水。
 * @param detail 立创详情（新建元件时必传；已存在时传 null 只加数量）
 */
export async function stockIn(
  partNumber: string,
  quantity: number,
  options: { detail?: ComponentDetail | null; note?: string; operator?: string } = {},
): Promise<ComponentRow> {
  const pn = normalizePartNumber(partNumber)
  const qty = Math.max(1, Math.trunc(quantity))
  const client = getDb()

  const existing = await getComponent(pn)
  const stmts: Parameters<Client['batch']>[0] = []

  if (!existing) {
    const detail = options.detail
    if (!detail) throw new Error(`元件 ${pn} 不存在且未提供立创详情，无法入库`)
    stmts.push({
      sql: `INSERT INTO components (
              part_number, mpn, name, brand, package_name, category, description,
              price, product_url, datasheet_url, image_url, specifications, last_fetched_at,
              stock_quantity
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        pn, detail.mpn, detail.name, detail.brand, detail.packageName, detail.category,
        detail.description, detail.price, detail.productUrl, detail.datasheetUrl,
        detail.imageUrl, JSON.stringify(detail.specifications ?? {}),
        new Date().toISOString(), qty,
      ],
    })
  } else {
    stmts.push({
      sql: 'UPDATE components SET stock_quantity = stock_quantity + ?, updated_at = ? WHERE part_number = ?',
      args: [qty, new Date().toISOString(), pn],
    })
  }

  const beforeQty = existing?.stockQuantity ?? 0
  stmts.push({
    sql: `INSERT INTO transactions (part_number, type, quantity, before_qty, after_qty, note, operator)
          VALUES (?, 'in', ?, ?, ?, ?, ?)`,
    args: [pn, qty, beforeQty, beforeQty + qty, options.note ?? null, options.operator ?? null],
  })

  await client.batch(stmts, 'write')
  await invalidateCache()
  return (await getComponent(pn))!
}

/**
 * 出库：校验库存足够后扣减并写流水。
 * 注意：先读后写未加行锁，个人单用户场景可接受；如需强并发可改用
 * `UPDATE ... WHERE stock_quantity >= ?` 并用 rowsAffected 判断。
 */
export async function stockOut(
  partNumber: string,
  quantity: number,
  options: { note?: string; operator?: string } = {},
): Promise<ComponentRow> {
  const pn = normalizePartNumber(partNumber)
  const qty = Math.max(1, Math.trunc(quantity))
  const client = getDb()

  const existing = await getComponent(pn)
  if (!existing) throw new Error(`元件 ${pn} 不在库存中`)
  if (existing.stockQuantity < qty) {
    throw new Error(`库存不足：当前 ${existing.stockQuantity}，需要 ${qty}`)
  }

  const afterQty = existing.stockQuantity - qty
  await client.batch(
    [
      {
        sql: 'UPDATE components SET stock_quantity = ?, updated_at = ? WHERE part_number = ?',
        args: [afterQty, new Date().toISOString(), pn],
      },
      {
        sql: `INSERT INTO transactions (part_number, type, quantity, before_qty, after_qty, note, operator)
              VALUES (?, 'out', ?, ?, ?, ?, ?)`,
        args: [pn, qty, existing.stockQuantity, afterQty, options.note ?? null, options.operator ?? null],
      },
    ],
    'write',
  )
  await invalidateCache()
  return (await getComponent(pn))!
}

/**
 * 盘点：把库存修正为实点数，差额写入流水（正=盘盈，负=盘亏）。
 */
export async function adjustStock(
  partNumber: string,
  actualQuantity: number,
  options: { note?: string; operator?: string } = {},
): Promise<ComponentRow> {
  const pn = normalizePartNumber(partNumber)
  const actual = Math.max(0, Math.trunc(actualQuantity))
  const client = getDb()

  const existing = await getComponent(pn)
  if (!existing) throw new Error(`元件 ${pn} 不在库存中`)

  const diff = actual - existing.stockQuantity
  await client.batch(
    [
      {
        sql: 'UPDATE components SET stock_quantity = ?, updated_at = ? WHERE part_number = ?',
        args: [actual, new Date().toISOString(), pn],
      },
      {
        sql: `INSERT INTO transactions (part_number, type, quantity, before_qty, after_qty, note, operator)
              VALUES (?, 'adjust', ?, ?, ?, ?, ?)`,
        args: [pn, diff, existing.stockQuantity, actual, options.note ?? null, options.operator ?? null],
      },
    ],
    'write',
  )
  await invalidateCache()
  return (await getComponent(pn))!
}

// ---------------------------------------------------------------------------
// 流水查询
// ---------------------------------------------------------------------------

/** 流水列表：按元件/类型/时间筛选 + 分页 */
export async function listTransactions(query: TransactionQuery = {}): Promise<Paged<TransactionRow>> {
  const page = Math.max(1, query.page ?? 1)
  const pageSize = Math.min(200, Math.max(1, query.pageSize ?? 20))

  const where: string[] = []
  const args: InValue[] = []
  if (query.partNumber && query.partNumber.trim()) {
    where.push('t.part_number = ?')
    args.push(normalizePartNumber(query.partNumber))
  }
  if (query.type) {
    where.push('type = ?')
    args.push(query.type)
  }
  if (query.from) {
    // from 传 UTC ISO（如 2026-08-10T00:00:00.000Z）精确比较；纯日期按 UTC 零点兼容
    where.push('t.created_at >= ?')
    args.push(query.from)
  }
  if (query.to) {
    // to 传本地当天 23:59:59.999 转换出的 UTC ISO 即可精确包含当天；
    // 兼容纯日期（'2026-08-09' 是 '2026-08-09T16:22:23.862Z' 前缀，直接 <= 会漏当天，改用次日零点）
    const toValue = /^\d{4}-\d{2}-\d{2}$/.test(query.to)
      ? `${query.to}T23:59:59.999Z`
      : query.to
    where.push('t.created_at <= ?')
    args.push(toValue)
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : ''

  const client = getDb()
  // 一条 SQL 同时返回分页数据与总数（窗口函数），避免 COUNT + SELECT 两次远程往返
  const rows = await client.execute({
    sql: `SELECT t.*, c.name AS name, COUNT(*) OVER() AS _total FROM transactions t
          LEFT JOIN components c ON c.part_number = t.part_number
          ${whereSql} ORDER BY t.id DESC LIMIT ? OFFSET ?`,
    args: [...args, pageSize, (page - 1) * pageSize],
  })
  const total = Number(rows.rows[0]?._total ?? 0)

  return {
    items: rows.rows.map(mapTransaction),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  }
}

/** 最近 N 条流水（仪表盘用） */
export async function recentTransactions(limit = 10): Promise<TransactionRow[]> {
  const result = await getDb().execute({
    sql: 'SELECT t.*, c.name AS name FROM transactions t\n          LEFT JOIN components c ON c.part_number = t.part_number\n          ORDER BY t.id DESC LIMIT ?',
    args: [limit],
  })
  return result.rows.map(mapTransaction)
}

// ---------------------------------------------------------------------------
// 统计（仪表盘 / 报表）
// ---------------------------------------------------------------------------

export interface DashboardStats {
  totalComponents: number
  totalStock: number
  totalValue: number
  lowStockCount: number
}

/** 仪表盘汇总指标 */
export async function dashboardStats(): Promise<DashboardStats> {
  const result = await getDb().execute(
    `SELECT
       COUNT(*) AS total_components,
       COALESCE(SUM(stock_quantity), 0) AS total_stock,
       COALESCE(SUM(stock_quantity * COALESCE(price, 0)), 0) AS total_value,
       COALESCE(SUM(CASE WHEN threshold > 0 AND stock_quantity <= threshold THEN 1 ELSE 0 END), 0) AS low_count
     FROM components`,
  )
  const r = result.rows[0]
  return {
    totalComponents: Number(r?.total_components ?? 0),
    totalStock: Number(r?.total_stock ?? 0),
    totalValue: Number(r?.total_value ?? 0),
    lowStockCount: Number(r?.low_count ?? 0),
  }
}

/** 低库存元件列表（缺口最小的排最前，即最紧急） */
export async function listLowStock(limit = 20): Promise<ComponentRow[]> {
  const result = await getDb().execute({
    sql: `SELECT * FROM components
          WHERE threshold > 0 AND stock_quantity <= threshold
          ORDER BY (stock_quantity - threshold) ASC, part_number ASC
          LIMIT ?`,
    args: [limit],
  })
  return result.rows.map(mapComponent)
}

/** 库存价值按分类分布（报表饼图） */
export async function valueByCategory(): Promise<Array<{ category: string; value: number }>> {
  const result = await getDb().execute(
    `SELECT COALESCE(NULLIF(category, ''), '未分类') AS category,
            SUM(stock_quantity * COALESCE(price, 0)) AS value
     FROM components
     GROUP BY category
     ORDER BY value DESC`,
  )
  return result.rows.map((r) => ({ category: r.category as string, value: Number(r.value ?? 0) }))
}

/** 库存价值按封装分布（报表饼图） */
export async function valueByPackage(): Promise<Array<{ packageName: string; value: number }>> {
  const result = await getDb().execute(
    `SELECT COALESCE(NULLIF(package_name, ''), '未标注') AS package_name,
            SUM(stock_quantity * COALESCE(price, 0)) AS value
     FROM components
     GROUP BY package_name
     ORDER BY value DESC`,
  )
  return result.rows.map((r) => ({ packageName: r.package_name as string, value: Number(r.value ?? 0) }))
}

/** 近 N 天每日出入库数量（报表趋势线） */
export async function dailyFlow(
  days = 30,
): Promise<Array<{ day: string; inQty: number; outQty: number }>> {
  const result = await getDb().execute({
    sql: `SELECT substr(created_at, 1, 10) AS day, type, SUM(quantity) AS qty
          FROM transactions
          WHERE created_at >= datetime('now', ?)
          GROUP BY day, type
          ORDER BY day`,
    args: [`-${days} days`],
  })

  const map = new Map<string, { day: string; inQty: number; outQty: number }>()
  for (const r of result.rows) {
    const day = r.day as string
    const entry = map.get(day) ?? { day, inQty: 0, outQty: 0 }
    if (r.type === 'in') entry.inQty = Number(r.qty ?? 0)
    if (r.type === 'out') entry.outQty = Number(r.qty ?? 0)
    map.set(day, entry)
  }
  // 补齐中间空档日期（便于折线连续）
  const out: Array<{ day: string; inQty: number; outQty: number }> = []
  const today = new Date()
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today)
    d.setDate(today.getDate() - i)
    const key = d.toISOString().slice(0, 10)
    out.push(map.get(key) ?? { day: key, inQty: 0, outQty: 0 })
  }
  return out
}

/** 热门元件 TOP N（按出库数量，报表条形图） */
export async function topOutgoing(limit = 10): Promise<Array<{ partNumber: string; name: string | null; qty: number }>> {
  const result = await getDb().execute({
    sql: `SELECT t.part_number, c.name AS name, SUM(t.quantity) AS qty
          FROM transactions t
          LEFT JOIN components c ON c.part_number = t.part_number
          WHERE t.type = 'out'
          GROUP BY t.part_number
          ORDER BY qty DESC
          LIMIT ?`,
    args: [limit],
  })
  return result.rows.map((r) => ({
    partNumber: r.part_number as string,
    name: (r.name as string) ?? null,
    qty: Number(r.qty ?? 0),
  }))
}

// ---------------------------------------------------------------------------
// 设置（KV）
// ---------------------------------------------------------------------------

export async function getSetting(key: string): Promise<string | null> {
  const result = await getDb().execute({
    sql: 'SELECT value FROM settings WHERE key = ?',
    args: [key],
  })
  return result.rows.length ? (result.rows[0].value as string) : null
}

export async function setSetting(key: string, value: string | null): Promise<void> {
  if (value === null || value === '') {
    await getDb().execute({ sql: 'DELETE FROM settings WHERE key = ?', args: [key] })
    return
  }
  await getDb().execute({
    sql: `INSERT INTO settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    args: [key, value],
  })
}
