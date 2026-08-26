/**
 * lcsc-catalog.js 的类型声明（js-port 为纯 JS 模块，这里补充公开 API 类型）。
 * 结构与 lcsc-catalog.js 的 ComponentDetail 一一对应。
 */

export interface ComponentDetail {
  partNumber: string
  mpn: string | null
  name: string | null
  brand: string | null
  packageName: string | null
  category: string | null
  description: string | null
  stockQuantity: number | null
  price: number | null
  productUrl: string | null
  datasheetUrl: string | null
  imageUrl: string | null
  specifications: Record<string, string>
}

export interface PagedResult {
  items: ComponentDetail[]
  page: number
  pageSize: number
  totalCount: number
  totalPages: number
}

export class LcscUpstreamError extends Error {
  readonly code: string
  readonly status?: number
  constructor(code: string, options?: { status?: number })
}

export class LcscCatalogClient {
  constructor(options?: { fetchImpl?: typeof fetch; log?: object })
  searchProducts(keyword: string): Promise<Array<object>>
  searchMatchedProduct(partNumber: string): Promise<object | null>
  lookupByPartNumber(partNumber: string): Promise<ComponentDetail | null>
  searchByKeyword(keyword: string): Promise<ComponentDetail[]>
  searchPaged(keyword: string, page?: number, pageSize?: number): Promise<PagedResult>
  postSearchQuery(keyword: string, page?: number, pageSize?: number): Promise<object>
}
