'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'

/** 链接式分页：跟随当前 URL 筛选参数，只替换 page */
function TxPaginationInner({ totalPages }: { totalPages: number }) {
  const sp = useSearchParams()
  const page = Number(sp.get('page')) || 1
  if (totalPages <= 1) return null

  function href(p: number) {
    const next = new URLSearchParams(sp.toString())
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    const qs = next.toString()
    return qs ? `/transactions?${qs}` : '/transactions'
  }

  return (
    <div className="pagination flex items-center justify-center gap-2 pt-1 text-sm">
      {page > 1 && (
        <Link href={href(page - 1)} className="page_link rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
          上一页
        </Link>
      )}
      <span className="page_indicator text-neutral-500">
        {page} / {totalPages}
      </span>
      {page < totalPages && (
        <Link href={href(page + 1)} className="page_link rounded-lg border border-neutral-300 px-3 py-1.5 hover:bg-neutral-50">
          下一页
        </Link>
      )}
    </div>
  )
}

export function TxPagination({ totalPages }: { totalPages: number }) {
  return (
    <Suspense fallback={null}>
      <TxPaginationInner totalPages={totalPages} />
    </Suspense>
  )
}
