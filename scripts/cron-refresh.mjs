/** Docker 定时任务：每天按容器 TZ 的 02:30 先刷新元件信息，再同步一次采购订单。 */
const target = process.env.CRON_TARGET_URL ?? 'http://app:3000/api/cron/refresh'
const syncTarget = process.env.CRON_SYNC_URL ?? 'http://app:3000/api/cron/sync-orders'
const secret = process.env.CRON_SECRET

if (!secret) throw new Error('CRON_SECRET 未配置，拒绝启动刷新定时器')

function nextRunAt() {
  const next = new Date()
  next.setHours(2, 30, 0, 0)
  if (next <= new Date()) next.setDate(next.getDate() + 1)
  return next
}

async function hit(url, label, timeoutMs) {
  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    console.log(`[cron] ${label} status=${response.status} body=${(await response.text()).slice(0, 300)}`)
  } catch (error) {
    console.error(`[cron] ${label} failed:`, error instanceof Error ? error.message : error)
  }
}

async function run() {
  // 先刷元件信息（价格/名称会变），再拉订单——顺序反了会让新订单匹配到旧名称
  await hit(target, 'refresh', 10 * 60 * 1000)
  await hit(syncTarget, 'sync-orders', 5 * 60 * 1000)
}

async function schedule() {
  const next = nextRunAt()
  const delay = next.getTime() - Date.now()
  console.log(`[cron] next refresh at ${next.toISOString()}`)
  setTimeout(async () => {
    await run()
    await schedule()
  }, delay)
}

await schedule()
