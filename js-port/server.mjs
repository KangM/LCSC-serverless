/**
 * server.mjs — 立创商城查询 Demo 的本地服务（零依赖，仅用 Node 内置模块）
 *
 * 启动: node server.mjs
 * 打开: http://localhost:8787
 *
 * 说明: 浏览器直连 so.szlcsc.com 会被 CORS 拦截，且浏览器端不能自定义
 * User-Agent/Referer，所以把 lcsc-catalog.js 的抓取逻辑放在 Node 侧，
 * 页面通过 /api/search 和 /api/lookup 两个接口查询。
 */
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LcscCatalogClient } from './lcsc-catalog.js'

const PORT = process.env.PORT || 8787
const DIR = path.dirname(fileURLToPath(import.meta.url))

const client = new LcscCatalogClient()

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`)
  try {
    // 静态页面
    if (url.pathname === '/' || url.pathname === '/index.html') {
      const html = await readFile(path.join(DIR, 'index.html'))
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return
    }

    // 关键词搜索（支持分页：page 从 1 开始）
    if (url.pathname === '/api/search') {
      const k = url.searchParams.get('k')?.trim()
      if (!k) return sendJson(res, 400, { ok: false, error: '缺少参数 k' })
      const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1)
      const paged = await client.searchPaged(k, page)
      return sendJson(res, 200, {
        ok: true,
        mode: 'search',
        keyword: k,
        page: paged.page,
        pageSize: paged.pageSize,
        totalCount: paged.totalCount,
        totalPages: paged.totalPages,
        count: paged.items.length,
        items: paged.items,
      })
    }

    // 型号精确查询
    if (url.pathname === '/api/lookup') {
      const pn = url.searchParams.get('pn')?.trim()
      if (!pn) return sendJson(res, 400, { ok: false, error: '缺少参数 pn' })
      const item = await client.lookupByPartNumber(pn)
      return sendJson(res, 200, {
        ok: true, mode: 'lookup', keyword: pn, count: item ? 1 : 0,
        items: item ? [item] : [],
      })
    }

    sendJson(res, 404, { ok: false, error: 'Not Found' })
  } catch (error) {
    sendJson(res, 500, { ok: false, error: String(error?.message || error) })
  }
})

function sendJson(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(payload, null, 2))
}

server.listen(PORT, () => {
  console.log(`✅ 立创商城查询 Demo 已启动: http://localhost:${PORT}`)
  console.log('   查询会真实请求 so.szlcsc.com（自动处理 203 验证页）。')
  console.log('   若提示未找到，可能是触发风控或页面结构变更，稍后再试。')
})
