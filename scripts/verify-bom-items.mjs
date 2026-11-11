/**
 * scripts/verify-bom-items.mjs — buildItems 的身份字段回归验证
 *
 * 背景（WCH-LinkE TypeC 板实测）：这份导出 61 个器件里有 60 个没有 lc_code，
 * comp_info 只有 `""` 和 `C9002,12MHz` 两个键，而 `comp['']` 里装的是某**一颗**
 * 真实料的属性（Name=100R / Manufacturer Part=100R / value=1kΩ / lc_pkg=0603）。
 * 旧代码把它当「无编号料」的兜底，于是整块板都变成「100R」：
 *   · R16（4.7kΩ）、R17（2kΩ）匹配到同一个货位
 *   · U2（SY8089AAAC）真正的型号被盖掉，明明库里有也判成「未入库」
 *
 * 现在：只有 lc_code 非空才查 comp_info；无编号料一律用器件自己的 cm
 * （立创页面「型号」列显示的就是它）。
 *
 * 跑法: node scripts/verify-bom-items.mjs
 */
import { buildItems } from '../lib/bom-html.mjs'

const comp = {
  // 立创给「无编号料」留的占位记录，里面是某一颗料的完整属性 —— 坑就在这
  '': {
    is_base: true,
    lc_pkg: '0603',
    value: '1kΩ',
    Name: '100R',
    'Manufacturer Part': '100R',
    'Supplier Part': '',
    Description: '电阻类型:厚膜电阻;阻值:10kΩ;',
  },
  'C9002,12MHz': {
    is_base: true,
    lc_pkg: 'SMD3225-4P',
    value: '12MHz',
    Name: '12MHz',
    'Manufacturer Part': 'X322512MSB4SI',
    'Supplier Part': 'C9002',
  },
}

const part = (des, cm, ft, lc = '') => ({ des, cm, ft_name: ft, lc_code: lc, is_mount: true })
const data = {
  comp_info: comp,
  designator_info: [
    {
      top: [
        part('R1', '1kΩ', 'R0603_2'),
        part('R16', '4.7kΩ', 'R0603_2'),
        part('R17', '2kΩ', 'R0603_2'),
        part('R22', '100R', 'R0603_2'),
        part('U2', 'SY8089AAAC', 'SOT-23-5_L3.0-W1.7-P0.95-LS2.8-BR'),
        part('C1', '12MHz', 'SMD3225-4P', 'C9002,12MHz'),
      ],
      bottom: [part('R18', '1kΩ', 'R0603_2')],
    },
  ],
}

const items = buildItems(data)
const by = (d) => items.find((it) => it.designators.split(',')[0] === d)

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

console.log('解析结果：')
for (const it of items) {
  console.log(`  ${it.designators.padEnd(6)} 值=${it.value.padEnd(10)} 型号=${(it.mpn || '-').padEnd(12)} 封装=${it.footprint}`)
}

console.log('')
console.log('断言：')
check('分组数 = 6（不同 cm 不合并，同 cm 合并）', items.length === 6, String(items.length))
check('R16 用 cm 作身份，不是 comp[""] 的 100R', by('R16')?.value === '4.7kΩ' && by('R16')?.mpn === '4.7kΩ', `${by('R16')?.value}/${by('R16')?.mpn}`)
check('R17 保留自己的 2kΩ', by('R17')?.mpn === '2kΩ', String(by('R17')?.mpn))
check('U2 的型号 SY8089AAAC 没被覆盖', by('U2')?.mpn === 'SY8089AAAC', String(by('U2')?.mpn))
check('只有 R22 这种真·100R 才是 100R', by('R22')?.mpn === '100R' && by('R16')?.mpn !== '100R', String(by('R22')?.mpn))
check('有 lc_code 的料仍从 comp_info 取型号/编号', by('C1')?.partNumber === 'C9002' && by('C1')?.mpn === 'X322512MSB4SI', `${by('C1')?.partNumber}/${by('C1')?.mpn}`)
check('同 cm 的位号合并成一行（R1,R18）', by('R1')?.designators === 'R1,R18', String(by('R1')?.designators))

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
