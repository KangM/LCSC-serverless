/**
 * POST /api/bom/inject — 上传立创EDA「辅助焊接」导出的 HTML，
 * 返回注入了「库存位置（= 系统位号）」备料清单的 HTML。
 *
 * 走 multipart/form-data，字段名 file。
 * 解析与注入逻辑在 lib/bom-html.mjs，与 CLI（scripts/inject-bom-location.mjs）同一份。
 */
import { NextResponse, type NextRequest } from 'next/server'
import {
  PANEL_SOURCE,
  buildItems,
  buildPayload,
  extractWindowFiles,
  injectPanel,
  matchInventory,
  parseBom,
  pcbNameFromFileName,
} from '@/lib/bom-html.mjs'
import { getInventorySnapshot } from '@/lib/db'

/** 立创这份导出实测 ~12MB；给到 64MB 足够，同时挡住误传的大文件 */
const MAX_BYTES = 64 * 1024 * 1024

export async function POST(request: NextRequest) {
  let form: FormData
  try {
    form = await request.formData()
  } catch (error) {
    const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    console.error('[bom/inject] formData 解析失败:', detail)
    return NextResponse.json({ error: '上传的数据没能解析成文件，请重试', detail }, { status: 400 })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: '请选择立创导出的辅助焊接 HTML 文件' }, { status: 400 })
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `文件太大（${(file.size / 1048576).toFixed(1)}MB），上限 ${MAX_BYTES / 1048576}MB` },
      { status: 413 },
    )
  }

  try {
    const html = await file.text()
    const items = buildItems(parseBom(extractWindowFiles(html).obj))
    if (!items.length) {
      return NextResponse.json({ error: '解析出 0 个贴片位号 —— 导出时可能没勾选任何元件' }, { status: 422 })
    }

    const snapshot = await getInventorySnapshot()
    const byPart = new Map<string, (typeof snapshot)[number]>()
    const byMpn = new Map<string, (typeof snapshot)[number]>()
    for (const row of snapshot) {
      if (row.partNumber) byPart.set(row.partNumber.toUpperCase(), row)
      if (row.mpn) byMpn.set(row.mpn.toUpperCase(), row)
    }

    const matched = matchInventory(items, { byPart, byMpn })
    const payload = buildPayload({
      items: matched,
      pcbName: pcbNameFromFileName(file.name),
      sourceLabel: '系统',
    })
    const output = injectPanel(html, payload, PANEL_SOURCE)

    const base = file.name.replace(/\.html?$/i, '')
    const downloadName = `${base}-库存位置.html`
    return new NextResponse(output, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        // filename 用 ASCII 兜底，filename* 给中文；浏览器优先取 filename*
        'Content-Disposition': `attachment; filename="${downloadName.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
        'X-Bom-Items': String(payload.counts.items),
        'X-Bom-Designators': String(payload.counts.designators),
        'X-Bom-No-Reference': String(payload.counts.noLocation),
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : '解析失败'
    return NextResponse.json({ error: message }, { status: 422 })
  }
}
