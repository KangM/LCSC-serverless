'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { Button } from './ui'

/** 刷新当前服务端渲染结果（备份状态是每次请求读取的，点一下即可更新） */
export function BackupRefreshButton() {
  const router = useRouter()
  const [pending, start] = useTransition()

  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={pending}
      onClick={() => start(() => router.refresh())}
    >
      {pending ? '刷新中…' : '刷新'}
    </Button>
  )
}
