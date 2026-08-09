/**
 * lib/lcsc.ts — 立创商城数据服务封装（服务端专用）
 *
 * 包装 js-port/lcsc-catalog.js，提供：
 *   - 内存 TTL 缓存：型号详情缓存 24h（未命中结果缓存 5min 防风控重试），搜索缓存 1h
 *   - 串行限速：所有真实请求排队执行，间隔 >= REQUEST_GAP_MS，避免触发立创风控
 *   - 失败回退：抓取失败返回 null/空列表，由调用方回退数据库缓存
 *
 * 仅允许在 Node.js 服务端使用（Route Handler / Server Action / Cron），
 * 禁止 import 到客户端组件（'server-only' 会直接报错）。
 */
import 'server-only'
import { LcscCatalogClient } from '../js-port/lcsc-catalog.js'
import type { ComponentDetail, PagedResult } from '../js-port/lcsc-catalog.js'

export type { ComponentDetail, PagedResult }

// ---------------------------------------------------------------------------
// 配置
// ---------------------------------------------------------------------------

/** 真实请求之间的最小间隔（毫秒），防风控 */
const REQUEST_GAP_MS = 800
/** 型号详情缓存时长：24 小时 */
const LOOKUP_TTL_MS = 24 * 60 * 60 * 1000
/** 未命中（null）缓存时长：5 分钟，避免风控期间频繁重试 */
const LOOKUP_MISS_TTL_MS = 5 * 60 * 1000
/** 关键词搜索缓存时长：1 小时 */
const SEARCH_TTL_MS = 60 * 60 * 1000

// ---------------------------------------------------------------------------
// 工具
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T
  expiresAt: number
}

/** 简单的内存 TTL 缓存（服务端单例，进程内有效） */
class TtlCache<T> {
  private map = new Map<string, CacheEntry<T>>()

  get(key: string): T | undefined {
    const entry = this.map.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.map.delete(key)
      return undefined
    }
    return entry.value
  }

  set(key: string, value: T, ttlMs: number): void {
    this.map.set(key, { value, expiresAt: Date.now() + ttlMs })
  }
}

/**
 * 串行限速：把请求放进 promise 链排队，保证两次真实网络请求
 * 之间至少间隔 REQUEST_GAP_MS。内存里同样缓存了限速状态，
 * 所以并发调用（如多用户同时入库）也不会打爆立创。
 */
let lastRequestAt = 0
let requestChain: Promise<unknown> = Promise.resolve()

async function throttle(): Promise<void> {
  const now = Date.now()
  const waitMs = Math.max(0, lastRequestAt + REQUEST_GAP_MS - now)
  lastRequestAt = now + waitMs
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
}

/** 在限速队列中执行一次真实网络请求 */
function throttled<T>(task: () => Promise<T>): Promise<T> {
  const run = requestChain.then(async () => {
    await throttle()
    return task()
  })
  // 链上任何失败都不影响后续请求排队
  requestChain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------------------
// 服务
// ---------------------------------------------------------------------------

class LcscService {
  private client = new LcscCatalogClient()
  private lookupCache = new TtlCache<ComponentDetail | null>()
  private searchCache = new TtlCache<PagedResult>()

  /**
   * 按立创编号查详情。命中缓存直接返回；未命中走限速抓取。
   * 返回 null 表示立创侧未找到或网络失败（调用方应回退数据库缓存）。
   */
  async lookupByPartNumber(partNumber: string): Promise<ComponentDetail | null> {
    const key = partNumber.trim().toUpperCase()
    if (!key) return null

    const cached = this.lookupCache.get(key)
    if (cached !== undefined) return cached

    const detail = await throttled(() => this.client.lookupByPartNumber(key))
    this.lookupCache.set(key, detail, detail ? LOOKUP_TTL_MS : LOOKUP_MISS_TTL_MS)
    return detail
  }

  /**
   * 关键词分页搜索（立创主站真实翻页接口）。失败返回空页，
   * 调用方自行决定是否回退。
   */
  async searchPaged(keyword: string, page = 1, pageSize = 30): Promise<PagedResult> {
    const key = `${keyword.trim()}|${page}|${pageSize}`
    const cached = this.searchCache.get(key)
    if (cached !== undefined) return cached

    const result = await throttled(() => this.client.searchPaged(keyword, page, pageSize))
    if (result.totalCount > 0) {
      this.searchCache.set(key, result, SEARCH_TTL_MS)
    }
    return result
  }

  /** 关键词搜索第 1 页（OCR 选词、MPN 兜底用），与 searchPaged 同缓存 */
  async searchByKeyword(keyword: string): Promise<ComponentDetail[]> {
    const result = await this.searchPaged(keyword, 1, 30)
    return result.items
  }

  /**
   * 强制刷新型号详情：绕过缓存真实抓取，并更新内存缓存。
   * 供「手动刷新」与每日 cron 使用；仍走串行限速。
   */
  async refreshPartNumber(partNumber: string): Promise<ComponentDetail | null> {
    const key = partNumber.trim().toUpperCase()
    if (!key) return null
    const detail = await throttled(() => this.client.lookupByPartNumber(key))
    this.lookupCache.set(key, detail, detail ? LOOKUP_TTL_MS : LOOKUP_MISS_TTL_MS)
    return detail
  }
}

/** 全局单例 */
export const lcsc = new LcscService()
