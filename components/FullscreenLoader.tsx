'use client'

/**
 * 全屏 Loading 遮罩：用于耗时请求（OCR 识别等）防止用户误操作中断。
 * z-[90] 高于普通弹窗（z-50），低于 toast（z-100）。
 */
export function FullscreenLoader({ message }: { message?: string }) {
  return (
    <div className="fixed inset-0 z-[90] flex flex-col items-center justify-center gap-4 bg-black/40" role="status">
      <div className="h-12 w-12 animate-spin rounded-full border-4 border-white/30 border-t-white" />
      <p className="text-sm font-medium text-white drop-shadow">{message ?? '处理中…'}</p>
    </div>
  )
}
