/**
 * scripts/verify-purchase-orders.mjs — 采购订单在途量的回归验证
 *
 * 验证四件事：
 *   1. 订单「运输中」的行计入在途，库存不足但库存+在途够用时结论是 covered_by_incoming
 *   2. 核销入库后库存增加、该行在途归零（不会重复计数）
 *   3. 部分核销时订单仍是运输中，剩余行继续计入在途；全部核销后自动标已签收
 *   4. 立创编号能自动匹配到库存元件
 *
 * 跑法: node --conditions=react-server scripts/verify-purchase-orders.mjs
 */
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// 源码里是打包器风格的省略扩展名导入（'./db'），纯 Node 跑需要补回 .ts
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 落到默认解析 */
      }
    }
    return nextResolve(specifier, context)
  },
})

const dbPath = fileURLToPath(new URL('../data/verify-orders.db', import.meta.url))
rmSync(dbPath, { force: true })

process.env.DATABASE_MODE = 'sqlite'
process.env.SQLITE_DATABASE_PATH = dbPath
process.env.PERF_LOG = '0'

const { createClient } = await import('@libsql/client')
const { stockIn, getComponent } = await import('../lib/db.ts')
const { checkBom } = await import('../lib/bom.ts')
const {
  createManualOrder,
  getIncomingByPartNumber,
  consumeOrderItems,
  listOrders,
} = await import('../lib/purchase-orders.ts')

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
const bootstrap = createClient({ url: `file:${dbPath}` })
await bootstrap.executeMultiple(schema)
bootstrap.close()

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

function res(pn, mpn, pkg, value) {
  return {
    partNumber: pn, mpn, name: mpn, brand: 'Test', packageName: pkg,
    category: '贴片电阻', description: '', price: 0.01,
    productUrl: '', datasheetUrl: '', imageUrl: '',
    specifications: { 阻值: value, 精度: '±1%', 功率: '100mW' },
  }
}

const PN_A = 'C900001'
const PN_B = 'C900002'

await stockIn(PN_A, 30, { detail: res(PN_A, '0603WAF1002T5E', '0603', '10K') })
await stockIn(PN_B, 5, { detail: res(PN_B, '0603WAF2202T5E', '0603', '22K') })

const bom = [
  { designator: 'R1', name: '10K', footprint: '0603', supplier: '', quantity: 60 },
  { designator: 'R2', name: '10K', footprint: '0603', supplier: '', quantity: 30 },
  { designator: 'R3', name: '22K', footprint: '0603', supplier: '', quantity: 5 },
  { designator: 'R4', name: '10K', footprint: '0603', supplier: '', quantity: 100 },
]
const byDesignator = async () => {
  const { items } = await checkBom(bom)
  return (d) => items.find((item) => item.designator === d)
}

console.log('场景 1：还没有订单，库存 30 不够 60')
{
  const by = await byDesignator()
  check('R1 判为 insufficient', by('R1').status === 'insufficient', by('R1').status)
  check('R1 在途为 0', by('R1').incomingQuantity === 0, String(by('R1').incomingQuantity))
  check('R2 需求量 30 等于库存，判为 sufficient', by('R2').status === 'sufficient', by('R2').status)
}

