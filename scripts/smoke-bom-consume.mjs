/**
 * 冒烟：对运行中的 next start 打真实 HTTP 请求，验证 /api/bom/consume。
 *
 * 用法：
 *   DATABASE_MODE=sqlite SQLITE_DATABASE_PATH=./data/smoke.db node scripts/smoke-bom-consume.mjs
 * 前置：先起服务（同环境变量）npm run start，端口用 PORT 指定（默认 3000）。
 */
import { createSessionToken, SESSION_COOKIE } from '../lib/session.ts'

const BASE = `http://127.0.0.1:${process.env.PORT || 3000}`
const token = await createSessionToken()
const cookie = `${SESSION_COOKIE}=${token}`

let failed = 0
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const post = (body) =>
  fetch(`${BASE}/api/bom/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
    redirect: 'manual',
  })

// 1. 未登录应被 proxy 拦下（307 到 /login）
const anonymous = await fetch(`${BASE}/api/bom/consume`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [] }),
  redirect: 'manual',
})
check('未登录被重定向到登录页', anonymous.status === 307, `status=${anonymous.status}`)

// 2. 空 items → 400
const empty = await post({ items: [] })
const emptyJson = await empty.json().catch(() => ({}))
check('空 items 返回 400', empty.status === 400, `status=${empty.status} ${emptyJson.error ?? ''}`)

// 3. 不存在的元件 → 400 且说明原因
const missing = await post({ items: [{ partNumber: 'ZZZ-NOPE', quantity: 2 }] })
const missingJson = await missing.json().catch(() => ({}))
check('未知元件被拒绝', missing.status === 400 && /不在库存中/.test(missingJson.error ?? ''), missingJson.error ?? '')

// 4. 数量非法 → 400
const badQty = await post({ items: [{ partNumber: 'C100001', quantity: 0 }] })
const badQtyJson = await badQty.json().catch(() => ({}))
check('数量 0 被拒绝', badQty.status === 400, badQtyJson.error ?? '')

// 5. 正常出库：先读当前库存（GET /api/components/:pn 返回 { ok, item }）
const before = await fetch(`${BASE}/api/components/C100001`, { headers: { Cookie: cookie } })
const beforeJson = before.ok ? await before.json() : {}
const beforeQty = beforeJson?.item?.stockQuantity
console.log(`    出库前 C100001 库存 = ${beforeQty}`)
check('能读到出库前库存', typeof beforeQty === 'number', String(beforeQty))

const ok = await post({
  items: [{ partNumber: 'C100001', quantity: 2, designators: ['R1', 'R2'] }],
  note: '冒烟测试',
})
const okJson = await ok.json().catch(() => ({}))
check('正常出库返回 200', ok.status === 200, `status=${ok.status} ${okJson.error ?? ''}`)
if (ok.status === 200) {
  const r = okJson.results?.[0]
  check('扣减数量正确', r?.deducted === 2, JSON.stringify(r))
  check('库存前后递减 2', r && r.afterQty === r.beforeQty - 2, r ? `${r.beforeQty} → ${r.afterQty}` : '')
  // 注意：GET 走的是带缓存的读路径，此处不拿 beforeQty 做断言
  // （若用外部 sqlite3 改库，缓存值会与库中真实值不一致）

  // 6. 出库后再读一次，确认已落库
  const after = await fetch(`${BASE}/api/components/C100001`, { headers: { Cookie: cookie } })
  const afterQty = (await after.json())?.item?.stockQuantity
  check('GET 复查库存已扣减', afterQty === r.afterQty, `${afterQty} == ${r.afterQty}`)
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
