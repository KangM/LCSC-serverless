'use client'

import { useEffect, useState } from 'react'

/**
 * 挂载后才用浏览器本地时区格式化时间文本。
 * 服务端组件（Vercel 为 UTC）直接 toLocaleString 会与客户端（东八区）
 * 输出不同文本，触发 React #441 水合不匹配；首帧渲染空串保证一致。
 */
export function TimeText({ value }: { value: string }) {
  const [text, setText] = useState('')
  useEffect(() => {
    setText(new Date(value).toLocaleString('zh-CN'))
  }, [value])
  return <>{text}</>
}
