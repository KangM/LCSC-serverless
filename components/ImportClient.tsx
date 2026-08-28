'use client'

import { useRef, useState } from 'react'
import { Button, Card, Input, Label } from './ui'

interface ImportRow {
  partNumber?: string
  mpn?: string
  quantity: number
}

interface PreviewItem extends ImportRow {
  index: number
  exists: boolean
  status: 'ok' | 'invalid'
  error?: string
}

interface BomRow {
  designator: string
  name: string
  footprint: string
  supplier: string
  quantity: number
}

interface BomCheckItem extends BomRow {
  matchedPartNumber: string | null
  matchedName: string | null
  referenceDesignator: string | null
  stockQuantity: number
  status: 'sufficient' | 'insufficient' | 'missing' | 'invalid'
  message: string
}

/** 本地时区的 YYYY-MM-DD（避免 toISOString 的 UTC 偏移差一天） */
function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 本地日期 YYYY-MM-DD → UTC ISO 边界（与流水页 TransactionFilters 一致） */
function toIsoBoundary(date: string, endOfDay: boolean): string {
  if (date.includes('T')) return date
  return endOfDay
    ? new Date(`${date}T23:59:59.999`).toISOString()
    : new Date(`${date}T00:00:00`).toISOString()
}

/** 简单 CSV 解析：支持常见列名（part_number/pn/编号, mpn/型号, quantity/qty/数量） */
function parseCsv(text: string): ImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return []
  const header = lines[0].split(',').map((h) => h.trim().toLowerCase())
  const col = {
    pn: header.findIndex((h) => ['part_number', 'partnumber', 'pc', '编号', '立创编号'].includes(h)),
    mpn: header.findIndex((h) => ['mpn', 'pm', '型号', '厂商型号'].includes(h)),
    qty: header.findIndex((h) => ['quantity', 'qty', '数量', '库存'].includes(h)),
  }
  const rows: ImportRow[] = []
  for (const line of lines.slice(1)) {
    const cols = line.split(',')
    const partNumber = col.pn >= 0 ? (cols[col.pn] ?? '').trim() : ''
    const mpn = col.mpn >= 0 ? (cols[col.mpn] ?? '').trim() : ''
    const qty = col.qty >= 0 ? Number(cols[col.qty]) : 1
    if (partNumber || mpn) {
      rows.push({
        partNumber: partNumber || undefined,
        mpn: mpn || undefined,
        quantity: Number.isFinite(qty) && qty > 0 ? Math.trunc(qty) : 0,
      })
    }
  }
  return rows
}

/** 解析立创/EDA 常见的带引号 CSV。 */
function parseCsvMatrix(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++ } else quoted = !quoted
    } else if (ch === ',' && !quoted) { row.push(cell); cell = ''
    } else if ((ch === '\n' || ch === '\r') && !quoted) {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); if (row.some((v) => v.trim())) rows.push(row)
      row = []; cell = ''
    } else cell += ch
  }
  row.push(cell); if (row.some((v) => v.trim())) rows.push(row)
  return rows
}

function parseBomCsv(text: string): BomRow[] {
  const matrix = parseCsvMatrix(text)
  if (matrix.length < 2) return []
  const header = matrix[0].map((v) => v.trim().toLowerCase())
  const col = {
    designator: header.findIndex((v) => ['designator', 'reference', '位号'].includes(v)),
    name: header.findIndex((v) => ['name', 'value', 'mpn', '型号', '名称'].includes(v)),
    footprint: header.findIndex((v) => ['footprint', 'package', '封装'].includes(v)),
    supplier: header.findIndex((v) => ['supplier', '供应商'].includes(v)),
    quantity: header.findIndex((v) => ['quantity', 'qty', '数量'].includes(v)),
  }
  return matrix.slice(1).map((cells) => ({
    designator: col.designator >= 0 ? (cells[col.designator] ?? '').trim() : '',
    name: col.name >= 0 ? (cells[col.name] ?? '').trim() : '',
    footprint: col.footprint >= 0 ? (cells[col.footprint] ?? '').trim() : '',
    supplier: col.supplier >= 0 ? (cells[col.supplier] ?? '').trim() : '',
    quantity: Math.trunc(Number(col.quantity >= 0 ? cells[col.quantity] : 0)),
  }))
}

