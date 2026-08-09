'use client'

import { useState } from 'react'
import { Button } from './ui'
import { InboundModal } from './InboundModal'

export function DashboardQuickActions() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button onClick={() => setOpen(true)}>+ 入库</Button>
      <InboundModal open={open} onClose={() => setOpen(false)} onDone={() => {}} />
    </>
  )
}
