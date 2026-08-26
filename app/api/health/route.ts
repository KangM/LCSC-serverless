import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'

/** Docker 健康检查：确认 Next 进程和数据库连接均可用。 */
export async function GET() {
  try {
    await getDb().execute('SELECT 1')
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false, error: '数据库不可用' }, { status: 503 })
  }
}
