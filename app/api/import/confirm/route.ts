import { NextResponse, type NextRequest } from 'next/server'
import { confirmImport } from '@/lib/import'

/** POST /api/import/confirm — body: { rows: [{ partNumber?, mpn?, quantity }] } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const result = await confirmImport(body?.rows)
  return NextResponse.json({ ok: true, ...result })
}
