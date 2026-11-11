/**
 * scripts/verify-part-match.mjs — matchComponent 的品类约束回归验证
 *
 * 起因（PCB10 实测）：U2 是 SY8089AAAC（SOT-23-5 的降压芯片），但原理图里留着
 * 上一个器件的值 `1kΩ`。旧逻辑拿不到型号就退到「值」匹配，配上了库里一颗 1kΩ 电阻，
 * 于是表格显示「封装不符」—— 而真相是「库里没有这颗芯片」。更糟的是，若库里恰好有
 * 同封装的 1kΩ，它会直接给出一个错的货位。
 *
 * 现在按「位号前缀 ↔ 库存分类」卡品类，同时仍允许：
 *   · 电阻 BOM 写的是别家型号（库里同值同封装）→ 照旧按值命中
 *   · 库存只填了 name（型号）、mpn 为空的记录 → 用型号文本也能命中
 *
 * 跑法: node scripts/verify-part-match.mjs
 */
import { matchComponent } from '../lib/part-match.mjs'

/** 贴近真实库存的几条记录（字段与 getInventorySnapshot 一致） */
const res = (pn, mpn, pkg, value, reference = '') => ({
  partNumber: pn,
  mpn,
  name: mpn,
  category: '贴片电阻',
  packageName: pkg,
  specifications: { 电阻类型: '厚膜电阻', 阻值: value, 精度: '±1%' },
  stock: 100,
  reference,
})
const cap = (pn, mpn, pkg, value, reference = '') => ({
  partNumber: pn,
  mpn,
  name: mpn,
  category: '贴片电容(MLCC)',
  packageName: pkg,
  specifications: { 容值: value, 精度: '±10%', 额定电压: '50V' },
  stock: 100,
  reference,
})
const ic = (pn, mpn, name, pkg, category, reference = '') => ({
  partNumber: pn,
  mpn,
  name,
  category,
  packageName: pkg,
  specifications: {},
  stock: 10,
  reference,
})
const led = (pn, mpn, pkg) => ({
  partNumber: pn,
  mpn,
  name: mpn,
  category: '发光二极管',
  packageName: pkg,
  specifications: { 颜色: '红色', 波长: '571nm' },
  stock: 50,
  reference: '',
})

/** 线上库的缩影：没有任何芯片 */
const base = [
  res('C2906982', 'FRC0603F1002TS', '0603', '10kΩ', 'R1A1'),
  res('C4701', 'RC0603FR-074K7L', '0603', '4.7kΩ', 'R1A2'),
  res('C1000', '0603WAF1001T5E', '0603', '1kΩ', 'R1A3'),
  res('C1001', 'AC0805JR-071KL', '0805', '1kΩ', 'R1A4'),
  cap('C14663', 'CC0603KRX7R9BB104', '0603', '100nF', 'CL2A1'),
  cap('C1585', 'CL10A106KP8NNNC', '0603', '10uF', 'CL2A2'),
  ic('C5346354', 'CH32V003J4M6', 'CH32V003J4M6', 'SOP-8', '单片机(MCU/MPU/SOC)', 'M1A1'),
  led('C100003', 'LTST-C190KGKT', '0603'),
]
/** 再加上一条「只填 name、mpn 空着」的芯片记录（旧 byMpn 精确查会漏） */
const withChip = [...base, ic('C900001', '', 'SY8089AAAC', 'SOT-23-5', '电源管理芯片', 'M1B1')]

const buildIndex = (list) => ({
  byPart: new Map(list.map((c) => [String(c.partNumber).toUpperCase(), c])),
  byMpn: new Map(list.filter((c) => c.mpn).map((c) => [String(c.mpn).toUpperCase(), c])),
  all: list,
})
const indexOnlyPassives = buildIndex(base)
const indexWithChip = buildIndex(withChip)

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

/** 与 buildItems 的产物同形 */
const item = (designators, value, extra = {}) => ({
  designators,
  name: '',
  value,
  footprint: '',
  partNumber: '',
  mpn: '',
  ...extra,
})

