import { NextResponse, type NextRequest } from 'next/server'
import { listTransactions } from '@/lib/db'

type Params = { params: Promise<{ partNumber: string }> }

/** GET /api/components/[partNumber]/transactions — 该元件流水（详情弹窗用） */
export async function GET(_request: NextRequest, { params }: Params) {
  const { partNumber } = await params
  const data = await listTransactions({ partNumber, pageSize: 20 })
  return NextResponse.json({ ok: true, ...data })
}
