'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button, Modal, cn } from './ui'

/**
 * 摄像头扫码弹窗（html5-qrcode，纯浏览器端）。
 *
 * 两个硬约束，决定了 UI 必须分叉：
 * 1. `getUserMedia` 只在**安全上下文**（https 或 localhost）可用。手机通过
 *    http://192.168.x.x、http://lcsc.local 访问时，浏览器根本不给摄像头，
 *    html5-qrcode 只会抛一个含糊的错误。所以先探环境，不适配就直接走拍照识别。
 * 2. 拍照识别（<input type="file" capture>）不受安全上下文限制：它唤起的是
 *    系统相机，拍完把照片交给 scanFile 在本地解码，HTTP 下也能用。
 *    这是手机端唯一稳定可用的路径，因此做成主按钮而不是藏在角落的兜底链接。
 *
 * 识别成功即停止摄像头并把原始文本交给 onDecoded。
 */

type CameraSupport = 'ok' | 'insecure' | 'unsupported'

/** 探当前页面能不能直接开摄像头。 */
function detectCameraSupport(): CameraSupport {
  if (typeof window === 'undefined') return 'unsupported'
  const secure =
    window.isSecureContext ||
    window.location.protocol === 'https:' ||
    ['localhost', '127.0.0.1'].includes(window.location.hostname)
  if (!secure) return 'insecure'
  return typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'ok' : 'unsupported'
}

/** 把浏览器的原始错误翻译成能照着做的提示（原来的实现在这里丢掉了错误名）。 */
function describeCameraError(e: unknown): string {
  const name = e instanceof Error ? e.name : ''
  const message = e instanceof Error ? e.message : String(e ?? '')
  const text = `${name} ${message}`
  if (/Permission|NotAllowed|Security/i.test(text)) {
    return '浏览器拒绝了摄像头权限：iPhone 去「设置 → Safari → 相机」改成允许；安卓点地址栏左边的锁图标授权后刷新'
  }
  if (/NotFound|DevicesNotFound|Overconstrained/i.test(text)) {
    return '这台设备没有找到可用的摄像头，请用下面的拍照识别'
  }
  if (/NotReadable|TrackStart|AbortError/i.test(text)) {
    return '摄像头被其他应用占用，先关掉相机或其他扫码 App 再试'
  }
  return `无法启动摄像头${name ? `（${name}）` : ''}，请用下面的拍照识别`
}

export function QrScanModal({
  open,
  onClose,
  onDecoded,
}: {
  open: boolean
  onClose: () => void
  onDecoded: (text: string) => void
}) {
  const scannerRef = useRef<Html5Qrcode | null>(null)
  // 只在挂载时探一次：调用方用 {open && <QrScanModal/>} 保证挂在客户端，
  // 所以这里不会出现 SSR 探测不到 window 的情况。
  const [support] = useState<CameraSupport>(() => detectCameraSupport())
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)

  const stopCamera = useCallback(async () => {
    const scanner = scannerRef.current
    scannerRef.current = null
    setScanning(false)
    if (!scanner) return
    try {
      await scanner.stop()
    } catch {
      /* 未启动或已停止，忽略 */
    }
    try {
      scanner.clear()
    } catch {
      /* 忽略 */
    }
  }, [])

  useEffect(() => {
    if (support !== 'ok') return
    let cancelled = false
    let active: Html5Qrcode | null = null

    const handleDecoded = (text: string) => {
      if (cancelled) return
      onDecoded(text)
      void stopCamera()
    }

    void (async () => {
      const config = {
        fps: 10,
        // 固定 220px 在小屏上会超出取景框，按视口比例算
        qrbox: (width: number, height: number) => {
          const size = Math.max(120, Math.floor(Math.min(width, height) * 0.7))
          return { width: size, height: size }
        },
      }
      // 有些安卓机对 facingMode 的实现有问题（多摄枚举不全），逐个降级试
      const attempts: Array<{ facingMode: string }> = [
        { facingMode: 'environment' },
        { facingMode: 'user' },
      ]
      let lastError: unknown = null

      for (const attempt of attempts) {
        if (cancelled) return
        const scanner = new Html5Qrcode('qr-scan-region', false)
        try {
          await scanner.start(attempt, config as never, handleDecoded, () => {
            /* 帧解析失败回调，忽略 */
          })
          if (cancelled) {
            try {
              await scanner.stop()
              scanner.clear()
            } catch {
              /* 忽略 */
            }
            return
          }
          active = scanner
          scannerRef.current = scanner
          setScanning(true)
          setError('')
          return
        } catch (e) {
          lastError = e
          try {
            scanner.clear()
          } catch {
            /* 忽略 */
          }
        }
      }

      if (!cancelled) setError(describeCameraError(lastError))
    })()

    return () => {
      cancelled = true
      if (active) {
        const scanner = active
        active = null
        scannerRef.current = null
        try {
          void scanner
            .stop()
            .then(() => scanner.clear())
            .catch(() => undefined)
        } catch {
          /* 忽略 */
        }
      }
      setScanning(false)
    }
  }, [support, onDecoded, stopCamera])

  const handleClose = useCallback(() => {
    void stopCamera()
    setError('')
    setBusy(false)
    onClose()
  }, [stopCamera, onClose])

  /** 拍照/选图后本地解码：不依赖摄像头权限，HTTP 下也能用 */
  async function scanFromFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // 清空 value，否则同一张图重选不会触发 change
    event.target.value = ''
    if (!file) return

    await stopCamera()
    setError('')
    setBusy(true)

    const scanner = new Html5Qrcode('qr-scan-region', false)
    try {
      const text = await scanner.scanFile(file, false)
      onDecoded(text)
    } catch {
      setError('没能从这张图里认出二维码。让码占满画面、避开反光再拍一次，或用相册选一张更清晰的')
    } finally {
      try {
        scanner.clear()
      } catch {
        /* 忽略 */
      }
      setBusy(false)
    }
  }

  return (
    <Modal open={open} title="扫描立创二维码" onClose={handleClose}>
      <div className="space-y-3">
        {/* 摄像头取景框；环境不支持时隐藏但保留节点，拍照识别要在里面画 canvas */}
        <div
          id="qr-scan-region"
          className={cn(
            'mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-black',
            support !== 'ok' && 'hidden',
          )}
        />

        {support === 'insecure' && (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
            当前是 <span className="font-medium">http://</span> 访问，浏览器不允许网页直接开摄像头（只有
            https 才行）。用下面的「拍照识别」：会调起手机系统相机，拍完自动识别，效果一样。
          </div>
        )}
        {support === 'unsupported' && (
          <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-600">
            这个浏览器不支持网页调摄像头，请用下面的拍照识别。
          </div>
        )}

        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        {busy && <p className="text-center text-xs text-neutral-500">正在识别图片…</p>}
        {!busy && scanning && (
          <p className="text-center text-xs text-neutral-400">对准立创料盘/包装上的二维码…</p>
        )}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
          <label
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-700',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            拍照识别
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={scanFromFile}
            />
          </label>
          <label
            className={cn(
              'inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-neutral-300 bg-white px-4 py-2 text-sm font-medium text-neutral-700 transition hover:bg-neutral-50',
              busy && 'pointer-events-none opacity-60',
            )}
          >
            从相册选图
            <input type="file" accept="image/*" className="hidden" onChange={scanFromFile} />
          </label>
        </div>

        <div className="flex justify-end">
          <Button variant="secondary" onClick={handleClose}>
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