/** 报告一行结果，方便肉眼核对 */
function run(label, input, index) {
  const r = matchComponent(input, index)
  const got = r.component ? `${r.component.partNumber}（${r.how}）` : r.reason === 'pkg' ? 'pkg（封装不符）' : 'none（未入库）'
  console.log(`  ${label.padEnd(34)} → ${got}`)
  return r
}

const chipOnPassives = item('U2', '1kΩ', { mpn: 'SY8089AAAC', footprint: 'SOT-23-5_L3.5-W1.6-P0.95-LS3.0-BL' })
const chipOnFull = item('U2', '1kΩ', { mpn: 'SY8089AAAC', footprint: 'SOT-23-5_L3.5-W1.6-P0.95-LS3.0-BL' })
const unknownChip = item('U9', '1kΩ', { mpn: 'SY8089ZZZZ', footprint: 'SOT-23-5' })
const r1 = item('R1', '1kΩ', { mpn: 'RC0603FR-071KL', footprint: '0603' })
const r2 = item('R2', '4.7kΩ', { footprint: '0805' })
const c1 = item('C1', '100nF', { footprint: '0603' })
const d1 = item('D1', 'LED_R', { footprint: '0603' })
const l1 = item('L1', '10uF', { footprint: '0603' })

console.log('用例（线上库缩影：只有电阻/电容/一颗 MCU）：')
const a = run('U2 芯片，值是 1kΩ', chipOnPassives, indexOnlyPassives)
const b = run('U9 芯片，型号库里没有', unknownChip, indexOnlyPassives)
const c = run('R1 1kΩ，型号是别家的', r1, indexOnlyPassives)
const d = run('R2 4.7kΩ/0805（库里只有 0603）', r2, indexOnlyPassives)
const e = run('C1 100nF/0603', c1, indexOnlyPassives)
const f = run('D1 LED_R/0603', d1, indexOnlyPassives)
const g = run('L1 10uF（电感位，值写成电容）', l1, indexOnlyPassives)

console.log('用例（库里补了一条只填 name 的 SY8089AAAC）：')
const h = run('U2 芯片，型号在 name 字段', chipOnFull, indexWithChip)

console.log('用例（位号前缀与型号打架，如 U1 上挂了电容型号）：')
const i = run('U1 CL10A106KP8NNNC', item('U1', 'CL10A106KP8NNNC', { footprint: '0603' }), indexOnlyPassives)

console.log('')
console.log('断言：')
check('U2 不会被同值电阻顶替（判未入库）', a.component === null && a.reason === 'none', `${a.component?.partNumber ?? '-'} / ${a.reason}`)
check('U2 不再误报「封装不符」', a.reason !== 'pkg', a.reason)
check('U2 不留下错误的 near 候选', a.near === null, String(a.near?.partNumber ?? ''))
check('U9 型号不存在时判未入库，也不误报封装不符', b.component === null && b.reason === 'none', b.reason)
check('电阻即使型号对不上，仍按值+封装命中', c.component?.partNumber === 'C1000', c.component?.partNumber ?? '-')
check('同值不同封装仍判「封装不符」', d.component === null && d.reason === 'pkg', `${d.component?.partNumber ?? '-'} / ${d.reason}`)
check('电容 100nF 正常命中', e.component?.partNumber === 'C14663', e.component?.partNumber ?? '-')
check('LED 按颜色命中（D 位与「发光二极管」同品类）', f.component?.partNumber === 'C100003', f.component?.partNumber ?? '-')
check('电感位不会配到电容', g.component === null && g.reason === 'none', g.component?.partNumber ?? g.reason)
check('库存只填 name 的芯片，用型号文本命中', h.component?.partNumber === 'C900001', h.component?.partNumber ?? h.reason)
check('型号精确命中时不受位号前缀影响（位号写错也认）', i.component?.partNumber === 'C1585', i.component?.partNumber ?? i.reason)

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
