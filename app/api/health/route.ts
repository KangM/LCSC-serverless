import { connection, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/**
 * Docker 健康检查 + 部署版本自检。
 * 除了确认 Next 进程和数据库可用，还回报镜像里烙进去的 Git 信息，
 * 这样不登服务器就能判断「线上跑的是哪个提交」。
 *
 * 注意必须 connection()：否则 Cache Components 会在构建期把响应预渲染成静态的，
 * 而构建阶段（builder 里）根本没有 GIT_COMMIT_*，版本号会永久烘焙成 null。
 */
export async function GET() {
  await connection()
  const commit = process.env.GIT_COMMIT_SHA ?? process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? null
  const message = process.env.GIT_COMMIT_MESSAGE ?? process.env.VERCEL_GIT_COMMIT_MESSAGE ?? null
  const build = {
    commit: commit ? commit.slice(0, 12) : null,
    message: message?.trim() || null,
  }
  const noStore = { 'Cache-Control': 'no-store' }

  try {
    await getDb().execute('SELECT 1')
    return NextResponse.json({ ok: true, ...build }, { headers: noStore })
  } catch {
    return NextResponse.json({ ok: false, error: '数据库不可用', ...build }, { status: 503, headers: noStore })
  }
}