export function ImportClient() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<ImportRow[]>([])
  const [preview, setPreview] = useState<PreviewItem[] | null>(null)
  const [result, setResult] = useState<{ succeeded: string[]; failed: Array<{ partNumber: string; error: string }> } | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const bomFileRef = useRef<HTMLInputElement>(null)
  const [bomFileName, setBomFileName] = useState('')
  const [bomRows, setBomRows] = useState<BomRow[]>([])
  const [bomResult, setBomResult] = useState<BomCheckItem[] | null>(null)
  const [bomLoading, setBomLoading] = useState(false)
  // 流水导出时间范围：默认最近一个月（与流水页默认一致）
  const [exportFrom, setExportFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return fmtDate(d)
  })
  const [exportTo, setExportTo] = useState(() => fmtDate(new Date()))

  function onFile(file: File) {
    setFileName(file.name)
    setPreview(null)
    setResult(null)
    setError('')
    const reader = new FileReader()
    reader.onload = () => {
      const parsed = parseCsv(String(reader.result ?? ''))
      if (!parsed.length) {
        setError('未解析到有效行：首行需为表头（part_number/mpn/quantity 或 编号/型号/数量）')
        setRows([])
        return
      }
      setRows(parsed)
    }
    reader.readAsText(file, 'utf-8')
  }

  async function doPreview() {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '预览失败')
        return
      }
      setPreview(data.items)
    } catch {
      setError('预览失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  async function doConfirm() {
    setLoading(true)
    setError('')
    try {
      const res = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || '导入失败')
        return
      }
      setResult(data)
      setPreview(null)
    } catch {
      setError('导入失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  function onBomFile(file: File) {
    setBomFileName(file.name)
    setBomResult(null)
    const reader = new FileReader()
    reader.onload = () => setBomRows(parseBomCsv(String(reader.result ?? '')))
    reader.readAsText(file, 'utf-8')
  }

  async function checkBomFile() {
    setBomLoading(true)
    try {
      const res = await fetch('/api/bom/check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rows: bomRows }) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || '核对失败')
      setBomResult(data.items)
    } catch (e) { setError(e instanceof Error ? e.message : 'BOM 核对失败') } finally { setBomLoading(false) }
  }

  const okCount = preview?.filter((p) => p.status === 'ok').length ?? 0

  return (
    <div className="space-y-4">
      <Card className="import_panel">
        <h2 className="section_title mb-3 text-sm font-semibold text-neutral-500">导入（CSV 批量入库）</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
          />
          <Button variant="secondary" onClick={() => fileRef.current?.click()}>
            选择 CSV 文件
          </Button>
          {fileName && <span className="sub_text text-sm text-neutral-600">{fileName}（{rows.length} 行）</span>}
        </div>
        <p className="hint_text mt-2 text-xs text-neutral-400">
          表头支持：part_number/pc/编号、mpn/型号、quantity/qty/数量。仅填型号时自动到立创搜索补全。
        </p>
        {rows.length > 0 && (
          <div className="mt-3 flex gap-2">
            <Button onClick={doPreview} disabled={loading}>
              {loading ? '处理中…' : '预览'}
            </Button>
            {preview && (
              <Button onClick={doConfirm} disabled={loading} variant="danger">
                确认导入（{okCount} 行有效）
              </Button>
            )}
          </div>
        )}
        {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
      </Card>

      {preview && (
        <Card className="preview_table !p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200 text-left text-xs text-neutral-500">
                <th className="table_head px-4 py-2">#</th>
                <th className="table_head px-4 py-2">编号 / 型号</th>
                <th className="table_head px-4 py-2 text-right">数量</th>
                <th className="table_head px-4 py-2">状态</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((p) => (
                <tr key={p.index} className="item border-b border-neutral-100 last:border-0">
                  <td className="sub_text px-4 py-1.5 text-neutral-400">{p.index + 1}</td>
                  <td className="px-4 py-1.5 font-mono">
                    {p.partNumber || p.mpn}
                    {p.partNumber && p.mpn ? ` · ${p.mpn}` : ''}
                  </td>
                  <td className="px-4 py-1.5 text-right">{p.quantity}</td>
                  <td className="px-4 py-1.5">
                    {p.status === 'invalid' ? (
                      <span className="status_text text-red-600">{p.error}</span>
                    ) : p.exists ? (
                      <span className="status_text text-blue-600">已存在 · 累加库存</span>
                    ) : (
                      <span className="status_text text-green-600">新元件 · 立创补全</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {result && (
        <Card className="import_result">
          <h2 className="section_title mb-2 text-sm font-semibold text-neutral-500">导入结果</h2>
          <p className="text-sm">
            ✅ 成功 <span className="font-semibold text-green-600">{result.succeeded.length}</span> 项
            {result.failed.length > 0 && (
              <span className="ml-3">
                ❌ 失败 <span className="font-semibold text-red-600">{result.failed.length}</span> 项
              </span>
            )}
          </p>
          {result.failed.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-1 overflow-y-auto text-xs text-red-600">
              {result.failed.map((f, i) => (
                <li key={i} className="item">{f.partNumber}：{f.error}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <Card>
        <h2 className="section_title mb-3 text-sm font-semibold text-neutral-500">BOM 库存核对</h2>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={bomFileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onBomFile(e.target.files[0])} />
          <Button variant="secondary" onClick={() => bomFileRef.current?.click()}>选择 BOM CSV</Button>
          {bomFileName && <span className="text-sm text-neutral-600">{bomFileName}（{bomRows.length} 行）</span>}
          <Button onClick={checkBomFile} disabled={!bomRows.length || bomLoading}>{bomLoading ? '核对中…' : '开始核对'}</Button>
        </div>
        <p className="hint_text mt-2 text-xs text-neutral-400">支持 Designator、Name、Footprint、Quantity 列；会按名称/型号、封装和规格匹配现有库存。</p>
        {bomResult && (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-neutral-200 text-left text-neutral-500"><th className="px-2 py-2">位号</th><th className="px-2 py-2">BOM 名称</th><th className="px-2 py-2">匹配元件</th><th className="px-2 py-2 text-right">需求</th><th className="px-2 py-2 text-right">库存</th><th className="px-2 py-2">结果</th></tr></thead>
              <tbody>{bomResult.map((item, index) => <tr key={`${item.designator}-${index}`} className="border-b border-neutral-100">
                <td className="px-2 py-1.5 font-mono">{item.designator || '-'}</td><td className="px-2 py-1.5">{item.name || '-'}</td>
                <td className="px-2 py-1.5">{item.matchedPartNumber ? `${item.matchedPartNumber}${item.referenceDesignator ? ` · ${item.referenceDesignator}` : ''}` : '-'}</td>
                <td className="px-2 py-1.5 text-right">{item.quantity || '-'}</td><td className="px-2 py-1.5 text-right">{item.stockQuantity}</td>
                <td className={`px-2 py-1.5 ${item.status === 'sufficient' ? 'text-green-600' : item.status === 'insufficient' ? 'text-amber-600' : 'text-red-600'}`}>{item.message}</td>
              </tr>)}</tbody>
            </table>
          </div>
        )}
      </Card>

      <Card className="export_panel">
        <h2 className="section_title mb-3 text-sm font-semibold text-neutral-500">导出</h2>
        <div className="flex flex-wrap items-end gap-2">
          <div className="field">
            <Label>开始日期</Label>
            <Input type="date" value={exportFrom} onChange={(e) => setExportFrom(e.target.value)} className="w-40" />
          </div>
          <div className="field">
            <Label>结束日期</Label>
            <Input type="date" value={exportTo} onChange={(e) => setExportTo(e.target.value)} className="w-40" />
          </div>
          <div className="flex overflow-hidden rounded-lg border border-neutral-300 bg-white">
            <a className="export_btn" href="/api/export/components">
              <Button variant="secondary" size="sm" className="rounded-none border-0">导出元件 CSV</Button>
            </a>
            <a className="export_btn border-l border-neutral-300" href="/api/export/components?format=print">
              <Button variant="secondary" size="sm" className="rounded-none border-0">导出打印格式</Button>
            </a>
          </div>
          {/* 流水导出按上方时间范围筛选（本地日期 → UTC ISO 边界） */}
          <a className="export_btn" href={`/api/export/transactions?${new URLSearchParams({
            ...(exportFrom ? { from: toIsoBoundary(exportFrom, false) } : {}),
            ...(exportTo ? { to: toIsoBoundary(exportTo, true) } : {}),
          }).toString()}`}>
            <Button variant="secondary" size="sm">导出流水 CSV（按时间范围）</Button>
          </a>
        </div>
      </Card>
    </div>
  )
}
