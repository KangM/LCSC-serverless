/**
 * 验证 lib/backup-status.ts 的解析与健康判定。
 *
 *   node scripts/verify-backup-status.mjs
 *
 * 用临时目录构造 status.json，覆盖正常 / 逾期 / 失败 / 无状态文件 / 未配置五种情况。
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, closeSync, openSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

const root = mkdtempSync(path.join(tmpdir(), 'lcsc-bkstatus-'))
let failed = 0
function check(name, cond, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ` — ${extra}` : ''}`)
  if (!cond) failed++
}

const m = await import('../lib/backup-status.ts')
const { getBackupStatus, formatBytes, formatAgo } = m

const iso = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString()

/** 构造一个备份目录：写入 status.json + 若干快照文件 */
function makeDir(name, status) {
  const dir = path.join(root, name)
  mkdirSync(dir, { recursive: true })
  if (status) writeFileSync(path.join(dir, 'status.json'), JSON.stringify(status))
  for (let i = 0; i < 2; i++) {
    closeSync(openSync(path.join(dir, `inventory-2026${String(i + 1).padStart(2, '0')}01-033000.db.gz`), 'w'))
  }
  return dir
}

const baseStatus = (over = {}) => ({
  generatedAt: iso(1),
  status: 'ok',
  error: null,
  lastBackupAt: iso(1),
  lastBackupFile: 'inventory-20261019-033000.db.gz',
  lastBackupSize: 21455,
  backupCount: 12,
  keepCount: 30,
  schedule: '每日 03:30',
  durationMs: 3200,
  git: {
    enabled: true,
    committed: true,
    commit: '354e815',
    pushed: true,
    remote: 'origin',
    remoteUrl: 'git@github.com:KangM/lcsc-backup.git',
    branch: 'main',
    pendingCommits: 0,
    error: null,
  },
  rclone: { enabled: false, uploaded: false },
  ...over,
})

console.log('场景 1：正常（1 小时前备份，已推送）')
process.env.BACKUP_DIR = makeDir('ok', baseStatus())
let s = await getBackupStatus()
check('configured', s.configured === true)
check('health=ok', s.health === 'ok', s.health)
check('份数与上限', s.backupCount === 12 && s.keepCount === 30)
check('git 已推送', s.git.pushed === true && s.git.commit === '354e815')
check('branch 解析', s.git.branch === 'main')
check('体积可读', formatBytes(s.lastBackupSize) === '21.0 KB', formatBytes(s.lastBackupSize))

console.log('场景 2：逾期（30 小时前）')
process.env.BACKUP_DIR = makeDir('stale', baseStatus({ lastBackupAt: iso(30), generatedAt: iso(30) }))
s = await getBackupStatus()
check('health=stale', s.health === 'stale', s.health)
check('ageHours≈30', Math.abs(s.ageHours - 30) < 0.2, String(s.ageHours))
check('距今文案', formatAgo(s.ageHours).endsWith('小时前'), formatAgo(s.ageHours))

console.log('场景 3：上次执行失败')
process.env.BACKUP_DIR = makeDir('err', baseStatus({ status: 'error', error: '快照完整性检查未通过' }))
s = await getBackupStatus()
check('health=error', s.health === 'error', s.health)
check('错误透传', s.runError === '快照完整性检查未通过', String(s.runError))

console.log('场景 4：异地推送失败且有积压')
process.env.BACKUP_DIR = makeDir(
  'gitfail',
  baseStatus({
    git: {
      enabled: true,
      committed: true,
      commit: 'abc1234',
      pushed: false,
      remote: 'origin',
      remoteUrl: 'git@github.com:KangM/lcsc-backup.git',
      branch: 'main',
      pendingCommits: 3,
      error: '重试 3 次仍推送失败',
    },
  }),
)
s = await getBackupStatus()
check('git 未推送', s.git.pushed === false)
check('积压 3 个提交', s.git.pendingCommits === 3)
check('失败原因可见', s.git.error === '重试 3 次仍推送失败')
check('健康度仍按快照时间判定', s.health === 'ok', s.health)

console.log('场景 5：只有快照文件、没有 status.json（旧脚本）')
process.env.BACKUP_DIR = makeDir('legacy', null)
s = await getBackupStatus()
check('仍能识别为已配置', s.configured === true)
check('份数来自扫描', s.backupCount === 2, String(s.backupCount))
check('git 显示未配置', s.git.enabled === false)
check('health 按文件时间判定', s.health === 'ok', s.health)

console.log('场景 6：目录不存在')
process.env.BACKUP_DIR = path.join(root, 'nope')
s = await getBackupStatus()
check('configured=false', s.configured === false)
check('health=unconfigured', s.health === 'unconfigured', s.health)

rmSync(root, { recursive: true, force: true })
console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
