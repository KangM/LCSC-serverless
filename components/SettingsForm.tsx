'use client'

import { useState } from 'react'
import { Button, Input, Label, Select } from './ui'

export interface OcrSettings {
  type: 'openai' | 'rapidocr' | ''
  openaiBaseUrl: string
  openaiApiKey: string
  openaiApiKeySet: boolean
  openaiModel: string
  rapidocrUrl: string
  rapidocrToken: string
}

export function SettingsForm({ initial }: { initial: OcrSettings }) {
  const [type, setType] = useState(initial.type)
  const [baseUrl, setBaseUrl] = useState(initial.openaiBaseUrl)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(initial.openaiModel)
  const [rapidUrl, setRapidUrl] = useState(initial.rapidocrUrl)
  const [rapidToken, setRapidToken] = useState(initial.rapidocrToken)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [saving, setSaving] = useState(false)

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const res = await fetch('/api/settings/ocr', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          openai_base_url: baseUrl,
          openai_api_key: apiKey, // 留空且已设置时服务端保留原值
          openai_model: model,
          rapidocr_url: rapidUrl,
          rapidocr_token: rapidToken,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMessage({ ok: false, text: data.error || '保存失败' })
        return
      }
      setApiKey('')
      setMessage({ ok: true, text: '已保存' })
    } catch {
      setMessage({ ok: false, text: '保存失败，请重试' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <div>
        <Label>OCR 服务类型</Label>
        <Select value={type} onChange={(e) => setType(e.target.value as OcrSettings['type'])}>
          <option value="">关闭（不使用拍照识别）</option>
          <option value="openai">OpenAI 兼容视觉接口（含免费服务）</option>
          <option value="rapidocr">RapidOCR 自托管</option>
        </Select>
      </div>

      {type === 'openai' && (
        <>
          <div className="rounded-lg bg-blue-50 p-3 text-xs text-blue-700">
            <p className="mb-1 font-medium">免费推荐（通用 OpenAI 兼容，填入即可）：</p>
            <ul className="list-inside list-disc space-y-0.5">
              <li>智谱 GLM-4V-Flash：baseUrl <code>https://open.bigmodel.cn/api/paas/v4</code>，model <code>glm-4v-flash</code></li>
              <li>硅基流动：<code>https://api.siliconflow.cn/v1</code>（部分视觉模型有免费额度）</li>
            </ul>
          </div>
          <div>
            <Label>Base URL</Label>
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://open.bigmodel.cn/api/paas/v4" />
          </div>
          <div>
            <Label>API Key</Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={initial.openaiApiKeySet ? '已设置（留空保持不变）' : '粘贴 API Key'}
            />
          </div>
          <div>
            <Label>模型</Label>
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="glm-4v-flash" />
          </div>
        </>
      )}

      {type === 'rapidocr' && (
        <>
          <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-700">
            本地部署：<code>pip install rapidocr_api &amp;&amp; rapidocr_api -p 9003</code>。
            服务需公网可达（Vercel 云端访问不到内网，可用 cloudflared / frp 隧道暴露），地址填 <code>https://…/ocr</code>。
          </div>
          <div>
            <Label>服务地址（含 /ocr 端点）</Label>
            <Input value={rapidUrl} onChange={(e) => setRapidUrl(e.target.value)} placeholder="https://your-host.example.com/ocr" />
          </div>
          <div>
            <Label>鉴权头（可选，如 Bearer token）</Label>
            <Input value={rapidToken} onChange={(e) => setRapidToken(e.target.value)} placeholder="留空表示无鉴权" />
          </div>
        </>
      )}

      {message && (
        <p className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>
      )}

      <Button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存设置'}</Button>
    </div>
  )
}
