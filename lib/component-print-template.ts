/**
 * 打印标签规格模板。
 * 每个模板定义短类别和立创规格字段的显示顺序；新增类别时只需在此维护。
 */

type Specifications = Record<string, string>

interface PrintField {
  keys: string[]
  format?: (value: string) => string
}

interface PrintTemplate {
  matches: (category: string) => boolean
  shortCategory: string | ((category: string) => string)
  fields: PrintField[]
}

const firstSegment = (value: string) => value.split(/[;；]/, 1)[0].trim()
const withoutCount = (value: string) => value.replace(/^\s*\d+\s*个\s*/, '').trim()
const withoutResistorSuffix = (value: string) => value.replace(/电阻$/, '').trim()

const PRINT_TEMPLATES: PrintTemplate[] = [
  {
    matches: (category) => category.includes('静电和浪涌'),
    shortCategory: 'ESD',
    fields: [],
  },
  {
    matches: (category) => category.includes('贴片电阻') || category.includes('插件电阻'),
    shortCategory: '贴片电阻',
    fields: [
      { keys: ['电阻类型'], format: withoutResistorSuffix },
      { keys: ['阻值'] },
      { keys: ['精度'] },
      { keys: ['功率', '额定功率'] },
    ],
  },
  {
    matches: (category) => category.includes('电容'),
    shortCategory: (category) => {
      if (category.includes('MLCC')) return 'MLCC'
      if (category.includes('电解')) return '电解电容'
      if (category.includes('钽')) return '钽电容'
      return '电容'
    },
    fields: [
      { keys: ['容值', '电容量'] },
      { keys: ['精度', '容差'] },
      { keys: ['额定电压', '耐压'] },
      { keys: ['温度系数', '介质材料'] },
    ],
  },
  {
    matches: (category) => category.includes('电感'),
    shortCategory: '贴片电感',
    fields: [
      { keys: ['电感值'] },
      { keys: ['精度'] },
      { keys: ['额定电流'] },
      { keys: ['直流电阻(DCR)', '直流电阻'], format: (value) => `DCR ${value}` },
    ],
  },
  {
    matches: (category) => category.includes('场效应管') || category.toUpperCase().includes('MOSFET'),
    shortCategory: 'MOS管',
    fields: [
      { keys: ['数量', '沟道类型'], format: withoutCount },
      { keys: ['漏源电压(Vdss)', '漏源电压'] },
      { keys: ['连续漏极电流(Id)', '连续漏极电流'] },
      { keys: ['导通电阻(RDS(on))', '导通电阻'], format: (value) => `Rds ${firstSegment(value)}` },
    ],
  },
  {
    matches: (category) => category.includes('稳压二极管'),
    shortCategory: '稳压二极管',
    fields: [
      { keys: ['二极管配置'], format: withoutCount },
      { keys: ['稳压值(标称值)', '稳压值'] , format: (value) => `Vz ${value}` },
      { keys: ['反向电流(Ir)', '反向电流'], format: (value) => `Ir ${value}` },
      { keys: ['稳压值(范围值)', '稳压范围'] },
    ],
  },
  {
    matches: (category) => category.includes('肖特基二极管'),
    shortCategory: '肖特基管',
    fields: [
      { keys: ['二极管配置'], format: withoutCount },
      { keys: ['反向电压(Vr)', '反向电压'] },
      { keys: ['整流电流(Io)', '整流电流'] },
      { keys: ['正向压降(Vf)', '正向压降'], format: (value) => `Vf ${value}` },
    ],
  },
  {
    matches: (category) => category.includes('二极管'),
    shortCategory: '二极管',
    fields: [
      { keys: ['二极管配置'], format: withoutCount },
      { keys: ['反向电压(Vr)', '反向电压'] },
      { keys: ['整流电流(Io)', '整流电流'] },
      { keys: ['正向压降(Vf)', '正向压降'], format: (value) => `Vf ${value}` },
    ],
  },
  {
    matches: (category) => category.includes('三极管') || category.includes('BJT'),
    shortCategory: 'BJT',
    fields: [
      { keys: ['晶体管类型'] },
      { keys: ['集电极电流(Ic)', '集电极电流'], format: (value) => `Ic ${value}` },
      { keys: ['集射极击穿电压(Vceo)', '集射极击穿电压'], format: (value) => `Vce ${value}` },
      { keys: ['耗散功率(Pd)', '耗散功率'], format: (value) => `Pd ${value}` },
    ],
  },
  {
    matches: (category) => category.includes('线性稳压器') || category.includes('LDO'),
    shortCategory: 'LDO',
    fields: [
      { keys: ['输出极性'], format: (value) => value === '正极' ? '正输出' : value === '负极' ? '负输出' : value },
      { keys: ['工作电压', '输入电压'], format: (value) => `Vin ${value}` },
      { keys: ['输出电压'], format: (value) => `Vout ${value}` },
      { keys: ['输出电流'], format: (value) => `Iout ${value}` },
    ],
  },
]

function parseSpecifications(raw: unknown): Specifications {
  if (typeof raw !== 'string' || !raw.trim()) return {}
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string' && Boolean(entry[1].trim())),
    )
  } catch {
    return {}
  }
}

function fallbackCategory(category: string): string {
  return Array.from(category.trim() || '未分类').slice(0, 5).join('')
}

/** 返回打印用短类别与固定四列规格；未命中模板时以原始规格值兜底。 */
export function formatComponentPrintFields(categoryRaw: unknown, specificationsRaw: unknown): {
  category: string
  specifications: string[]
} {
  const category = typeof categoryRaw === 'string' ? categoryRaw.trim() : ''
  const specifications = parseSpecifications(specificationsRaw)
  const template = PRINT_TEMPLATES.find((item) => item.matches(category))
  const values: string[] = []
  const usedKeys = new Set<string>()

  for (const field of template?.fields ?? []) {
    const key = field.keys.find((candidate) => specifications[candidate]?.trim())
    if (!key) continue
    usedKeys.add(key)
    const value = (field.format ? field.format(specifications[key]) : specifications[key]).trim()
    if (value) values.push(value)
  }

  for (const [key, value] of Object.entries(specifications)) {
    if (values.length >= 4) break
    if (!usedKeys.has(key) && value.trim()) values.push(value.trim())
  }

  return {
    category: template
      ? typeof template.shortCategory === 'function'
        ? template.shortCategory(category)
        : template.shortCategory
      : fallbackCategory(category),
    specifications: [...values, '', '', '', ''].slice(0, 4),
  }
}
