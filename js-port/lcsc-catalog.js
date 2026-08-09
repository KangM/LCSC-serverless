/**
 * lcsc-catalog.js — 立创商城(LCSC)搜索数据抓取 + 解析
 *
 * 从 Android 项目 LCSC_android_erp 的 Kotlin 实现移植（1:1 逻辑）：
 *   - data/remote/LcscCatalogRemoteDataSource.kt   (HTTP 抓取 / 203 验证 Cookie / __NEXT_DATA__ 提取)
 *   - data/repository/LcscCatalogRepositoryImpl.kt (原始 JSON → ComponentDetail 领域模型)
 *
 * 原理（无官方 API）：
 *   1. 以浏览器 UA 请求 https://so.szlcsc.com/global.html?k=<关键词>
 *   2. 该页面是 Next.js 应用，数据内嵌在 <script id="__NEXT_DATA__"> 里
 *   3. 取脚本内容 JSON.parse，数据路径：props.pageProps.soData.searchResult.productRecordList
 *   4. 若返回 203 且页面带验证 token（_xvasu 等），现场用 RC4+Base64 构造验证 Cookie 重试一次
 *
 * 环境要求：Node.js >= 18（全局 fetch）或现代浏览器。零依赖、ESM。
 * 用法见 js-port/README.md
 */

// ---------------------------------------------------------------------------
// 常量（与 Kotlin 保持一致）
// ---------------------------------------------------------------------------

const SEARCH_URL = 'https://so.szlcsc.com/global.html'
const SEARCH_API_URL = 'https://so.szlcsc.com/query/product' // 主站真实搜索/翻页接口（POST JSON）
const REFERER_URL = 'https://so.szlcsc.com/'
const VERIFICATION_KEY = 'tg09It3*9h'
const VERIFICATION_TOKENS = ['_xvasu', '_xvtsc', '_xvpfs', '_xvpts']
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
const PACKAGE_PARAMETER_KEYS = [
  '封装', '封装规格', '商品封装', '安装类型',
  'Package', 'Package / Case', 'Case', 'Footprint',
]

// ---------------------------------------------------------------------------
// 客户端
// ---------------------------------------------------------------------------

