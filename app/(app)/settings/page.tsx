import type { Metadata } from 'next'
import { Card } from '@/components/ui'
import { SettingsForm } from '@/components/SettingsForm'
import { getOcrConfig } from '@/lib/ocr'

export const metadata: Metadata = { title: '设置 · 元件库存管理' }

export default async function SettingsPage() {
  const config = await getOcrConfig()

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">设置</h1>
      <Card>
        <h2 className="mb-4 text-sm font-semibold text-neutral-500">OCR 拍照识别</h2>
        <SettingsForm
          initial={{
            type: config.type,
            openaiBaseUrl: config.openaiBaseUrl,
            openaiApiKey: config.openaiApiKey,
            openaiApiKeySet: Boolean(config.openaiApiKey),
            openaiModel: config.openaiModel,
            rapidocrUrl: config.rapidocrUrl,
            rapidocrToken: config.rapidocrToken,
          }}
        />
      </Card>
    </div>
  )
}
