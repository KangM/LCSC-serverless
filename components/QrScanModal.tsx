'use client'

import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode } from 'html5-qrcode'
import { Button, Modal } from './ui'

/**
 * 摄像头扫码弹窗（html5-qrcode，纯浏览器端）。
 * 识别成功即停止摄像头并把原始文本交给 onDecoded。
 * 摄像头不可用时提供「上传图片扫码」兜底。
 */
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
  const [error, setError] = useState('')
  const [scanning, setScanning] = useState(false)

  async function stop() {
    const scanner = scannerRef.current
    scannerRef.current = null
    if (scanner) {
      try {
        if (scanning) await scanner.stop()
      } catch {
        /* 已停止则忽略 */
      }
      try {
        scanner.clear()
      } catch {
        /* 忽略 */
      }
    }
    setScanning(false)
  }

  useEffect(() => {
    if (!open) return
    let cancelled = false
    let scanner: Html5Qrcode | null = null
    setError('')
    setScanning(false)

    async function startCamera() {
      try {
        scanner = new Html5Qrcode('qr-scan-region', false)
        scannerRef.current = scanner
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          (decodedText) => {
            if (!cancelled) {
              onDecoded(decodedText)
              void stop()
            }
          },
          () => {
            /* 帧解析失败回调，忽略 */
          },
        )
        if (!cancelled) setScanning(true)
      } catch (e) {
        if (!cancelled) {
          setError(
            '无法启动摄像头：' +
              (e instanceof Error && e.message.includes('Permission') ? '请允许摄像头权限' : '请检查摄像头或改用上传图片扫码'),
          )
        }
      }
    }

    void startCamera()
    return () => {
      cancelled = true
      const s = scanner
      scanner = null
      if (s) {
        try {
          void s.stop().then(() => s.clear()).catch(() => undefined)
        } catch {
          /* 忽略 */
        }
      }
    }
  }, [open, onDecoded])

  async function scanFromFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    try {
      const scanner = new Html5Qrcode('qr-scan-region', false)
      scannerRef.current = scanner
      const text = await scanner.scanFile(file, false)
      onDecoded(text)
      scanner.clear()
      scannerRef.current = null
    } catch {
      setError('未能从图片中识别出二维码')
    }
  }

  return (
    <Modal open={open} title="扫描立创二维码" onClose={() => { void stop(); onClose() }}>
      <div className="space-y-3">
        <div id="qr-scan-region" className="mx-auto w-full max-w-xs overflow-hidden rounded-lg bg-black" />
        {error && <p className="text-center text-sm text-red-600">{error}</p>}
        {scanning && <p className="text-center text-xs text-neutral-400">对准立创料盘/包装上的二维码…</p>}
        <div className="flex items-center justify-center gap-3 text-sm">
          <span className="text-neutral-400">或</span>
          <label className="cursor-pointer text-blue-600 hover:underline">
            上传图片扫码
            <input type="file" accept="image/*" capture="environment" className="hidden" onChange={scanFromFile} />
          </label>
        </div>
        <div className="flex justify-end">
          <Button
            variant="secondary"
            onClick={() => { void stop(); onClose() }}
          >
            关闭
          </Button>
        </div>
      </div>
    </Modal>
  )
}
