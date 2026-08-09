# lcsc-catalog.js — 立创商城数据抓取（JS 移植版）

把 Android 项目 `LCSC_android_erp` 中抓取立创商城搜索数据的整套逻辑，原样整理成
一个零依赖、可独立使用的 JavaScript 模块。

## 来源对照

| JS 模块 | 原始 Kotlin 文件 | 职责 |
|---|---|---|
| `LcscCatalogClient.searchProducts / searchMatchedProduct` | `data/remote/LcscCatalogRemoteDataSource.kt` | HTTP 抓取、203 验证 Cookie、`__NEXT_DATA__` 提取、原始 JSON 返回 |
| `LcscCatalogClient.lookupByPartNumber / searchByKeyword` | `data/repository/LcscCatalogRepositoryImpl.kt` | 原始 JSON → `ComponentDetail` 领域模型 |
| 底部 `optString* / sanitizeSearchText / rc4` 等 | 两个文件的扩展函数/私有方法 | 文本清洗、JSON 取值、RC4 加密 |

## 环境要求

- Node.js **>= 18**（有全局 `fetch`），或现代浏览器
- ESM 模块，无任何第三方依赖

## 使用

复制 `lcsc-catalog.js` 到你的项目：

```js
import { LcscCatalogClient } from './lcsc-catalog.js'

const client = new LcscCatalogClient()

// 1. 按型号查详情（入库/扫码场景）
const detail = await client.lookupByPartNumber('C14663')
console.log(detail)
// { partNumber: 'C14663', mpn: 'GRM188R71C104KA01D', name: '贴片电容', brand: 'Samsung',
//   packageName: '0402', category: '贴片电容', description: '...', stockQuantity: 12345,
//   price: 0.0123, productUrl: 'https://item.szlcsc.com/C14663.html',
//   datasheetUrl: 'https://atta.szlcsc.com/...pdf', imageUrl: 'https://...', specifications: {...} }

// 2. 关键词搜索（返回第 1 页列表）
const list = await client.searchByKeyword('GRM188R71C104KA01D')

// 3. 分页搜索（主站真实翻页接口 POST /query/product）
const page2 = await client.searchPaged('0402', 2)
console.log(page2.page, '/', page2.totalPages, '共', page2.totalCount, '条') // 2 / 50 共 1500 条
console.log(page2.items) // 第 2 页的 ComponentDetail 列表（每页 30 条）

// 4. 底层接口：拿原始 JSON 自行处理
const rawRecords = await client.searchProducts('0402 电容')
const matched = await client.searchMatchedProduct('C14663')
```

在 Node 14-17（无全局 fetch）或需要代理/超时控制时，可注入 fetch：

```js
const client = new LcscCatalogClient({
  fetchImpl: (url, init) => myFetchWithTimeout(url, { ...init, timeout: 10000 }),
})
```

## ComponentDetail 字段

| 字段 | 来源（`__NEXT_DATA__` 内） | 说明 |
|---|---|---|
| `partNumber` | `productVO.productCode` | 立创编号（如 C14663） |
| `mpn` | `productVO.productModel` | 厂商型号 |
| `name` | `lightProductModel` → `productModel` → 商品名剔除规格 | 清洗后显示名 |
| `brand` | `lightBrandName` → `productGradePlateName` | 品牌 |
| `packageName` | `lightStandard` → `encapsulationModel` → 搜索参数匹配"封装/Package/Case" | 封装 |
| `category` | `lightCatalogName` → `productType` | 分类 |
| `description` | `productVO.remark` → `lightProductIntro` | 描述 |
| `stockQuantity` | `stockNumber` → `validStockNumber` | 库存 |
| `price` | `productPriceList[0].productPrice` | 第一档价格 |
| `productUrl` | `productId` | 拼出商品详情页 |
| `datasheetUrl` | `fileTypeVOList[].detailVOList[0].fileUrl` | 数据手册 |
| `imageUrl` | `breviaryImageUrl` | 商品图（Coil/`<img>` 直接加载） |
| `specifications` | `paramLinkedMap` | 全部规格参数表 |

## 抓取流程与反爬

**分页（`searchPaged`）走主站真实翻页接口** `POST https://so.szlcsc.com/query/product`
（JSON body，`currentPage`/`keyword`/`pageSize`），无需 Cookie 即可访问；响应
`result.searchResult.productRecordList` 与页面内嵌结构完全同构，直接复用
`buildComponentDetail` 解析，分页元数据来自 `currePage`/`pageSize`/`totalCount`/`countPage`。
返回结构 `{ items, page, pageSize, totalCount, totalPages }`，便于无限滚动等场景。

`searchProducts`/`searchByKeyword`/`searchMatchedProduct`/`lookupByPartNumber` 仍走
页面 HTML 路径（对应 Android 原实现），两套路径互相独立。

页面 HTML 路径（旧逻辑，保留兼容）：
1. 请求 `https://so.szlcsc.com/global.html?k=<关键词>`，伪装 Chrome UA + Referer。
2. 页面是 Next.js 应用，取 `<script id="__NEXT_DATA__">` 内容 `JSON.parse`，
   数据路径 `props.pageProps.soData.searchResult.productRecordList`。
3. 若返回 **203** 且 HTML 含 `_xvasu/_xvtsc/_xvpfs/_xvpts` 任一 token，判定为验证页：
   - 正则提取 `var _xvasu = "...";` 等三个变量
   - 用硬编码密钥 `tg09It3*9h` 对 `"<xvpts>:<xvasu>"` 做 **RC4**，结果 **Base64**
   - Cookie 名 = `<xvpfs><xvasu>`，值 = Base64，带上重试一次
4. 解析失败 / 网络失败统一返回 `null`（与 Kotlin 的 catch 行为一致）。

> 注：立创商城 `global.html` 的 SSR 不响应 `page` 参数（`<title>` 会变"第2页"但
> `productRecordList` 恒为第 1 页），`_next/data` 端点被 WAF 拦截（403 ACL），
> 因此真正的翻页只能走上面的 `POST /query/product` 接口。

## 移植差异（有意为之，均在代码注释中标注）

- **`__NEXT_DATA__` 提取**：Kotlin 用 Jsoup 的 CSS 选择器，JS 用正则
  `/<script[^>]*\bid\s*=\s*["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i`。
- **HTML 实体解码**：Jsoup 自带解码器，JS 用内置的常用命名实体表 + 数字/十六进制实体
  （覆盖数据中实际出现的 `&amp;`、`&lt;`、`&nbsp;` 等）。
- **`optIntOrNull` / `optDoubleOrNull`**：保留 org.json 的语义——字段存在但解析失败时返回 `0`，
  与 Kotlin 行为一致（而不是返回 `null`）。
- **`imageLocalPath`** 已省略（Android 本地图片文件概念，JS 端无对应物）。

## 已知脆弱点（原项目同样存在）

1. 强依赖 `__NEXT_DATA__` 的 JSON 结构和字段名（`lightXxx`、`productVO`、`paramLinkedMap`），
   立创商城前端改版即失效，需要同步调整解析路径。
2. 验证 Cookie 的 RC4 密钥 `tg09It3*9h` 与 token 名硬编码，验证机制升级后需要跟进。
3. 无官方 API、无登录态/请求频率控制，高频调用可能被风控（建议自行加限速与退避）。

## 验证

```bash
node --input-type=module -e "
  import { LcscCatalogClient } from './lcsc-catalog.js'
  const c = new LcscCatalogClient({ fetchImpl: async () => { throw new Error('offline') } })
  console.log('模块加载 OK')
"
```
