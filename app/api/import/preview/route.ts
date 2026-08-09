import { NextResponse, type NextRequest } from 'next/server'
import { previewImport } from '@/lib/import'

/** POST /api/import/preview — body: { rows: [{ partNumber?, mpn?, quantity }] } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  const result = await previewImport(body?.rows)
  return NextResponse.json({ ok: true, ...result })
}
