/**
 * scripts/verify-lcsc.mjs — 立创抓取链路冒烟验证（开发期使用）
 * 跑法: node --conditions=react-server scripts/verify-lcsc.mjs
 * 真实请求 so.szlcsc.com（受网络/风控影响，失败不代表代码问题）。
 */
import { lcsc } from '../lib/lcsc.ts'

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

console.log('== lookupByPartNumber(C14663) ==')
const detail = await lcsc.lookupByPartNumber('C14663')
if (!detail) {
  console.log('  ⚠️ 立创未返回（网络/风控），跳过详情断言')
} else {
  check('partNumber 正确', detail.partNumber === 'C14663', `实际 ${detail.partNumber}`)
  check('有名称', !!detail.name, JSON.stringify(detail.name))
  check('有品牌', !!detail.brand)
  check('有封装', !!detail.packageName)
  check('有价格', typeof detail.price === 'number', `实际 ${detail.price}`)
  check('规格参数非空', Object.keys(detail.specifications ?? {}).length > 0, JSON.stringify(detail.specifications).slice(0, 120))
  console.log(`  示例: ${detail.name} | ${detail.brand} | ${detail.packageName} | ¥${detail.price} | 库存 ${detail.stockQuantity}`)
}

console.log('== searchPaged(0402, 1) ==')
const paged = await lcsc.searchPaged('0402 电容', 1, 10)
if (paged.totalCount === 0) {
  console.log('  ⚠️ 立创未返回（网络/风控），跳过搜索断言')
} else {
  check('返回条目 > 0', paged.items.length > 0, `实际 ${paged.items.length}`)
  check('totalCount > 0', paged.totalCount > 0, `实际 ${paged.totalCount}`)
  console.log(`  第 ${paged.page}/${paged.totalPages} 页，共 ${paged.totalCount} 条，本页 ${paged.items.length} 条`)
}

console.log(failed === 0 ? '\n全部通过 🎉' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
