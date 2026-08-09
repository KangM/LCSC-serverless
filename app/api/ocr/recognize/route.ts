import { NextResponse, type NextRequest } from 'next/server'
import { recognizeImage } from '@/lib/ocr'

/** POST /api/ocr/recognize — body: { image: "data:image/...;base64,xxx" } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const image: unknown = body?.image
  if (typeof image !== 'string' || !image.startsWith('data:image/')) {
    return NextResponse.json({ ok: false, error: '缺少有效的图片数据（data URL）' }, { status: 400 })
  }
  try {
    const lines = await recognizeImage(image)
    return NextResponse.json({ ok: true, lines })
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : '识别失败' },
      { status: 400 },
    )
  }
}