export class LcscCatalogClient {
  /**
   * @param {object} [options]
   * @param {typeof fetch} [options.fetchImpl] 自定义 fetch（便于测试/代理），默认全局 fetch
   * @param {object} [options.log] 日志对象，默认 console
   */
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || globalThis.fetch
    this.log = options.log || console
    if (typeof this.fetchImpl !== 'function') {
      throw new Error('当前环境没有 fetch：请使用 Node.js >= 18 或浏览器，或通过 options.fetchImpl 注入')
    }
  }

  /**
   * 搜索商品，返回原始商品记录数组（productRecordList 的每一项）。
   * 对应 Kotlin: LcscCatalogRemoteDataSource.searchProducts
   * @param {string} keyword
   * @returns {Promise<Array<object>>}
   */
  async searchProducts(keyword) {
    const url = new URL(SEARCH_URL)
    url.searchParams.set('k', keyword)
    const root = await this.fetchNextData(url.toString())
    if (!root) return []
    const recordList = root?.props?.pageProps?.soData?.searchResult?.productRecordList
    return Array.isArray(recordList) ? recordList : []
  }

  /**
   * 按完整型号精确匹配（productCode 与输入 trim+大写 后相等），返回原始记录或 null。
   * 对应 Kotlin: LcscCatalogRemoteDataSource.searchMatchedProduct
   * @param {string} partNumber
   * @returns {Promise<object|null>}
   */
  async searchMatchedProduct(partNumber) {
    const normalized = partNumber.trim().toUpperCase()
    const records = await this.searchProducts(partNumber)
    for (const record of records) {
      const productCode = optStringOrNull(record?.productVO, 'productCode')
      if (productCode && productCode.trim().toUpperCase() === normalized) {
        return record
      }
    }
    return null
  }

  /**
   * 按型号查询，直接返回解析后的 ComponentDetail（未命中返回 null）。
   * 对应 Kotlin: LcscCatalogRepository.lookupByPartNumber
   * @param {string} partNumber
   * @returns {Promise<object|null>}
   */
  async lookupByPartNumber(partNumber) {
    const searchRecord = await this.searchMatchedProduct(partNumber)
    if (!searchRecord) return null
    const product = asObject(searchRecord.productVO)
    if (!product) return null
    const detail = buildComponentDetail(searchRecord, product, 'exact')
    this.log.debug?.('[lcsc] lookupByPartNumber:', partNumber, '->', detail.partNumber, detail.name)
    return detail
  }

  /**
   * 关键词搜索，返回解析后的 ComponentDetail 列表（第 1 页）。
   * 对应 Kotlin: LcscCatalogRepository.searchByKeyword
   * @param {string} keyword
   * @returns {Promise<Array<object>>}
   */
  async searchByKeyword(keyword) {
    const records = await this.searchProducts(keyword)
    const results = []
    for (const searchRecord of records) {
      const product = asObject(searchRecord.productVO)
      if (!product) continue
      results.push(buildComponentDetail(searchRecord, product, 'search'))
    }
    return results
  }

  /**
   * 分页搜索（POST /query/product，主站真实翻页接口）。
   * 返回 { items, page, pageSize, totalCount, totalPages }，items 为 ComponentDetail 列表。
   * 与 searchByKeyword 的元素结构完全同构（productVO + light* + paramLinkedMap），
   * 因此复用 buildComponentDetail 解析。
   * @param {string} keyword
   * @param {number} [page=1] 页码，从 1 开始
   * @param {number} [pageSize=30] 每页条数（站点默认 30）
   * @returns {Promise<{items: object[], page: number, pageSize: number, totalCount: number, totalPages: number}>}
   */
  async searchPaged(keyword, page = 1, pageSize = 30) {
    const data = await this.postSearchQuery(keyword, page, pageSize)
    if (!data) return emptyPage(page, pageSize)
    const searchResult = asObject(asObject(data.result)?.searchResult)
    const records = asArray(searchResult?.productRecordList) ?? []
    const items = []
    for (const searchRecord of records) {
      const product = asObject(searchRecord?.productVO)
      if (!product) continue
      items.push(buildComponentDetail(searchRecord, product, 'search'))
    }
    return {
      items,
      page: searchResult?.currePage ?? page,
      pageSize: searchResult?.pageSize ?? pageSize,
      totalCount: searchResult?.totalCount ?? 0,
      totalPages: searchResult?.countPage ?? 0,
    }
  }

  /**
   * POST 主站搜索接口，返回原始 JSON（含 203 验证页自动重试）。
   * 请求体字段照搬站点前端（spotFilter/discountFilter 等筛选参数）。
   * @returns {Promise<object|null>} { code, result: { searchResult: { productRecordList } } }
   */
  async postSearchQuery(keyword, page = 1, pageSize = 30) {
    const body = JSON.stringify({
      currentPage: page,
      pageSize,
      catalogIdFilter: '',
      brandIdFilter: '',
      standardFilter: '',
      arrangeFilter: '',
      labelFilter: '',
      authenticationFilter: '',
      keyword,
      sortNumber: 0,
      satisfyStockType: '',
      startPrice: '',
      endPrice: '',
      demandNumber: '',
      spotFilter: 1,
      discountFilter: 1,
      hasDataFile: false,
      brandPlaceFilter: '',
      secondKeyword: '',
      queryParameterValue: '',
      lastParamName: '',
    })
    const headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'origin': 'https://so.szlcsc.com',
      'referer': `${SEARCH_URL}?k=${encodeURIComponent(keyword)}`,
      'User-Agent': CHROME_USER_AGENT,
    }
    try {
      let response = await this.fetchImpl(SEARCH_API_URL, { method: 'POST', headers, body })
      let text = await response.text()
      // 防御：203 验证页或返回 HTML 验证页时，构造验证 Cookie 重试一次
      if (response.status === 203 || !text.trim().startsWith('{')) {
        const cookie = buildVerificationCookie(text)
        if (!cookie) {
          this.log.warn?.('[lcsc] POST /query/product 验证 Cookie 解析失败')
          return null
        }
        headers['Cookie'] = cookie
        response = await this.fetchImpl(SEARCH_API_URL, { method: 'POST', headers, body })
        text = await response.text()
      }
      if (!response.ok) {
        this.log.warn?.('[lcsc] POST /query/product HTTP 失败:', response.status)
        return null
      }
      const data = JSON.parse(text)
      if (data?.code !== 200) {
        this.log.warn?.('[lcsc] POST /query/product code != 200:', data?.code, data?.msg)
        return null
      }
      return data
    } catch (error) {
      this.log.warn?.('[lcsc] POST /query/product 失败:', error)
      return null
    }
  }

  // -- 内部：抓取 -----------------------------------------------------------

  /**
   * 抓取页面并解析 __NEXT_DATA__。带 203 验证页自动重试。
   * 对应 Kotlin: fetchNextData
   * @param {string} url
   * @returns {Promise<object|null>} __NEXT_DATA__ 的 JSON 根对象
   */
  async fetchNextData(url) {
    try {
      let result = await this.fetchHtml(url)
      if (!result) return null

      if (result.statusCode === 203 && looksLikeVerificationPage(result.html)) {
        const verificationCookie = buildVerificationCookie(result.html)
        if (!verificationCookie) {
          this.log.warn?.('[lcsc] 验证 Cookie 解析失败:', url)
          return null
        }
        result = await this.fetchHtml(url, verificationCookie)
        if (!result) return null
      }

      return parseNextData(url, result.statusCode, result.html)
    } catch (error) {
      this.log.warn?.('[lcsc] 抓取失败:', url, error)
      return null
    }
  }

  /**
   * 请求 HTML。返回 { statusCode, html }，非 2xx 或空 body 返回 null。
   * 对应 Kotlin: fetchHtml
   * @param {string} url
   * @param {string|null} [cookie] 可选，验证 Cookie
   */
  async fetchHtml(url, cookie = null) {
    const headers = {
      'User-Agent': CHROME_USER_AGENT,
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      'Pragma': 'no-cache',
      'Referer': REFERER_URL,
    }
    if (cookie) headers['Cookie'] = cookie

    const response = await this.fetchImpl(url, { headers })
    // fetch 的 ok 为 200-299（包含 203），与 OkHttp isSuccessful 一致
    if (!response.ok) {
      this.log.warn?.('[lcsc] HTTP 失败:', response.status, url)
      return null
    }
    const html = await response.text()
    if (!html || !html.trim()) {
      this.log.warn?.('[lcsc] 空响应体:', response.status, url)
      return null
    }
    return { statusCode: response.status, html }
  }
}

