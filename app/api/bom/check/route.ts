import { NextResponse, type NextRequest } from 'next/server'
import { checkBom } from '@/lib/bom'

/** POST /api/bom/check — body: { rows: [{ designator, name, footprint, supplier, quantity }] } */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null)
  return NextResponse.json({ ok: true, ...(await checkBom(body?.rows)) })
}
