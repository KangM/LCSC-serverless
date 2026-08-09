'use client'

import { useRef, useState } from 'react'
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

  // --- OCR 测试 ---
  const testFileRef = useRef<HTMLInputElement>(null)
  const [testImage, setTestImage] = useState('')
  const [testLines, setTestLines] = useState<Array<{ text: string; score: number }> | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')

  async function testOcr(file: File) {
    setTesting(true)
    setTestError('')
    setTestLines(null)
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('读取图片失败'))
        reader.readAsDataURL(file)
      })
      setTestImage(dataUrl)
      const res = await fetch('/api/ocr/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: dataUrl }),
      })
      const data = await res.json()
      if (!res.ok) {
        setTestError(data.error || '识别失败')
        return
      }
      setTestLines(data.lines ?? [])
    } catch {
      setTestError('识别失败，请重试')
    } finally {
      setTesting(false)
    }
  }

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

      {/* OCR 测试 */}
      <div className="rounded-lg border border-neutral-200 p-4">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-medium text-neutral-700">测试 OCR 识别</h3>
          <input
            ref={testFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && testOcr(e.target.files[0])}
          />
          <Button size="sm" variant="secondary" onClick={() => testFileRef.current?.click()} disabled={testing}>
            {testing ? '识别中…' : '上传图片测试'}
          </Button>
        </div>
        {testImage && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={testImage} alt="测试图" className="mb-2 max-h-36 rounded object-contain" />
        )}
        {testError && <p className="text-sm text-red-600">{testError}</p>}
        {testLines && (
          <div>
            <p className="mb-1 text-xs text-neutral-500">识别到 {testLines.length} 行：</p>
            <ul className="space-y-1">
              {testLines.length === 0 ? (
                <li className="text-sm text-neutral-400">未识别到文字</li>
              ) : (
                testLines.map((l, i) => (
                  <li key={i} className="flex items-baseline justify-between gap-2 rounded bg-neutral-50 px-2 py-1 text-sm">
                    <span className="min-w-0 break-all">{l.text}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{Math.round(l.score * 100)}%</span>
                  </li>
                ))
              )}
            </ul>
          </div>
        )}
      </div>
    </div>
  )
}
