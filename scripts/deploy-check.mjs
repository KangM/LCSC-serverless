/**
 * 自动部署状态速查（只读，不需要 SSH）。
 *
 *   node scripts/deploy-check.mjs               # 默认查 http://192.168.100.4:3000
 *   node scripts/deploy-check.mjs http://host:port
 *
 * 原理：/api/health 会返回镜像里烘焙的 GIT_COMMIT_SHA（见 lib/build-info.ts），
 * 所以「线上跑的是哪个提交」直接问接口就行，不必登服务器。
 *
 * 三个版本对比：
 *   线上（health 的 commit） ← 实际在服务的代码
 *   远端（git ls-remote master）← 已推送的最新代码，定时器该追到这儿
 *   本地（git rev-parse HEAD）← 我这台机器上的
 *
 * 需要登服务器看定时器/容器/构建日志时，用服务器上那个更全的脚本：
 *   ssh lcsc-docker 'bash ~/lcsc-inventory/scripts/deploy-status.sh'
 */
import { execFileSync } from 'node:child_process'

const BASE = (process.argv[2] || process.env.DEPLOY_URL || 'http://192.168.100.4:3000').replace(/\/+$/, '')

/** 跑 git 命令，失败/超时返回 null（不抛，便于降级） */
function git(args, timeout = 12_000) {
  try {
    return execFileSync('git', ['-c', 'safe.directory=*', ...args], {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return null
  }
}

const short = (sha) => (sha ? sha.slice(0, 7) : '?')

/**
 * 比两个修订号是否同一个提交。
 * health 返回的是 12 位短 sha（build-info.ts 里 slice 过），git 给的是 40 位全长，
 * 直接 `===` 永远不等 —— 必须按较短的那个做前缀比对。
 */
function sameRev(a, b) {
  if (!a || !b) return false
  const n = Math.min(a.length, b.length)
  return a.slice(0, n).toLowerCase() === b.slice(0, n).toLowerCase()
}

async function health() {
  try {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return { error: `HTTP ${res.status}` }
    return await res.json()
  } catch (err) {
    return { error: err.name === 'TimeoutError' ? '超时（8s）' : err.message }
  }
}

const online = await health()
const localSha = git(['rev-parse', 'HEAD'])
const localMsg = git(['log', '-1', '--pretty=%s'])
// git ls-remote 走 GitHub，本机常需代理；失败只影响「远端」这一行，不阻塞结论
const remoteLine = git(['ls-remote', 'origin', 'master'])
const remoteSha = remoteLine ? remoteLine.split(/\s+/)[0] : null

console.log(`服务地址  ${BASE}`)
console.log('')

if (online.error) {
  console.log(`线上版本  ✗ 读取失败：${online.error}`)
  console.log('           （服务没起来，或地址/端口不对）')
} else if (!online.commit) {
  console.log('线上版本  ? 接口没返回 commit —— 镜像构建时没传 GIT_COMMIT_SHA')
  console.log('           （deploy-if-updated.sh 的 --build-arg 漏了，见项目笔记）')
} else {
  console.log(`线上版本  ${short(online.commit)}  ${online.commitTime ?? ''}`)
  if (online.message) console.log(`          ${online.message}`)
}
console.log(`本地 HEAD ${short(localSha)}  ${localMsg ?? ''}`)
console.log(`远端 master ${remoteSha ? short(remoteSha) : '? （ls-remote 失败，可能要代理）'}`)

console.log('')
if (online.commit && remoteSha && sameRev(online.commit, remoteSha)) {
  console.log('✓ 已部署到最新：线上 = 远端 master')
  if (localSha && !sameRev(localSha, remoteSha)) {
    console.log(`  注意本地 HEAD（${short(localSha)}）与远端不同 —— 有未推送的提交`)
  }
} else if (online.commit && remoteSha) {
  console.log(`✗ 线上落后远端：${short(online.commit)} → ${short(remoteSha)}`)
  console.log('  定时器每 5 分钟跑一次，正常情况下等一会儿会自己追平。')
  console.log('  超过 10 分钟还没动，就到服务器上看：')
  console.log('    systemctl list-timers lcsc-inventory-update.timer')
  console.log('    systemctl status lcsc-inventory-update.service')
  console.log('    journalctl -u lcsc-inventory-update.service -n 50 --no-pager')
} else if (!online.commit && !online.error) {
  console.log('⚠ 线上版本未知，无法判断是否最新')
}
