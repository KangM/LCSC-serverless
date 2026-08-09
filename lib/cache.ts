/**
 * lib/cache.ts — 只读查询的缓存包装（Next 16 Cache Components / `use cache`）
 *
 * 背景：Vercel 生产连远程 Turso，单条查询 ~700ms（冷启动/区域延迟），
 * 每次导航都查库导致切换慢。这里把只读查询包上 30s 缓存：
 *  - 30s 内直接命中缓存（导航不再查库）
 *  - 写操作（出入库/盘点/导入/立创刷新）在 lib/db.ts 内 revalidateTag('inventory') 立即失效
 *
 * 注意：
 *  - 本模块只被 Next 运行时（页面 / API 路由）import；
 *    纯 Node 脚本（scripts/verify-dao.mjs）直接 import lib/db.ts，不经过缓存层。
 *  - 缓存键由参数自动推导（query 对象 / 字符串 / 数字均可序列化）。
 *  - 写路径内部的读（如 stockIn 内 getComponent）用的是 db.ts 原函数，不受缓存影响。
 */
import { cacheLife, cacheTag } from 'next/cache'
import {
  listTransactions as rawListTransactions,
  recentTransactions as rawRecentTransactions,
  dashboardStats as rawDashboardStats,
  listLowStock as rawListLowStock,
  getComponent as rawGetComponent,
  getComponentsByPartNumbers as rawGetComponentsByPartNumbers,
  listComponents as rawListComponents,
  listCategories as rawListCategories,
  listPackageNames as rawListPackageNames,
  valueByCategory as rawValueByCategory,
  valueByPackage as rawValueByPackage,
  dailyFlow as rawDailyFlow,
  topOutgoing as rawTopOutgoing,
} from './db'
import type {
  ComponentQuery,
  ComponentRow,
  DashboardStats,
  Paged,
  TransactionQuery,
  TransactionRow,
} from './db'

/** 30s TTL；60s 后强制同步刷新。写操作通过 revalidateTag('inventory') 即时失效 */
const CACHE_TAG = 'inventory'

export async function listTransactions(query: TransactionQuery = {}): Promise<Paged<TransactionRow>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawListTransactions(query)
}

export async function recentTransactions(limit = 10): Promise<TransactionRow[]> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawRecentTransactions(limit)
}

export async function dashboardStats(): Promise<DashboardStats> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawDashboardStats()
}

export async function listLowStock(limit = 20): Promise<ComponentRow[]> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawListLowStock(limit)
}

export async function getComponent(partNumber: string): Promise<ComponentRow | null> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawGetComponent(partNumber)
}

export async function getComponentsByPartNumbers(partNumbers: string[]): Promise<Map<string, ComponentRow>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawGetComponentsByPartNumbers(partNumbers)
}

export async function listComponents(query: ComponentQuery = {}): Promise<Paged<ComponentRow>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawListComponents(query)
}

export async function listCategories(): Promise<string[]> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawListCategories()
}

export async function listPackageNames(): Promise<string[]> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawListPackageNames()
}

export async function valueByCategory(): Promise<Array<{ category: string; value: number }>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawValueByCategory()
}

export async function valueByPackage(): Promise<Array<{ packageName: string; value: number }>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawValueByPackage()
}

export async function dailyFlow(days = 30): Promise<Array<{ day: string; inQty: number; outQty: number }>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawDailyFlow(days)
}

export async function topOutgoing(limit = 10): Promise<Array<{ partNumber: string; name: string | null; qty: number }>> {
  'use cache'
  cacheLife({ revalidate: 30, expire: 60 })
  cacheTag(CACHE_TAG)
  return rawTopOutgoing(limit)
}
