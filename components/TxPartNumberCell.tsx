'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { ComponentDetailModal } from './ComponentDetailModal'

/** 流水页的元件编号列：点击打开详情弹窗（不跳转），操作后刷新流水页 */
export function TxPartNumberCell({ partNumber }: { partNumber: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="part_link font-mono text-blue-700 hover:underline"
      >
        {partNumber}
      </button>
      <ComponentDetailModal
        open={open}
        partNumber={partNumber}
        onClose={() => setOpen(false)}
        onChanged={() => router.refresh()}
      />
    </>
  )
}