// ---------------------------------------------------------------------------
// __NEXT_DATA__ 解析
// ---------------------------------------------------------------------------

/**
 * 从 HTML 提取 <script id="__NEXT_DATA__"> 内容并解析为 JSON。
 * 对应 Kotlin: parseNextData
 */
function parseNextData(url, statusCode, html) {
  const match = html.match(/<script[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)
  if (!match) {
    console.warn(`[lcsc] 缺少 __NEXT_DATA__: code=${statusCode}, url=${url}, preview=${html.slice(0, 200)}`)
    return null
  }
  const root = JSON.parse(match[1]) // 解析失败由上层 catch
  const recordCount = root?.props?.pageProps?.soData?.searchResult?.productRecordList?.length ?? 0
  console.debug(`[lcsc] 解析成功: code=${statusCode}, url=${url}, productCount=${recordCount}`)
  return root
}

// ---------------------------------------------------------------------------
// 203 验证页处理（对应 Kotlin 的 Verification 相关方法）
// ---------------------------------------------------------------------------

function looksLikeVerificationPage(html) {
  return VERIFICATION_TOKENS.some((token) => html.includes(token))
}

/**
 * 从验证页构造 Cookie：解析 _xvasu/_xvpts/_xvpfs 三个 JS 变量，
 * 用 RC4(密钥, "xvpts:xvasu") 加密后 Base64，cookie 名 = xvpfs + xvasu。
 * 对应 Kotlin: buildVerificationCookie
 */
function buildVerificationCookie(html) {
  const xvasu = extractJavascriptVariable(html, '_xvasu')
  const xvpts = extractJavascriptVariable(html, '_xvpts')
  const xvpfs = extractJavascriptVariable(html, '_xvpfs')
  if (xvasu === null || xvpts === null || xvpfs === null) return null

  const cookieName = xvpfs + xvasu
  const encrypted = rc4(VERIFICATION_KEY, `${xvpts}:${xvasu}`)
  const cookieValue = toBase64(encrypted)
  return `${cookieName}=${cookieValue}`
}

function extractJavascriptVariable(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp(`var\\s+${escaped}\\s*=\\s*(.+?);`).exec(html)
  if (!match) return null
  return match[1]
    .trim()
    .replace(/^["']|["']$/g, '') // removeSurrounding(") / removeSurrounding(')
}

/**
 * RC4 加密（与 Kotlin 实现逐字节一致，XOR 流密钥）。
 * 输入输出均按 UTF-8 编码；真实数据（时间戳/随机串）均为 ASCII。
 * 对应 Kotlin: rc4
 * @param {string} key
 * @param {string} value
 * @returns {Uint8Array}
 */
function rc4(key, value) {
  const keyBytes = new TextEncoder().encode(key)
  const valueBytes = new TextEncoder().encode(value)

  const state = new Uint8Array(256)
  for (let i = 0; i < 256; i++) state[i] = i

  let b = 0
  for (let a = 0; a < 256; a++) {
    b = (b + state[a] + keyBytes[a % keyBytes.length]) % 256
    const tmp = state[a]
    state[a] = state[b]
    state[b] = tmp
  }

  let a = 0
  b = 0
  const output = new Uint8Array(valueBytes.length)
  for (let i = 0; i < valueBytes.length; i++) {
    a = (a + 1) % 256
    b = (b + state[a]) % 256
    const tmp = state[a]
    state[a] = state[b]
    state[b] = tmp
    output[i] = valueBytes[i] ^ state[(state[a] + state[b]) % 256]
  }
  return output
}

function toBase64(bytes) {
  const binary = String.fromCharCode(...bytes)
  if (typeof btoa === 'function') return btoa(binary) // 浏览器
  return Buffer.from(binary, 'binary').toString('base64') // Node.js
}

// ---------------------------------------------------------------------------
// 原始 JSON → ComponentDetail（对应 Kotlin: LcscCatalogRepositoryImpl）
// ---------------------------------------------------------------------------

/**
 * 把一个搜索记录(productRecordList 项) + productVO 解析成领域对象。
 * 对应 Kotlin: buildComponentDetail
 * @param {object} searchRecord
 * @param {object} product productVO
 * @param {'exact'|'search'} nameStrategy 原 Kotlin 中两个分支行为一致，保留参数以示对应
 * @returns {object} ComponentDetail 结构
 */
function buildComponentDetail(searchRecord, product, nameStrategy = 'search') {
  // paramLinkedMap → specifications（key/value 都做 sanitize，空值剔除）
  const searchParams = {}
  const paramLinkedMap = asObject(searchRecord?.paramLinkedMap)
  if (paramLinkedMap) {
    for (const key of Object.keys(paramLinkedMap)) {
      const normalizedKey = sanitizeSearchText(key) // key 恒为字符串
      const normalizedValue = sanitizeSearchText(paramLinkedMap[key])
      if (normalizedKey !== null && normalizedValue !== null) {
        searchParams[normalizedKey] = normalizedValue
      }
    }
  }

  const datasheetUrl = extractDatasheetUrlFromSearch(product)

  const productId = optStringOrNull(product, 'productId')
  const productUrl = productId ? `https://item.szlcsc.com/${productId}.html` : null

  const priceList = asArray(product.productPriceList)
  const firstPrice = priceList && priceList.length > 0
    ? optDoubleOrNull(priceList[0], 'productPrice')
    : null

  const category = sanitizeSearchText(searchRecord?.lightCatalogName)
    ?? sanitizeSearchText(product.productType)

  const lightProductModel = sanitizeSearchText(searchRecord?.lightProductModel)
  const productModel = sanitizeSearchText(product.productModel)
  const lightProductName = sanitizeSearchText(searchRecord?.lightProductName)
  const productName = sanitizeSearchText(product.productName)

  // Kotlin 的 ExactPartNumber / SearchResult 两个分支完全相同，这里合并
  const normalizedName = lightProductModel
    ?? productModel
    ?? normalizeDisplayName(
      lightProductName ?? productName,
      category,
      Object.values(searchParams),
    )

  return {
    partNumber: optString(product, 'productCode').trim(),
    mpn: productModel,
    name: normalizedName,
    brand: sanitizeSearchText(searchRecord?.lightBrandName)
      ?? sanitizeSearchText(product.productGradePlateName),
    packageName: sanitizeSearchText(searchRecord?.lightStandard)
      ?? sanitizeSearchText(product.encapsulationModel)
      ?? extractPackageNameFromSearchParams(searchParams),
    category,
    description: sanitizeSearchText(product.remark)
      ?? sanitizeSearchText(searchRecord?.lightProductIntro),
    stockQuantity: optIntOrNull(product, 'stockNumber')
      ?? optIntOrNull(product, 'validStockNumber'),
    price: firstPrice,
    productUrl,
    datasheetUrl,
    imageUrl: optStringOrNull(product, 'breviaryImageUrl'),
    specifications: searchParams,
    // 注: 原 Kotlin 模型还有 imageLocalPath（Android 本地图片持久化），JS 端无此概念已省略
  }
}

/**
 * 从搜索参数里提取封装。精确命中 key，或 key 包含候选词。
 * 对应 Kotlin: extractPackageNameFromSearchParams
 */
function extractPackageNameFromSearchParams(searchParams) {
  for (const [key, value] of Object.entries(searchParams)) {
    if (PACKAGE_PARAMETER_KEYS.includes(key.trim()) && value && value.trim()) {
      return value
    }
  }
  for (const [key, value] of Object.entries(searchParams)) {
    const normalizedKey = key.trim().toLowerCase()
    if (PACKAGE_PARAMETER_KEYS.some((candidate) => normalizedKey.includes(candidate.toLowerCase()))) {
      if (value && value.trim()) return value
    }
  }
  return null
}

/**
 * 从搜索参数值中剔除型号/规格，得到通用商品名。
 * 对应 Kotlin: normalizeDisplayName
 */
function normalizeDisplayName(rawName, fallbackName, extractedSpecs) {
  const baseName = typeof rawName === 'string' && rawName.trim() ? rawName : null
  if (!baseName) return fallbackName ?? null

  let candidate = baseName
  extractedSpecs
    .filter((spec) => spec && spec.trim())
    .sort((a, b) => b.length - a.length)
    .forEach((specValue) => {
      candidate = candidate.split(specValue).join(' ') // Kotlin replace() 替换全部
    })

  candidate = candidate.replace(/\s+/g, ' ').trim()
  return candidate || fallbackName || baseName
}

/**
 * 数据手册链接：fileTypeVOList[].detailVOList[0].fileUrl → https://atta.szlcsc.com<path>
 * 对应 Kotlin: extractDatasheetUrlFromSearch
 */
function extractDatasheetUrlFromSearch(product) {
  const fileGroups = asArray(product.fileTypeVOList)
  if (!fileGroups) return null
  for (const fileGroup of fileGroups) {
    const details = asArray(fileGroup?.detailVOList)
    if (!details) continue
    const filePath = optStringOrNull(details[0], 'fileUrl')
    if (filePath) return `https://atta.szlcsc.com${filePath}`
  }
  return null
}

// ---------------------------------------------------------------------------
// 文本清洗与 JSON 取值辅助（对应 Kotlin 文件底部的 opt* 扩展 + sanitizeSearchText）
// ---------------------------------------------------------------------------

/**
 * 清洗搜索文本：去 HTML 标签、解码实体、压缩空白。
 * 对应 Kotlin: sanitizeSearchText（Jsoup.parse(it).text() 的轻量近似）
 */
function sanitizeSearchText(value) {
  const s = toOptString(value)
  if (!s.trim()) return null
  let text = s.replace(/<[^>]*>/g, ' ') // 先剥真实标签，避免 &lt; 被误当标签
  text = decodeHtmlEntities(text)
  text = text.replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return text || null
}

/** 轻量 HTML 实体解码（常用命名实体 + 数字/十六进制实体） */
function decodeHtmlEntities(text) {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1] === 'x' || entity[1] === 'X'
      const code = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isNaN(code) ? match : String.fromCodePoint(code)
    }
    return Object.prototype.hasOwnProperty.call(NAMED_ENTITIES, entity) ? NAMED_ENTITIES[entity] : match
  })
}