console.log('\n场景 2：立创订单（运输中）买了 50 个 10K，立创编号自动匹配')
const orderId = await createManualOrder({
  source: 'lcsc',
  orderNo: 'LC-TEST-001',
  shipmentState: 'shipped',
  statusText: '已发货',
  orderedAt: new Date().toISOString(),
  items: [
    { supplierPartNo: PN_A, title: '0603 10K 电阻', quantity: 50, unitPrice: 0.01 },
    { supplierPartNo: PN_B, title: '0603 22K 电阻', quantity: 3, unitPrice: 0.01 },
  ],
})
{
  const orders = await listOrders({ q: 'LC-TEST-001' })
  const order = orders.find((row) => row.id === orderId)
  check('订单已落库', Boolean(order), String(orderId))
  check('两行都靠立创编号自动匹配', order.items.every((item) => item.matchedPartNumber), JSON.stringify(order.items.map((item) => item.matchSource)))
  check('订单在途小计 = 53', order.incomingQuantity === 53, String(order.incomingQuantity))

  const incoming = await getIncomingByPartNumber()
  check('在途聚合：10K = 50', incoming.get(PN_A) === 50, String(incoming.get(PN_A)))
  check('在途聚合：22K = 3', incoming.get(PN_B) === 3, String(incoming.get(PN_B)))

  const by = await byDesignator()
  check('R1（需 60）改判 covered_by_incoming', by('R1').status === 'covered_by_incoming', by('R1').status)
  check('R1 可用量 = 30 + 50 = 80', by('R1').availableQuantity === 80, String(by('R1').availableQuantity))
  check('R4（需 100）仍 insufficient', by('R4').status === 'insufficient', by('R4').status)
  check('R3（需 5）保持 sufficient，不受在途干扰', by('R3').status === 'sufficient', by('R3').status)
}

console.log('\n场景 3：核销 50 个 10K，库存增加、该行在途归零')
{
  const orders = await listOrders({ q: 'LC-TEST-001' })
  const order = orders.find((row) => row.id === orderId)
  const itemA = order.items.find((item) => item.matchedPartNumber === PN_A)
  const results = await consumeOrderItems([{ itemId: itemA.id, quantity: 50 }], 'verify')

  check('核销返回库存 30 → 80', results[0].beforeQty === 30 && results[0].afterQty === 80, JSON.stringify(results[0]))
  const component = await getComponent(PN_A)
  check('元件库存已变成 80', component.stockQuantity === 80, String(component.stockQuantity))

  const incoming = await getIncomingByPartNumber()
  check('10K 在途归零（不重复计数）', !incoming.has(PN_A), String(incoming.get(PN_A)))

  const after = (await listOrders({ q: 'LC-TEST-001' })).find((row) => row.id === orderId)
  check('部分核销后订单仍是运输中', after.shipmentState === 'shipped', after.shipmentState)
  check('剩余在途只有 22K 的 3 个', after.incomingQuantity === 3, String(after.incomingQuantity))

  const by = await byDesignator()
  check('R1（需 60）现在是 sufficient', by('R1').status === 'sufficient', by('R1').status)
}

console.log('\n场景 4：核销剩余 22K，订单自动标已签收、不再计入在途')
{
  const orders = await listOrders({ q: 'LC-TEST-001' })
  const order = orders.find((row) => row.id === orderId)
  const itemB = order.items.find((item) => item.matchedPartNumber === PN_B)
  await consumeOrderItems([{ itemId: itemB.id, quantity: 3 }], 'verify')

  const after = (await listOrders({ q: 'LC-TEST-001' })).find((row) => row.id === orderId)
  check('订单自动变成 received', after.shipmentState === 'received', after.shipmentState)
  check('在途小计归零', after.incomingQuantity === 0, String(after.incomingQuantity))

  const incoming = await getIncomingByPartNumber()
  check('在途聚合为空', incoming.size === 0, String(incoming.size))

  const component = await getComponent(PN_B)
  check('22K 库存 5 → 8', component.stockQuantity === 8, String(component.stockQuantity))
}

console.log('\n场景 5：待发货的订单不计入在途')
{
  await createManualOrder({
    source: 'taobao',
    orderNo: 'TB-TEST-001',
    shipmentState: 'pending',
    items: [{ title: '10K 电阻 0603 100只', quantity: 200 }],
  })
  const incoming = await getIncomingByPartNumber()
  check('待发货不产生在途量', !incoming.has(PN_A), String(incoming.get(PN_A)))
}

console.log('')
if (failed > 0) {
  console.log(`❌ ${failed} 项断言失败`)
  process.exit(1)
}
console.log('✅ 全部通过')
