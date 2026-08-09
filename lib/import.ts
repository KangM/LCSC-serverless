/**
 * lib/import.ts — CSV 批量导入逻辑（服务端）
 * preview：只校验行 + 查数据库存在性（不调立创，快）
 * confirm：逐行入库，缺失信息实时查立创补全（经限速，行数多时较慢）
 */
import 'server-only'
import { getComponentsByPartNumbers, stockIn } from './db'
import { lcsc } from './lcsc'

export interface ImportRow {
  partNumber?: string
  mpn?: string
  quantity: number
}

interface PreviewItem {
  index: number
  partNumber: string
  mpn?: string
  quantity: number
  exists: boolean
  status: 'ok' | 'invalid'
  error?: string
}

function normalizeRows(raw: unknown): ImportRow[] {
  if (!Array.isArray(raw)) return []
  return raw.map((r) => {
    const row = r as Record<string, unknown>
    const partNumber = typeof row.partNumber === 'string' ? row.partNumber.trim().toUpperCase() : ''
    const mpn = typeof row.mpn === 'string' ? row.mpn.trim() : ''
    const qty = Number(row.quantity)
    return {
      partNumber: partNumber || undefined,
      mpn: mpn || undefined,
      quantity: Number.isFinite(qty) ? Math.trunc(qty) : 0,
    }
  })
}

/** 预览：校验行并标注库中是否存在 */
export async function previewImport(rawRows: unknown): Promise<{ items: PreviewItem[] }> {
  const rows = normalizeRows(rawRows)
  const items: PreviewItem[] = []

  for (const [index, row] of rows.entries()) {
    if (row.quantity < 1 || (!row.partNumber && !row.mpn)) {
      items.push({
        index,
        partNumber: row.partNumber ?? row.mpn ?? '',
        mpn: row.mpn,
        quantity: row.quantity,
        exists: false,
        status: 'invalid',
        error: '缺少编号/型号或数量无效',
      })
      continue
    }
    const existing = row.partNumber
      ? await getComponentsByPartNumbers([row.partNumber])
      : new Map<string, never>()
    items.push({
      index,
      partNumber: row.partNumber ?? row.mpn ?? '',
      mpn: row.mpn,
      quantity: row.quantity,
      exists: row.partNumber ? existing.has(row.partNumber) : false,
      status: 'ok',
    })
  }
  return { items }
}

/** 确认导入：已存在直接加库存；不存在查立创补全后入库 */
export async function confirmImport(
  rawRows: unknown,
): Promise<{ succeeded: string[]; failed: Array<{ partNumber: string; error: string }> }> {
  const rows = normalizeRows(rawRows)
  const succeeded: string[] = []
  const failed: Array<{ partNumber: string; error: string }> = []

  for (const row of rows) {
    if (row.quantity < 1 || (!row.partNumber && !row.mpn)) {
      failed.push({ partNumber: row.partNumber ?? row.mpn ?? '?', error: '缺少编号/型号或数量无效' })
      continue
    }
    try {
      let partNumber = row.partNumber
      const exists = partNumber ? (await getComponentsByPartNumbers([partNumber])).has(partNumber) : false
      if (!exists) {
        let detail = partNumber ? await lcsc.lookupByPartNumber(partNumber) : null
        if (!detail && row.mpn) {
          const found = await lcsc.searchByKeyword(row.mpn)
          const exact = found.find(
            (c) => c.mpn?.toUpperCase() === row.mpn!.toUpperCase() || c.partNumber.toUpperCase() === row.mpn!.toUpperCase(),
          )
          detail = exact ?? found[0] ?? null
        }
        if (!detail) {
          failed.push({ partNumber: row.partNumber ?? row.mpn ?? '?', error: '立创未找到，无法补全' })
          continue
        }
        partNumber = detail.partNumber
      }
      await stockIn(partNumber!, row.quantity, { note: 'CSV 批量导入' })
      succeeded.push(partNumber!)
    } catch (error) {
      failed.push({
        partNumber: row.partNumber ?? row.mpn ?? '?',
        error: error instanceof Error ? error.message : '导入失败',
      })
    }
  }
  return { succeeded, failed }
}
