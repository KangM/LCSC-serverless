/** Docker 定时刷新：每天按容器 TZ 的 02:30 请求一次受保护的刷新接口。 */
const target = process.env.CRON_TARGET_URL ?? 'http://app:3000/api/cron/refresh'
const secret = process.env.CRON_SECRET

if (!secret) throw new Error('CRON_SECRET 未配置，拒绝启动刷新定时器')

function nextRunAt() {
  const next = new Date()
  next.setHours(2, 30, 0, 0)
  if (next <= new Date()) next.setDate(next.getDate() + 1)
  return next
}

async function run() {
  try {
    const response = await fetch(target, {
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(10 * 60 * 1000),
    })
    console.log(`[cron] refresh status=${response.status} body=${(await response.text()).slice(0, 300)}`)
  } catch (error) {
    console.error('[cron] refresh failed:', error instanceof Error ? error.message : error)
  }
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
