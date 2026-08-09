/**
 * lib/image-compress.ts — 浏览器端图片压缩（客户端专用，无 Node 依赖）
 *
 * 拍照/上传的图片（可能几 MB）先压缩到目标大小内再发送给 OCR 服务，
 * 减少传输体积与识别等待时间。
 *
 * 策略：最大边长限制 → JPEG 重编码；超过目标大小则逐步降低质量，
 * 质量到下限后缩小尺寸重试；最后尽力返回（不保证严格达标）。
 */

const DEFAULT_MAX_BYTES = 300 * 1024 // 300 KB
const MAX_EDGE = 1600 // 最长边上限（超大图先等比缩小）
const MIN_QUALITY = 0.4
const MAX_ATTEMPTS = 6

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('无法解析图片'))
    }
    img.src = url
  })
}

function drawToBlob(
  img: HTMLImageElement,
  width: number,
  height: number,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      reject(new Error('浏览器不支持 Canvas'))
      return
    }
    // JPEG 无透明通道，白底填充避免黑色背景
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(img, 0, 0, width, height)
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('图片压缩失败'))),
      'image/jpeg',
      quality,
    )
  })
}

/**
 * 压缩图片到目标大小内。
 * @param file 原始图片文件
 * @param maxBytes 目标大小（默认 300KB）
 * @returns 压缩后的 JPEG Blob（尽量接近目标，极端情况可能略超）
 */
export async function compressImage(file: File, maxBytes: number = DEFAULT_MAX_BYTES): Promise<Blob> {
  const img = await loadImage(file)

  let width = img.naturalWidth || 1200
  let height = img.naturalHeight || 900
  if (Math.max(width, height) > MAX_EDGE) {
    const scale = MAX_EDGE / Math.max(width, height)
    width = Math.round(width * scale)
    height = Math.round(height * scale)
  }

  let quality = 0.85
  let lastBlob: Blob | null = null

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const blob = await drawToBlob(img, width, height, quality)
    lastBlob = blob
    if (blob.size <= maxBytes) return blob

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 0.15)
    } else {
      // 质量已到下限仍超限：缩小尺寸后重置质量再试
      width = Math.round(width * 0.8)
      height = Math.round(height * 0.8)
      quality = 0.85
    }
  }

  // 尽力而为：返回最后一次（可能略超目标）
  return lastBlob ?? (await drawToBlob(img, width, height, MIN_QUALITY))
}

/** 格式化字节数（用于界面提示，如 "已压缩 128 KB"） */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
