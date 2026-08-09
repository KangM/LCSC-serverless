'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, Label, Select } from './ui'

/** URL 参数里的 UTC ISO → 本地日期（date input 显示用） */
function toLocalDate(value: string): string {
  return value.includes('T') ? new Date(value).toLocaleDateString('sv-SE') : value
}

/** 本地日期 YYYY-MM-DD → UTC ISO 边界 */
function toIsoBoundary(date: string, endOfDay: boolean): string {
  if (date.includes('T')) return date
  return endOfDay
    ? new Date(`${date}T23:59:59.999`).toISOString()
    : new Date(`${date}T00:00:00`).toISOString()
}

export function TransactionFilters({
  initial,
}: {
  initial: { partNumber: string; type: string; from: string; to: string }
}) {
  const router = useRouter()
  const [partNumber, setPartNumber] = useState(initial.partNumber)
  const [type, setType] = useState(initial.type)
  const [from, setFrom] = useState(toLocalDate(initial.from))
  const [to, setTo] = useState(toLocalDate(initial.to))

  function apply() {
    const sp = new URLSearchParams()
    if (partNumber) sp.set('pn', partNumber)
    if (type) sp.set('type', type)
    if (from) sp.set('from', toIsoBoundary(from, false))
    if (to) sp.set('to', toIsoBoundary(to, true))
    const qs = sp.toString()
    router.replace(qs ? `/transactions?${qs}` : '/transactions')
  }

  return (
    <div className="flex flex-wrap items-end gap-2">
      <div>
        <Label>元件编号</Label>
        <Input value={partNumber} onChange={(e) => setPartNumber(e.target.value)} placeholder="如 C14663" className="w-36" />
      </div>
      <div>
        <Label>类型</Label>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="w-28">
          <option value="">全部</option>
          <option value="in">入库</option>
          <option value="out">出库</option>
          <option value="adjust">盘点</option>
        </Select>
      </div>
      <div>
        <Label>开始日期</Label>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
      </div>
      <div>
        <Label>结束日期</Label>
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
      </div>
      <Button onClick={apply}>筛选</Button>
    </div>
  )
}
