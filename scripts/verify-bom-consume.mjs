/**
 * scripts/verify-bom-consume.mjs — 批量出库（BOM 焊接扣减）冒烟验证
 * 跑法: DATABASE_MODE=sqlite SQLITE_DATABASE_PATH=./data/verify-bom.db \
 *         node --conditions=react-server scripts/verify-bom-consume.mjs
 */
import { stockIn, stockOutBatch, getComponent, recentTransactions } from '../lib/db.ts'

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

function detail(pn, name, pkg) {
  return {
    partNumber: pn, mpn: `${pn}-MPN`, name, brand: 'Test', packageName: pkg,
    category: '测试', description: '', price: 0.1, productUrl: '', datasheetUrl: '',
    imageUrl: '', specifications: {},
  }
}

await stockIn('C100001', 10, { detail: detail('C100001', '10k 电阻', '0603') })
await stockIn('C100002', 3, { detail: detail('C100002', '100nF 电容', '0402') })
await stockIn('C100003', 5, { detail: detail('C100003', 'LED 红', '0603') })

console.log('场景 1：正常批量出库（同一元件多行的需求已合并）')
const r1 = await stockOutBatch(
  [
    { partNumber: 'C100001', quantity: 4, designators: ['R1', 'R2', 'R3', 'R4'] },
    { partNumber: 'C100002', quantity: 2, designators: ['C1', 'C2'] },
  ],
  { note: '焊接主控板 v2' },
)
check('返回 2 条结果', r1.length === 2)
check('C100001 库存 10 → 6', (await getComponent('C100001')).stockQuantity === 6)
check('C100002 库存 3 → 1', (await getComponent('C100002')).stockQuantity === 1)
const tx1 = (await recentTransactions(20)).filter((t) => t.type === 'out')
check('只写入 2 条出库流水（同元件合并成一笔）', tx1.length === 2, `实际 ${tx1.length}`)
const noteR = tx1.find((t) => t.partNumber === 'C100001')?.note ?? ''
const noteC = tx1.find((t) => t.partNumber === 'C100002')?.note ?? ''
check('流水备注含自定义备注与全部位号', /焊接主控板 v2/.test(noteR) && /R1,R2,R3,R4/.test(noteR), noteR)
check('另一条流水备注含 C1,C2', /C1,C2/.test(noteC), noteC)

console.log('场景 2：库存不足且未开超扣 → 整批拒绝（原子性）')
const before2 = (await getComponent('C100003')).stockQuantity
let threw = ''
try {
  await stockOutBatch([
    { partNumber: 'C100003', quantity: 2, designators: ['D1'] },
    { partNumber: 'C100001', quantity: 999, designators: ['R9'] },
  ])
} catch (e) {
  threw = e instanceof Error ? e.message : String(e)
}
check('抛出库存不足错误', threw.includes('库存不足'), threw)
check('C100003 未被扣减（整批回滚）', (await getComponent('C100003')).stockQuantity === before2)
check('C100001 未被扣减', (await getComponent('C100001')).stockQuantity === 6)

console.log('场景 3：开启「扣至 0」→ 不足的元件扣到 0')
const r3 = await stockOutBatch(
  [
    { partNumber: 'C100001', quantity: 999, designators: ['R9'] },
    { partNumber: 'C100003', quantity: 2, designators: ['D1'] },
  ],
  { note: '强制扣减', allowOversell: true },
)
check('C100001 扣至 0', (await getComponent('C100001')).stockQuantity === 0)
check('C100003 正常扣 2（5 → 3）', (await getComponent('C100003')).stockQuantity === 3)
const r3a = r3.find((r) => r.partNumber === 'C100001')
check('结果标注实扣数小于需求', r3a.deducted === 6 && r3a.requested === 999, JSON.stringify(r3a))

console.log('场景 4：全部元件库存为 0 → 明确报错而不是静默返回空')
let threw4 = ''
try {
  await stockOutBatch([{ partNumber: 'C100001', quantity: 5 }], { allowOversell: true })
} catch (e) { threw4 = e instanceof Error ? e.message : String(e) }
check('抛出「没有可出库的元件」', threw4.includes('没有可出库的元件'), threw4)
const zeroTx = (await recentTransactions(50)).filter((t) => t.type === 'out' && Number(t.quantity) === 0)
check('未写入 0 数量的出库流水', zeroTx.length === 0, `实际 ${zeroTx.length} 条`)

console.log('场景 5：参数校验')
let threw2 = ''
try {
  await stockOutBatch([{ partNumber: 'C100002', quantity: 0 }])
} catch (e) { threw2 = e instanceof Error ? e.message : String(e) }
check('数量非法被拒绝', threw2.includes('出库参数无效'), threw2)
let threw3 = ''
try {
  await stockOutBatch([{ partNumber: 'C999999', quantity: 1 }])
} catch (e) { threw3 = e instanceof Error ? e.message : String(e) }
check('不存在的元件被拒绝', threw3.includes('不在库存中'), threw3)

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
