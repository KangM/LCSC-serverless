/**
 * lib/boxes.ts — 盒视图（按收纳盒看元件）的位号解析与盒结构。
 *
 * 位号格式由 lib/db.ts 的 firstFreeReference 决定：`前缀 + 盒号 + 行字母 + 列数字`，
 * 例如 R1G1 = 电阻盒 1、G 行 1 列，CL2A3 = 电容电感盒 2、A 行 3 列。
 * **这两处的容量规则必须一致**，否则新入库的元件会掉进「未归位」——
 * 改任何一边都要同步另一边。
 *
 * 尺寸：大件盒（B）5 行 × 3 列 = 15 格，其余 8 行 × 9 列 = 72 格。
 * 展示时永远渲染满容量，不因为用了 16 格就缩成 2 行 —— 空位要留白，
 * 「哪几格还空着」本身就是有用的信息。
 */

const ROWS_STANDARD = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
const ROWS_LARGE = ['A', 'B', 'C', 'D', 'E']
const COLS_STANDARD = [1, 2, 3, 4, 5, 6, 7, 8, 9]
const COLS_LARGE = [1, 2, 3]

/** 系统约定的四种收纳盒。未知前缀（如历史数据里的 D1C2）单独归为「其他盒」。 */
const BOX_META: Record<string, { title: string; order: number }> = {
  R: { title: '电阻盒', order: 1 },
  CL: { title: '电容电感盒', order: 2 },
  M: { title: '杂件盒', order: 3 },
  B: { title: '大件盒', order: 4 },
}

export interface BoxRef {
  /** 盒前缀，如 R / CL / M / B；历史数据里也可能是 D 这种 */
  prefix: string
  boxNumber: string
  row: string
  col: number
}

/** 一个可以摆进格子的元件（字段都是渲染格子要用的，别再往里塞整行数据） */
export interface BoxItem {
  partNumber: string
  name: string
  mpn: string
  packageName: string
  category: string
  stock: number
  threshold: number
  reference: string
  /** 格子里显示的主规格值：4.7kΩ / 100nF / 红色 … */
  value: string
}

export interface BoxGroup {
  /** 盒的唯一键，同时用作 URL hash 和 React key，如 R1 */
  key: string
  prefix: string
  boxNumber: string
  title: string
  /** 是否系统约定的四种盒；false 表示历史/异常位号 */
  known: boolean
  rows: string[]
  cols: number[]
  capacity: number
  /** 已占用的格子，键是 `${row}${col}`，如 G1 */
  cells: Map<string, BoxItem>
}

export interface BoxLayout {
  boxes: BoxGroup[]
  /** 位号为空或格式不认识、或格子已被占用而挤出来的元件 */
  unplaced: BoxItem[]
  /** 同一格子里塞了两个元件的位号，如 ['R1G1'] */
  conflicts: string[]
  totalItems: number
  totalCapacity: number
}

/**
 * 解析位号。宽容处理 `R1-G-1`、小写、全角空格这类手输变体。
 * 返回 null 表示「没有可用的盒位」，调用方应放进「未归位」。
 */
export function parseBoxRef(raw: string | null | undefined): BoxRef | null {
  const canonical = String(raw ?? '')
    .trim()
    .replace(/[\s\u3000-]/g, '')
    .toUpperCase()
  if (!canonical) return null
  const matched = /^([A-Z]+)([1-9])([A-H])([1-9])$/.exec(canonical)
  if (!matched) return null
  return { prefix: matched[1], boxNumber: matched[2], row: matched[3], col: Number(matched[4]) }
}

function createGroup(prefix: string, boxNumber: string): BoxGroup {
  const known = Object.prototype.hasOwnProperty.call(BOX_META, prefix)
  const rows = prefix === 'B' ? ROWS_LARGE : ROWS_STANDARD
  const cols = prefix === 'B' ? COLS_LARGE : COLS_STANDARD
  return {
    key: `${prefix}${boxNumber}`,
    prefix,
    boxNumber,
    title: known ? BOX_META[prefix].title : '其他盒',
    known,
    rows,
    cols,
    capacity: rows.length * cols.length,
    cells: new Map(),
  }
}

/**
 * 主规格值：格子里那一行小字。
 *
 * 直接读「阻值/容值/电感值」这些一目了然的键；其余元件退到第一个有意义的字段，
 * 但跳过「类型/配置/温度/精度」这类描述性字段 —— 否则 LED 会显示「1mmx0.8mm方形灯头」，
 * 不如「红色」有用。
 */
export function primarySpec(specifications: Record<string, string> | null | undefined): string {
  const specs = specifications ?? {}
  for (const key of ['阻值', '容值', '电感值', '存储容量']) {
    const value = specs[key]
    if (value) return value
  }
  const skip = /类型|配置|形状|样式|温度|精度|功率|极性|数量|封装|材质/
  for (const [key, value] of Object.entries(specs)) {
    if (value && !skip.test(key)) return value
  }
  return ''
}

/**
 * 这一类盒是否「按值排」。
 *
 * 电阻盒、电容电感盒的每一格对应一个固定阻值/容值（见 lib/db.ts 的 R1 位号表），
 * 看值最快；杂件盒、大件盒里装的料各不相同，几乎不靠值来找。
 */
export function isValueBox(prefix: string): boolean {
  return prefix === 'R' || prefix === 'CL'
}

/**
 * 格子里的「识别行」——位号下面那行字，回答「这格装的是什么东西」。
 *
 * 按值排的盒（R/CL）用规格值，其余盒用品名：杂件的规格值常常是
 * 「正向压降 3.3V」「间距 2.54mm」这类描述，当标题根本认不出是什么料。
 */
export function headlineOf(item: Pick<BoxItem, 'name' | 'value' | 'mpn'>, prefix: string): string {
  return isValueBox(prefix) ? item.value || item.name || item.mpn : item.name || item.value || item.mpn
}

/**
 * 把元件列表按盒分组。
 *
 * 同一格被两个元件占用的处理：第一个留下，后面的推进「未归位」并记进 conflicts。
 * 不静默覆盖 —— 覆盖会让其中一个元件在界面上凭空消失，人去找料时找不到才最麻烦。
 */
export function buildBoxLayout(items: BoxItem[]): BoxLayout {
  const groups = new Map<string, BoxGroup>()
  const unplaced: BoxItem[] = []
  const conflicts: string[] = []

  for (const item of items) {
    const ref = parseBoxRef(item.reference)
    if (!ref) {
      unplaced.push(item)
      continue
    }
    const key = `${ref.prefix}${ref.boxNumber}`
    let group = groups.get(key)
    if (!group) {
      group = createGroup(ref.prefix, ref.boxNumber)
      groups.set(key, group)
    }
    const cellKey = `${ref.row}${ref.col}`
    if (group.cells.has(cellKey)) {
      if (!conflicts.includes(group.key + cellKey)) conflicts.push(group.key + cellKey)
      unplaced.push(item)
      continue
    }
    group.cells.set(cellKey, item)
  }

  const boxes = [...groups.values()].sort((a, b) => {
    const orderA = BOX_META[a.prefix]?.order ?? 9
    const orderB = BOX_META[b.prefix]?.order ?? 9
    if (orderA !== orderB) return orderA - orderB
    if (a.prefix !== b.prefix) return a.prefix.localeCompare(b.prefix)
    return a.boxNumber.localeCompare(b.boxNumber, 'en', { numeric: true })
  })

  return {
    boxes,
    unplaced,
    conflicts,
    totalItems: items.length,
    totalCapacity: boxes.reduce((sum, box) => sum + box.capacity, 0),
  }
}
