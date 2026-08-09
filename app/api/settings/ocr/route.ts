import { NextResponse, type NextRequest } from 'next/server'
import { getOcrConfig } from '@/lib/ocr'
import { getSetting, setSetting } from '@/lib/db'

/**
 * GET /api/settings/ocr — 读取 OCR 配置（apiKey 脱敏，仅显示后 4 位）
 * PUT /api/settings/ocr — 保存 OCR 配置（type / openai_base_url / openai_api_key / openai_model / rapidocr_url / rapidocr_token）
 */
export async function GET() {
  const config = await getOcrConfig()
  return NextResponse.json({
    ok: true,
    config: {
      ...config,
      openaiApiKey: config.openaiApiKey ? `****${config.openaiApiKey.slice(-4)}` : '',
      openaiApiKeySet: Boolean(config.openaiApiKey),
    },
  })
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const type: unknown = body?.type

  if (type !== 'openai' && type !== 'rapidocr' && type !== '') {
    return NextResponse.json({ ok: false, error: 'OCR 类型无效' }, { status: 400 })
  }
  await setSetting('ocr_type', type)

  if (type === 'openai') {
    // apiKey 为空且原来已设置 → 保留原值（前端只传脱敏值时不覆盖）
    const existing = await getOcrConfig()
    const apiKey = typeof body?.openai_api_key === 'string' && body.openai_api_key
      ? body.openai_api_key
      : existing.openaiApiKey
    await setSetting('ocr_openai_base_url', typeof body?.openai_base_url === 'string' ? body.openai_base_url : '')
    await setSetting('ocr_openai_api_key', apiKey)
    await setSetting('ocr_openai_model', typeof body?.openai_model === 'string' ? body.openai_model : '')
  } else if (type === 'rapidocr') {
    await setSetting('ocr_rapidocr_url', typeof body?.rapidocr_url === 'string' ? body.rapidocr_url : '')
    await setSetting('ocr_rapidocr_token', typeof body?.rapidocr_token === 'string' ? body.rapidocr_token : '')
  }

  const config = await getOcrConfig()
  return NextResponse.json({
    ok: true,
    config: { ...config, openaiApiKey: config.openaiApiKey ? '****' + config.openaiApiKey.slice(-4) : '', openaiApiKeySet: Boolean(config.openaiApiKey) },
  })
}
