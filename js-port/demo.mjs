/**
 * demo.mjs — 立创商城抓取逻辑演示（使用模拟 HTML，不联网）
 *
 * 运行: node demo.mjs
 *
 * 说明：真实抓取时，请求 https://so.szlcsc.com/global.html?k=<关键词> 返回的
 * HTML 里也带一个同结构的 <script id="__NEXT_DATA__">，本 demo 用本地构造的
 * HTML 模拟它（数据结构仿照真实 productRecordList）。
 */
import { LcscCatalogClient } from './lcsc-catalog.js'

// ===========================================================================
// 1. 模拟立创商城搜索页 HTML（与真实页面同构：Next.js 的 __NEXT_DATA__）
// ===========================================================================
const PRODUCT_DATA = {
  props: {
    pageProps: {
      soData: {
        searchResult: {
          productRecordList: [
            {
              // 记录 1：完整字段（有 lightProductModel / 封装 / 价格 / 数据手册 / 图片）
              paramLinkedMap: {
                '封装': '0402',
                '容值': '100nF',
                '品牌': 'Samsung',
                '精度': '±10%',
                '额定电压': '50V',
                '温度系数': 'X7R',
              },
              lightCatalogName: '贴片电容',
              lightProductModel: 'GRM188R71C104KA01D',
              lightBrandName: 'Samsung',
              lightStandard: '0402',
              lightProductName: 'GRM188R71C104KA01D 贴片电容 100nF 0402',
              lightProductIntro: '通用MLCC，X7R，50V',
              productVO: {
                productCode: 'C14663',
                productModel: 'GRM188R71C104KA01D',
                productName: 'GRM188R71C104KA01D 贴片电容',
                productGradePlateName: 'Samsung',
                encapsulationModel: '0402',
                productType: '贴片电容',
                remark: 'X7R 50V 100nF 通用',
                stockNumber: 123456,
                validStockNumber: 100,
                productPriceList: [
                  { productPrice: 0.0123 },
                  { productPrice: 0.0088 },
                ],
                productId: 'C14663',
                breviaryImageUrl: 'https://img.szlcsc.com/upload/xxx/C14663.jpg',
                fileTypeVOList: [
                  { detailVOList: [{ fileUrl: '/upload/pdf/C14663.pdf' }] },
                ],
              },
            },
            {
              // 记录 2：字段不全（无 lightProductModel / 无封装信息）
              // 走 normalizeDisplayName：从商品名里剔除 paramLinkedMap 中的型号+规格
              paramLinkedMap: {
                '型号': 'GRM21BR71C106KA12',
                '容值': '10uF',
              },
              lightCatalogName: '贴片电容',
              lightProductName: 'GRM21BR71C106KA12 贴片电容 10uF',
              productVO: {
                productCode: 'C12345',
                productName: 'GRM21BR71C106KA12 贴片电容',
                productType: '贴片电容',
                stockNumber: 50,
                productId: 'C12345',
              },
            },
          ],
        },
      },
    },
  },
  page: '/global',
  query: { k: 'GRM188R71C104KA01D' },
  buildId: 'demo',
}

const SIMULATED_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>立创商城 - 搜索结果（模拟）</title>
</head>
<body>
  <!-- 真实页面中，搜索数据就内嵌在这个脚本里 -->
  <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(PRODUCT_DATA)}</script>
</body>
</html>`

// ===========================================================================
// 2. 模拟 fetch：无论请求什么 URL，都返回上面的 HTML（不真正联网）
// ===========================================================================
const mockFetch = async () => new Response(SIMULATED_HTML, { status: 200 })
const client = new LcscCatalogClient({
  fetchImpl: mockFetch,
  log: { warn: () => {}, debug: () => {} }, // 关掉日志，只输出结果
})

// ===========================================================================
// 3. 演示两种用法，并打印解析结果
// ===========================================================================
console.log('========== 用法一：searchByKeyword("GRM188R71C104KA01D") 关键词搜索 ==========')
const list = await client.searchByKeyword('GRM188R71C104KA01D')
for (const [i, detail] of list.entries()) {
  console.log(`\n--- 第 ${i + 1} 条 ---`)
  console.log(JSON.stringify(detail, null, 2))
}

console.log('\n========== 用法二：lookupByPartNumber("c14663") 按型号查详情（小写也命中） ==========')
const detail = await client.lookupByPartNumber('c14663')
console.log(detail ? JSON.stringify(detail, null, 2) : '(未命中)')
