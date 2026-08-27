import { NextResponse, type NextRequest } from 'next/server'
import { getComponent } from '@/lib/cache'
import { deleteComponent, setThreshold, upsertComponentFromLcsc } from '@/lib/db'
import { lcsc } from '@/lib/lcsc'

type Params = { params: Promise<{ partNumber: string }> }

/** GET /api/components/[partNumber] — 单个元件详情 */
export async function GET(_request: NextRequest, { params }: Params) {
  const { partNumber } = await params
  const row = await getComponent(partNumber)
  if (!row) return NextResponse.json({ ok: false, error: '元件不存在' }, { status: 404 })
  return NextResponse.json({ ok: true, item: row })
}

/**
 * PATCH /api/components/[partNumber] — 修改阈值 / 刷新立创信息
 * body: { action: 'threshold', threshold: number } | { action: 'refresh' }
 */
export async function PATCH(request: NextRequest, { params }: Params) {
  const { partNumber } = await params
  const body = await request.json().catch(() => null)

  if (body?.action === 'threshold') {
    const threshold = Number(body.threshold)
    if (!Number.isFinite(threshold) || threshold < 0) {
      return NextResponse.json({ ok: false, error: '阈值必须是非负数字' }, { status: 400 })
    }
    await setThreshold(partNumber, threshold)
    return NextResponse.json({ ok: true, item: await getComponent(partNumber) })
  }

  if (body?.action === 'refresh') {
    const detail = await lcsc.refreshPartNumber(partNumber)
    if (!detail) {
      return NextResponse.json(
        { ok: false, error: '立创未返回该元件信息，可能是风控或编号有误，请稍后重试' },
        { status: 502 },
      )
    }
    await upsertComponentFromLcsc(detail)
    return NextResponse.json({ ok: true, item: await getComponent(partNumber) })
  }

  return NextResponse.json({ ok: false, error: '未知 action' }, { status: 400 })
}

/** DELETE /api/components/[partNumber] — 删除元件及其全部流水，释放位号。 */
export async function DELETE(_request: NextRequest, { params }: Params) {
  const { partNumber } = await params
  const row = await getComponent(partNumber)
  if (!row) return NextResponse.json({ ok: false, error: '元件不存在' }, { status: 404 })

  await deleteComponent(partNumber)
  return NextResponse.json({ ok: true })
}
