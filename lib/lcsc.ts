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
import { LcscCatalogClient, LcscUpstreamError } from '../js-port/lcsc-catalog.js'
import type { ComponentDetail, PagedResult } from '../js-port/lcsc-catalog.js'

export type { ComponentDetail, PagedResult }

/** 单次立创查询的服务端耗时拆分，供 API 的 Server-Timing 响应头使用。 */
export interface LcscTiming {
  cache: 'hit' | 'miss'
  queueMs: number
  fetchMs: number
}

export interface LcscFailure {
  code: string
  status?: number
}

export interface TimedLcscResult<T> {
  value: T
  timing: LcscTiming
  failure?: LcscFailure
}

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
 * 启动间隔限速：保证真实请求的启动时间至少相隔 REQUEST_GAP_MS，
 * 但不等待前一个网络请求完成，避免慢上游把后续请求全串行阻塞。
 */
let nextRequestAt = 0
let schedulingLock: Promise<void> = Promise.resolve()

async function throttle(): Promise<void> {
  let release!: () => void
  const previous = schedulingLock
  schedulingLock = new Promise<void>((resolve) => {
    release = resolve
  })
  await previous

  const now = Date.now()
  const waitMs = Math.max(0, nextRequestAt - now)
  nextRequestAt = Math.max(now, nextRequestAt) + REQUEST_GAP_MS
  release()
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs))
}

class TimedTaskError extends Error {
  readonly cause: unknown
  readonly timing: LcscTiming

  constructor(cause: unknown, timing: LcscTiming) {
    super('LCSC 请求失败')
    this.cause = cause
    this.timing = timing
  }
}

/** 在限速队列中执行一次真实网络请求 */
function throttled<T>(task: () => Promise<T>): Promise<TimedLcscResult<T>> {
  const enqueuedAt = performance.now()
  return (async () => {
    await throttle()
    const fetchStartedAt = performance.now()
    try {
      const value = await task()
      return {
        value,
        timing: {
          cache: 'miss' as const,
          queueMs: fetchStartedAt - enqueuedAt,
          fetchMs: performance.now() - fetchStartedAt,
        },
      }
    } catch (error) {
      throw new TimedTaskError(error, {
        cache: 'miss',
        queueMs: fetchStartedAt - enqueuedAt,
        fetchMs: performance.now() - fetchStartedAt,
      })
    }
  })()
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
    return (await this.lookupByPartNumberTimed(partNumber)).value
  }

  /** 与 lookupByPartNumber 相同，但额外返回缓存、排队和上游请求耗时。 */
  async lookupByPartNumberTimed(partNumber: string): Promise<TimedLcscResult<ComponentDetail | null>> {
    const key = partNumber.trim().toUpperCase()
    if (!key) {
      return { value: null, timing: { cache: 'hit', queueMs: 0, fetchMs: 0 } }
    }

    const cached = this.lookupCache.get(key)
    if (cached !== undefined) {
      return { value: cached, timing: { cache: 'hit', queueMs: 0, fetchMs: 0 } }
    }

    const result = await throttled(() => this.client.lookupByPartNumber(key))
    this.lookupCache.set(key, result.value, result.value ? LOOKUP_TTL_MS : LOOKUP_MISS_TTL_MS)
    return result
  }

  /**
   * 关键词分页搜索（立创主站真实翻页接口）。失败返回空页，
   * 调用方自行决定是否回退。
   */
  async searchPaged(keyword: string, page = 1, pageSize = 30): Promise<PagedResult> {
    return (await this.searchPagedTimed(keyword, page, pageSize)).value
  }

  /** 与 searchPaged 相同，但额外返回缓存、排队和上游请求耗时。 */
  async searchPagedTimed(keyword: string, page = 1, pageSize = 30): Promise<TimedLcscResult<PagedResult>> {
    const key = `${keyword.trim()}|${page}|${pageSize}`
    const cached = this.searchCache.get(key)
    if (cached !== undefined) {
      return { value: cached, timing: { cache: 'hit', queueMs: 0, fetchMs: 0 } }
    }

    try {
      const result = await throttled(() => this.client.searchPaged(keyword, page, pageSize))
      if (result.value.totalCount > 0) {
        this.searchCache.set(key, result.value, SEARCH_TTL_MS)
      }
      return result
    } catch (error) {
      const timed = error instanceof TimedTaskError
        ? error
        : new TimedTaskError(error, { cache: 'miss', queueMs: 0, fetchMs: 0 })
      const upstream = timed.cause instanceof LcscUpstreamError ? timed.cause : null
      const failure: LcscFailure = {
        code: upstream?.code ?? 'unknown',
        ...(upstream?.status ? { status: upstream.status } : {}),
      }
      console.warn(`[lcsc] search failure code=${failure.code} status=${failure.status ?? '-'} keyword=${JSON.stringify(keyword)}`)
      return {
        value: { items: [], page, pageSize, totalCount: 0, totalPages: 0 },
        timing: timed.timing,
        failure,
      }
    }
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
    const result = await throttled(() => this.client.lookupByPartNumber(key))
    this.lookupCache.set(key, result.value, result.value ? LOOKUP_TTL_MS : LOOKUP_MISS_TTL_MS)
    return result.value
  }
}

/** 全局单例 */
export const lcsc = new LcscService()
