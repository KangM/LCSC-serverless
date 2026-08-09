/**
 * lib/ocr.ts — 图片文字识别（服务端专用）
 *
 * 两种 Provider，配置存数据库 settings 表（设置页维护）：
 *   1. openai    — 通用 OpenAI 兼容视觉接口（/chat/completions）
 *                  免费推荐：智谱 GLM-4V-Flash（baseUrl=https://open.bigmodel.cn/api/paas/v4, model=glm-4v-flash）
 *   2. rapidocr  — 本地自托管 RapidOCR API（POST /ocr，image_data 表单字段，返回 rec_txt/score）
 *                  部署：pip install rapidocr_api && rapidocr_api -p 9003，需公网可达
 */
import 'server-only'
import { getSetting } from './db'

export interface OcrLine {
  text: string
  score: number
}

export interface OcrConfig {
  type: 'openai' | 'rapidocr' | ''
  openaiBaseUrl: string
  openaiApiKey: string
  openaiModel: string
  rapidocrUrl: string
  rapidocrToken: string
}

/** 从数据库读取 OCR 配置 */
export async function getOcrConfig(): Promise<OcrConfig> {
  const [type, baseUrl, apiKey, model, rapidUrl, rapidToken] = await Promise.all([
    getSetting('ocr_type'),
    getSetting('ocr_openai_base_url'),
    getSetting('ocr_openai_api_key'),
    getSetting('ocr_openai_model'),
    getSetting('ocr_rapidocr_url'),
    getSetting('ocr_rapidocr_token'),
  ])
  return {
    type: type === 'openai' || type === 'rapidocr' ? type : '',
    openaiBaseUrl: baseUrl ?? '',
    openaiApiKey: apiKey ?? '',
    openaiModel: model ?? '',
    rapidocrUrl: rapidUrl ?? '',
    rapidocrToken: rapidToken ?? '',
  }
}

/** OCR 是否已配置可用 */
export function isOcrConfigured(config: OcrConfig): boolean {
  if (config.type === 'openai') {
    return Boolean(config.openaiBaseUrl && config.openaiApiKey && config.openaiModel)
  }
  if (config.type === 'rapidocr') {
    return Boolean(config.rapidocrUrl)
  }
  return false
}

/** 识别提示词：只输出识别文本，每行一条 */
const OCR_PROMPT =
  '请识别这张图片中印刷的全部文字（可能是元件丝印、标签、料盘或包装上的文字）。' +
  '只输出识别出的文本内容，每行一条，不要编号、不要解释、不要任何额外文字。'

/**
 * 识别图片中的文字。
 * @param dataUrl 客户端传来的 data URL（data:image/...;base64,xxx）
 * @returns 按阅读顺序的文本行
 */
export async function recognizeImage(dataUrl: string): Promise<OcrLine[]> {
  const config = await getOcrConfig()
  if (!isOcrConfigured(config)) {
    throw new Error('尚未配置 OCR 服务，请先到「设置」页配置')
  }
  const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl
  if (!base64) throw new Error('图片数据无效')

  if (config.type === 'openai') {
    return recognizeWithOpenAI(base64, config)
  }
  return recognizeWithRapidOcr(base64, config)
}

// ---------------------------------------------------------------------------
// OpenAI 兼容视觉接口
// ---------------------------------------------------------------------------

async function recognizeWithOpenAI(base64: string, config: OcrConfig): Promise<OcrLine[]> {
  const base = config.openaiBaseUrl.replace(/\/+$/, '')
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.openaiApiKey}`,
    },
    body: JSON.stringify({
      model: config.openaiModel,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: OCR_PROMPT },
            {
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${base64}` },
            },
          ],
        },
      ],
      max_tokens: 600,
      temperature: 0,
    }),
  })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OCR 服务返回 ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const content: unknown = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('OCR 服务未返回识别文本')
  }
  return content
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, score: 1 }))
}

// ---------------------------------------------------------------------------
// RapidOCR 自托管 API
// ---------------------------------------------------------------------------

async function recognizeWithRapidOcr(base64: string, config: OcrConfig): Promise<OcrLine[]> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (config.rapidocrToken) headers['Authorization'] = config.rapidocrToken

  const res = await fetch(config.rapidocrUrl, {
    method: 'POST',
    headers,
    body: new URLSearchParams({ image_data: base64 }),
    // 自托管服务可能在公网隧道后，给足超时
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    throw new Error(`RapidOCR 服务返回 ${res.status}，请确认服务地址与网络可达`)
  }
  const data: unknown = await res.json()
  if (!data || typeof data !== 'object') throw new Error('RapidOCR 响应格式异常')

  const lines: OcrLine[] = []
  for (const value of Object.values(data as Record<string, unknown>)) {
    if (value && typeof value === 'object') {
      const recTxt = (value as Record<string, unknown>).rec_txt
      if (typeof recTxt === 'string' && recTxt.trim()) {
        const score = Number((value as Record<string, unknown>).score)
        lines.push({ text: recTxt.trim(), score: Number.isFinite(score) ? score : 0 })
      }
    }
  }
  return lines
}
