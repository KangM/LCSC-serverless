import type { Metadata } from 'next'
import { ImportClient } from '@/components/ImportClient'

export const metadata: Metadata = { title: '导入导出 · 元件库存管理' }

export default function ImportPage() {
  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">导入导出</h1>
      <ImportClient />
    </div>
  )
}
