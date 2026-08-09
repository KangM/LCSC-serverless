'use client'

import { useState } from 'react'

/**
 * 缩略图悬浮放大：鼠标悬停在缩略图上时，在鼠标旁跟随显示大图预览。
 */
export function ImageHoverZoom({
  src,
  alt,
  className,
}: {
  src: string
  alt?: string
  className?: string
}) {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  return (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt ?? ''}
        className={className}
        referrerPolicy="no-referrer"
        loading="lazy"
        onMouseEnter={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
        onMouseLeave={() => setPos(null)}
      />
      {pos && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? ''}
          referrerPolicy="no-referrer"
          className="pointer-events-none fixed z-[60] h-48 w-48 rounded-lg border border-neutral-200 bg-white object-contain shadow-2xl"
          style={{ left: Math.min(pos.x + 16, window.innerWidth - 208), top: Math.min(pos.y + 16, window.innerHeight - 208) }}
        />
      )}
    </>
  )
}
