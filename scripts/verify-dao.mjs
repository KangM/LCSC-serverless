/**
 * scripts/verify-dao.mjs — DAO 冒烟验证（开发期使用）
 * 跑法: node --conditions=react-server scripts/verify-dao.mjs
 * 用本地 file: 库验证 lib/db.ts 全部核心路径。
 */
import {
  upsertComponentFromLcsc,
  stockIn,
  stockOut,
  adjustStock,
  getComponent,
  listComponents,
  listTransactions,
  recentTransactions,
  setSetting,
  getSetting,
  setThreshold,
  listCategories,
  listPackageNames,
} from '../lib/db.ts'

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

const detail = {
  partNumber: 'C14663',
  mpn: 'GRM188R71C104KA01D',
  name: '贴片电容',
  brand: 'Samsung',
  packageName: '0402',
  category: '贴片电容',
  description: '100nF 50V X7R',
  price: 0.0123,
  productUrl: 'https://item.szlcsc.com/C14663.html',
  datasheetUrl: 'https://atta.szlcsc.com/xxx.pdf',
  imageUrl: 'https://img.example.com/a.jpg',
  specifications: { 容值: '100nF', 耐压: '50V' },
}

console.log('== 入库（新建元件）==')
const c1 = await stockIn('C14663', 100, { detail, note: '首次入库', operator: 'tester' })
check('新建元件库存=100', c1.stockQuantity === 100, `实际 ${c1.stockQuantity}`)
check('规格参数已存', c1.specifications['容值'] === '100nF')
check('分类可查询', c1.category === '贴片电容')

console.log('== 再入库（累加）==')
const c2 = await stockIn('c14663', 50, { note: '补货', operator: 'tester' })
check('累加后库存=150', c2.stockQuantity === 150, `实际 ${c2.stockQuantity}`)
check('编号大小写归一', c2.partNumber === 'C14663')

console.log('== 出库 ==')
const c3 = await stockOut('C14663', 30, { note: '领用', operator: 'tester' })
check('出库后库存=120', c3.stockQuantity === 120, `实际 ${c3.stockQuantity}`)

console.log('== 出库超量应抛错 ==')
try {
  await stockOut('C14663', 9999)
  check('超量出库被阻止', false)
} catch (e) {
  check('超量出库被阻止: ' + e.message, String(e.message).includes('库存不足'))
}

console.log('== 盘点 ==')
const c4 = await adjustStock('C14663', 118, { note: '盘点差 -2', operator: 'tester' })
check('盘点修正为 118', c4.stockQuantity === 118, `实际 ${c4.stockQuantity}`)

console.log('== 立创信息刷新（不动库存）==')
await upsertComponentFromLcsc({ ...detail, name: '贴片电容(新)', price: 0.011 })
const c5 = await getComponent('C14663')
check('名称已更新', c5?.name === '贴片电容(新)')
check('刷新不影响库存', c5?.stockQuantity === 118)

console.log('== 查询 ==')
const list = await listComponents({ q: 'GRM188', page: 1, pageSize: 10 })
check('关键词搜索命中', list.total === 1, `实际 ${list.total}`)
const cats = await listCategories()
check('分类下拉', cats.includes('贴片电容'))
const pkgs = await listPackageNames()
check('封装下拉', pkgs.includes('0402'))

console.log('== 流水 ==')
const txs = await listTransactions({ partNumber: 'C14663', pageSize: 50 })
check('流水共 4 条', txs.total === 4, `实际 ${txs.total}`)
const t0 = txs.items[0]
check('最新流水是盘点', t0.type === 'adjust' && t0.quantity === -2, JSON.stringify(t0))
const recent = await recentTransactions(3)
check('最近流水 3 条', recent.length === 3)
const typeFiltered = await listTransactions({ type: 'in' })
check('类型筛选 in=2 条', typeFiltered.total === 2, `实际 ${typeFiltered.total}`)

console.log('== 设置 KV ==')
await setSetting('ocr_type', 'rapidocr')
await setSetting('ocr_rapidocr_url', 'http://127.0.0.1:9003/ocr')
check('读设置', (await getSetting('ocr_type')) === 'rapidocr')
await setSetting('ocr_type', null)
check('删设置', (await getSetting('ocr_type')) === null)

console.log('== 阈值 ==')
await setThreshold('C14663', 20)
check('阈值已设', (await getComponent('C14663'))?.threshold === 20)

console.log(failed === 0 ? '\n全部通过 🎉' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
