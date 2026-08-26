import type { NextResponse } from 'next/server'

export interface ServerTimingMetric {
  name: string
  duration?: number
  description?: string
}

/** 将服务端分段耗时按标准 Server-Timing 格式暴露给浏览器 DevTools。 */
export function setServerTiming(response: NextResponse, metrics: ServerTimingMetric[]): NextResponse {
  const value = metrics
    .filter((metric) => Number.isFinite(metric.duration ?? 0))
    .map((metric) => {
      const duration = metric.duration === undefined ? '' : `;dur=${Math.max(0, metric.duration).toFixed(1)}`
      const description = metric.description ? `;desc=\"${metric.description.replaceAll('\"', '')}\"` : ''
      return `${metric.name}${duration}${description}`
    })
    .join(', ')
  response.headers.set('Server-Timing', value)
  return response
}
