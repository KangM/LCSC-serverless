import type { Metadata } from 'next'
import { listCategories, listComponents, listPackageNames } from '@/lib/cache'
import { ComponentListClient } from '@/components/ComponentListClient'

export const metadata: Metadata = { title: '元件列表 · 元件库存管理' }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const ALLOWED_SORTS = new Set(['name', 'brand', 'package', 'category', 'stock', 'price', 'updated'])

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

  const [data, categories, packages] = await Promise.all([
    listComponents({
      q: get('q'),
      category: get('category'),
      packageName: get('package'),
      status,
      sort: sort && ALLOWED_SORTS.has(sort) ? (sort as never) : 'updated',
      order: order === 'asc' ? 'asc' : 'desc',
      page,
      pageSize: 20,
    }),
    listCategories(),
    listPackageNames(),
  ])

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold">元件列表</h1>
      <ComponentListClient
        initial={data}
        categories={categories}
        packages={packages}
        state={{
          q: get('q') ?? '',
          category: get('category') ?? '',
          packageName: get('package') ?? '',
          status,
          sort: sort ?? 'updated',
          order: order ?? 'desc',
          page,
        }}
      />
    </div>
  )
}
