/**
 * scripts/verify-bom-match.mjs — BOM 名称/标称值匹配的回归验证
 *
 * 背景：归一化时把小数点当分隔符去掉，导致 2.2uF 与 22uF、4.7K 与 47K 被判为同一值。
 * 这里用贴近真实库存的数据（立创编号 + 规格 JSON）跑一遍 checkBom 做断言。
 *
 * 跑法: node --conditions=react-server scripts/verify-bom-match.mjs
 */
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// 项目源码里是打包器风格的省略扩展名导入（'./db'），纯 Node 跑需要补回 .ts
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

const dbPath = fileURLToPath(new URL('../data/verify-bom-match.db', import.meta.url))
rmSync(dbPath, { force: true })

process.env.DATABASE_MODE = 'sqlite'
process.env.SQLITE_DATABASE_PATH = dbPath
process.env.PERF_LOG = '0'

const { createClient } = await import('@libsql/client')
const { stockIn } = await import('../lib/db.ts')
const { checkBom } = await import('../lib/bom.ts')

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
const bootstrap = createClient({ url: `file:${dbPath}` })
await bootstrap.executeMultiple(schema)

function cap(pn, mpn, pkg, value, voltage) {
  return {
    partNumber: pn, mpn, name: mpn, brand: 'Samsung', packageName: pkg,
    category: '贴片电容(MLCC)', description: '', price: 0.05, productUrl: '',
    datasheetUrl: '', imageUrl: '',
    specifications: { 容值: value, 精度: '±10%', 额定电压: voltage, 温度系数: 'X5R' },
  }
}
function res(pn, mpn, pkg, value) {
  return {
    partNumber: pn, mpn, name: mpn, brand: 'Uniroyal', packageName: pkg,
    category: '贴片电阻', description: '', price: 0.01, productUrl: '',
    datasheetUrl: '', imageUrl: '', specifications: { 阻值: value, 精度: '±1%', 功率: '100mW' },
  }
}

// 真实库存里同时存在 2.2uF(0603)、2.2uF(0805)、22uF(0603)，最容易被配错
await stockIn('C99228', 50, { detail: cap('C99228', '0603B225K250NT', '0603', '2.2uF', '25V') })
await stockIn('C28234', 20, { detail: cap('C28234', 'CL21B225KOFNNNE', '0805', '2.2uF', '16V') })
await stockIn('C86295', 36, { detail: cap('C86295', 'CL10A226MP8NUNE', '0603', '22uF', '10V') })
await stockIn('C1591', 100, { detail: cap('C1591', 'CL10B104KB8NNNC', '0603', '100nF', '50V') })
await stockIn('C4701', 100, { detail: res('C4701', 'RC0603FR-074K7L', '0603', '4.7kΩ') })
await stockIn('C4702', 100, { detail: res('C4702', 'RC0603FR-0747KL', '0603', '47kΩ') })
await stockIn('C100003', 5, {
  detail: {
    partNumber: 'C100003', mpn: 'LTST-C190KGKT', name: 'LTST-C190KGKT', brand: 'LiteOn',
    packageName: '0603', category: '发光二极管', description: '', price: 0.1, productUrl: '',
    datasheetUrl: '', imageUrl: '', specifications: { 颜色: '红色', 波长: '571nm' },
  },
})

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

const bom = [
  { designator: 'C5', name: '2.2uF', footprint: '0603', quantity: 2 },
  { designator: 'C6', name: '2.2uF', footprint: '0805', quantity: 2 },
  { designator: 'C7', name: '22uF', footprint: '0603', quantity: 2 },
  { designator: 'C8', name: '0.1uF', footprint: '0603', quantity: 1 },
  { designator: 'C9', name: '100nF', footprint: '0603', quantity: 1 },
  { designator: 'C10', name: '2.2UF', footprint: '0603', quantity: 1 },
  { designator: 'R1', name: '4.7K', footprint: '0603', quantity: 1 },
  { designator: 'R2', name: '47K', footprint: '0603', quantity: 1 },
  { designator: 'R3', name: '4.7kΩ', footprint: '0603', quantity: 1 },
  { designator: 'U1', name: 'CL10A226MP8NUNE', footprint: '0603', quantity: 1 },
  { designator: 'D1', name: 'LED_R', footprint: '0603', quantity: 1 },
]
const { items } = await checkBom(bom)
const by = (d) => items.find((i) => i.designator === d)

console.log('匹配结果：')
for (const item of items) {
  console.log(
    `  ${item.designator.padEnd(4)} ${item.name.padEnd(18)} → ${item.matchedPartNumber ?? '-'}` +
      ` ${item.matchedValue ?? ''} ${item.message}`,
  )
}
console.log('')

console.log('断言：')
check('C5 2.2uF/0603 命中 C99228（不再误配 22uF 的 C86295）', by('C5').matchedPartNumber === 'C99228', by('C5').matchedPartNumber ?? '')
check('C6 2.2uF/0805 命中 C28234', by('C6').matchedPartNumber === 'C28234', by('C6').matchedPartNumber ?? '')
check('C7 22uF/0603 命中 C86295', by('C7').matchedPartNumber === 'C86295', by('C7').matchedPartNumber ?? '')
check('C8 0.1uF 与 100nF 视为同一值', by('C8').matchedPartNumber === 'C1591', by('C8').matchedPartNumber ?? '')
check('C9 100nF 命中 C1591', by('C9').matchedPartNumber === 'C1591', by('C9').matchedPartNumber ?? '')
check('C10 大小写不敏感（2.2UF）', by('C10').matchedPartNumber === 'C99228', by('C10').matchedPartNumber ?? '')
check('R1 4.7K 命中 C4701 而不是 47K', by('R1').matchedPartNumber === 'C4701', by('R1').matchedPartNumber ?? '')
check('R2 47K 命中 C4702', by('R2').matchedPartNumber === 'C4702', by('R2').matchedPartNumber ?? '')
check('R3 4.7kΩ 与 4.7K 视为同一值', by('R3').matchedPartNumber === 'C4701', by('R3').matchedPartNumber ?? '')
check('U1 按厂商型号精确匹配', by('U1').matchedPartNumber === 'C86295', by('U1').matchedPartNumber ?? '')
check('D1 LED_R 仍按颜色匹配', by('D1').matchedPartNumber === 'C100003', by('D1').matchedPartNumber ?? '')
check('匹配结果带出标称值便于人工核对', by('C5').matchedValue === '2.2uF', String(by('C5').matchedValue))

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
