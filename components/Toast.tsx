'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'

type ToastType = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  type: ToastType
  message: string
}

interface ToastApi {
  success: (message: string) => void
  error: (message: string) => void
  info: (message: string) => void
}

const ToastContext = createContext<ToastApi | null>(null)

const STYLES: Record<ToastType, { bar: string; icon: string }> = {
  success: { bar: 'bg-green-600', icon: '✅' },
  error: { bar: 'bg-red-600', icon: '❌' },
  info: { bar: 'bg-blue-600', icon: 'ℹ️' },
}

/** 全局 toast：<ToastProvider> 包裹后任意客户端组件 useToast() */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)

  const push = useCallback((type: ToastType, message: string) => {
    const id = nextId.current++
    setToasts((prev) => [...prev.slice(-3), { id, type, message }])
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id))
    }, 3000)
  }, [])

  const api: ToastApi = {
    success: useCallback((m) => push('success', m), [push]),
    error: useCallback((m) => push('error', m), [push]),
    info: useCallback((m) => push('info', m), [push]),
  }

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-center gap-2 rounded-lg bg-white px-3 py-2.5 text-sm shadow-lg ring-1 ring-black/5"
            role="status"
          >
            <span aria-hidden>{STYLES[t.type].icon}</span>
            <span className="min-w-0 flex-1 break-words text-neutral-700">{t.message}</span>
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STYLES[t.type].bar}`} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast 必须在 <ToastProvider> 内使用')
  return ctx
}