const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  copy: '©', reg: '®', trade: '™', mdash: '—', ndash: '–',
  hellip: '…', times: '×', divide: '÷', plusmn: '±', micro: 'µ',
  deg: '°', middot: '·', bull: '•', laquo: '«', raquo: '»',
}

/**
 * 模拟 org.json 的 optString：缺字段/JSONObject.NULL → ''；
 * 数字/布尔 → toString；对象/数组 → ''。
 */
function toOptString(value) {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return ''
}

/** 对应 Kotlin: optStringOrNull（非空且不等于 "null" 字符串才返回） */
function optStringOrNull(obj, name) {
  if (obj === null || obj === undefined || obj[name] === undefined) return null
  const s = toOptString(obj[name])
  return s && s !== 'null' ? s : null
}

/** 对应 Kotlin: optString（缺字段返回 ''，不判空） */
function optString(obj, name) {
  return toOptString(obj?.[name])
}

/**
 * 对应 Kotlin: optIntOrNull。注意 org.json 的 optInt 解析失败返回 0，
 * 这里保持相同语义（字段存在但非数字 → 0）。
 */
function optIntOrNull(obj, name) {
  if (obj === null || obj === undefined || !(name in obj) || obj[name] === null) return null
  const v = obj[name]
  const n = typeof v === 'number' ? Math.trunc(v) : parseInt(String(v), 10)
  return Number.isNaN(n) ? 0 : n
}

/** 对应 Kotlin: optDoubleOrNull（解析失败返回 0，语义同 org.json optDouble） */
function optDoubleOrNull(obj, name) {
  if (obj === null || obj === undefined || !(name in obj) || obj[name] === null) return null
  const n = Number(obj[name])
  return Number.isNaN(n) ? 0 : n
}

/** 仅当值为普通对象时返回（对应 org.json optJSONObject 的类型安全语义） */
function asObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : null
}

/** 仅当值为数组时返回（对应 org.json optJSONArray 的类型安全语义） */
function asArray(value) {
  return Array.isArray(value) ? value : null
}

/** 分页搜索失败时的空结果 */
function emptyPage(page, pageSize) {
  return { items: [], page, pageSize, totalCount: 0, totalPages: 0 }
}
