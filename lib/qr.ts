/**
 * lib/qr.ts — 立创二维码文本解析（纯函数，客户端/服务端通用）
 *
 * 支持三种格式：
 *   1. 立创料盘键值串（最常见，如用户实测样例）：
 *      {on:SO26080743604,pc:C42386235,pm:DON45P04,qty:15,mc:,cc:1,pdi:229821392,hp:null}
 *      → pc=C42386235（立创编号）, pm=DON45P04（MPN）, qty=15（数量，预填入库）
 *      注意：键无引号、值可能为空，不能 JSON.parse，需手写 split 解析。
 *   2. 纯立创编号：C14663
 *   3. 商品详情 URL：https://item.szlcsc.com/C14663.html
 */

export interface QrParsed {
  partNumber?: string
  mpn?: string
  qty?: number
  raw: string
}

export function parseLcscQrCode(text: string): QrParsed | null {
  const s = text.trim()
  if (!s) return null

  // 1. 商品详情 URL：https://item.szlcsc.com/C14663.html
  const urlMatch = s.match(/item\.szlcsc\.com\/(C\d+)\.html/i)
  if (urlMatch) return { partNumber: urlMatch[1].toUpperCase(), raw: s }

  // 2. 纯立创编号：C14663
  if (/^C\d+$/i.test(s)) return { partNumber: s.toUpperCase(), raw: s }

  // 3. 立创料盘键值串（键无引号，值可为空/null）
  if (s.startsWith('{') && s.endsWith('}')) {
    const fields: Record<string, string> = {}
    for (const pair of s.slice(1, -1).split(',')) {
      const idx = pair.indexOf(':')
      if (idx <= 0) continue
      const key = pair.slice(0, idx).trim()
      const value = pair.slice(idx + 1).trim()
      if (key) fields[key] = value
    }
    const pc = fields['pc']?.trim()
    const pm = fields['pm']?.trim()
    const qtyRaw = fields['qty']?.trim()
    if (!pc && !pm) return null
    const result: QrParsed = { raw: s }
    if (pc) result.partNumber = pc.toUpperCase()
    if (pm) result.mpn = pm
    if (qtyRaw && /^\d+$/.test(qtyRaw)) result.qty = Number(qtyRaw)
    return result
  }

  return null
}
