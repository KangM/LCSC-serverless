import type { Metadata } from 'next'
import { listCategoryCounts, listComponents, listPackageNames } from '@/lib/cache'
import { groupCategories } from '@/lib/categories'
import { ComponentListClient } from '@/components/ComponentListClient'

export const metadata: Metadata = { title: '元件列表 · 元件库存管理' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const ALLOWED_SORTS = new Set(['name', 'brand', 'package', 'category', 'location', 'stock', 'price', 'updated'])

export default async function ComponentsPage({ searchParams }: Props) {
  const sp = await searchParams
  const get = (key: string) => {
    const v = sp[key]
    return typeof v === 'string' ? v : undefined
  }

  const sort = get('sort')
  const order = get('order')
  const page = Number(get('page')) || 1
  const statusParam = get('status')
  const status = statusParam === 'deleted' || statusParam === 'all' ? statusParam : 'active'
  const locParam = get('loc')
  const locationState: 'set' | 'unset' | 'all' = locParam === 'set' || locParam === 'unset' ? locParam : 'all'

  const [categoryCounts, packages] = await Promise.all([listCategoryCounts(), listPackageNames()])
  const groups = groupCategories(categoryCounts)

  // 两级筛选：major=大类（展开成该大类下所有小类），category=小类（立创二级目录原名）
  const minorParam = get('category') ?? ''
  const majorParam = get('major') ?? ''
  const activeMinor = groups.some((group) => group.minors.some((minor) => minor.name === minorParam))
    ? minorParam
    : ''
  const activeMajor = activeMinor
    ? (groups.find((group) => group.minors.some((minor) => minor.name === activeMinor))?.major ?? '')
    : groups.some((group) => group.major === majorParam)
      ? majorParam
      : ''
  const categoryFilter = activeMinor
    ? [activeMinor]
    : activeMajor
      ? (groups.find((group) => group.major === activeMajor)?.minors.map((minor) => minor.name) ?? [])
      : undefined

  const data = await listComponents({
    q: get('q'),
    categories: categoryFilter,
    packageName: get('package'),
    status,
    locationState,
    sort: sort && ALLOWED_SORTS.has(sort) ? (sort as never) : 'updated',
    order: order === 'asc' ? 'asc' : 'desc',
    page,
    pageSize: 20,
  })

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">元件列表</h1>
      <ComponentListClient
        initial={data}
        groups={groups}
        packages={packages}
        state={{
          q: get('q') ?? '',
          major: activeMajor,
          category: activeMinor,
          packageName: get('package') ?? '',
          status,
          locationState,
          sort: sort ?? 'updated',
          order: order ?? 'desc',
          page,
        }}
      />
    </div>
  )
}
