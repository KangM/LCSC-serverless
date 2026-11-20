/**
 * scripts/verify-order-sync.mjs — 立创 / 淘宝订单同步的回归验证
 *
 * 不连真实平台：把 fetch 换成固定响应，跑真实的 syncAccount 链路，
 * 验证解析、状态映射、幂等、自动匹配、在途量，以及「平台状态回退不能覆盖已签收」。
 *
 * 跑法: node --conditions=react-server scripts/verify-order-sync.mjs
 */
import { rmSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'

// 源码里是打包器风格：'./db' 省略扩展名、'@/lib/x' 走别名
const rootUrl = new URL('../', import.meta.url)
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith('@/')) {
      const relative = specifier.slice(2)
      try {
        return nextResolve(new URL(`${relative}.ts`, rootUrl).href, context)
      } catch {
        /* 落到默认解析 */
      }
    }
    if (specifier.startsWith('.') && !/\.[cm]?[jt]sx?$/.test(specifier)) {
      try {
        return nextResolve(`${specifier}.ts`, context)
      } catch {
        /* 落到默认解析 */
      }
    }
    return nextResolve(specifier, context)
  },
})

const dbPath = fileURLToPath(new URL('../data/verify-sync.db', import.meta.url))
rmSync(dbPath, { force: true })

process.env.DATABASE_MODE = 'sqlite'
process.env.SQLITE_DATABASE_PATH = dbPath
process.env.PERF_LOG = '0'

// ---------------------------------------------------------------------------
// 固定响应：结构照真实接口裁剪，去掉一切个人信息
// ---------------------------------------------------------------------------

const LCSC_OK = {
  code: 200,
  ok: true,
  result: {
    orderStatusMap: { already_send: '已发货' },
    page: {
      currPage: 1,
      pageRow: 4,
      totalPage: 1,
      totalRow: 4,
      dataList: [
        {
          orderCode: 'SO-FIX-0001',
          orderStatus: 'already_send',
          orderTime: '2026-11-19 02:02:21',
          paymentTime: '2026-11-19 02:03:18',
          realArriveTime: null,
          isArrive: true,
          orderTotalMoney: 12.45,
          orderDetailVOList: [
            {
              orderDetailId: 1,
              productCode: 'C910001',
              productName: '10uF ±10% 50V 编带',
              productModel: 'HGC1210R7106K500NSVK',
              encapStandard: '1210',
              catalogName: '贴片电容(MLCC)',
              brandName: 'Chinocera(华瓷)',
              purchaseNumber: 30,
              finalNumber: 30,
              productPrice: 0.8108,
            },
            {
              orderDetailId: 2,
              productCode: 'C910002',
              productName: '电压:40V 电流:5A 编带',
              productModel: 'SS54',
              encapStandard: 'SMA',
              brandName: 'MDD(辰达)',
              purchaseNumber: 10,
              finalNumber: 10,
              productPrice: 0.2025,
            },
          ],
        },
        {
          orderCode: 'SO-FIX-0002',
          orderStatus: 'wait_pick',
          orderTime: '2026-11-20 09:00:00',
          orderTotalMoney: 3.2,
          orderDetailVOList: [
            {
              orderDetailId: 3,
              productCode: 'C910001',
              productName: '10uF ±10% 50V 编带',
              purchaseNumber: 100,
              finalNumber: 100,
              productPrice: 0.5,
            },
          ],
        },
        {
          orderCode: 'SO-FIX-0003',
          orderStatus: 'canceled',
          orderTime: '2026-11-18 08:00:00',
          orderTotalMoney: 1.0,
          orderDetailVOList: [
            { orderDetailId: 4, productCode: 'C910003', productName: '已取消的单', purchaseNumber: 5, finalNumber: 5 },
          ],
        },
        {
          orderCode: 'SO-FIX-0004',
          orderStatus: 'already_send',
          orderTime: '2026-11-01 08:00:00',
          realArriveTime: '2026-11-03 15:20:00',
          orderTotalMoney: 8.8,
          orderDetailVOList: [
            { orderDetailId: 5, productCode: 'C910002', productName: '电压:40V 电流:5A 编带', purchaseNumber: 20, finalNumber: 20 },
          ],
        },
      ],
    },
  },
}

const LCSC_NEED_LOGIN = { needLogin: true }

const TAOBAO_OK = {
  api: 'mtop.taobao.order.queryboughtlistv2',
  ret: ['SUCCESS::调用成功'],
  data: {
    orderList: [
      {
        orderId: 'TB-FIX-0001',
        statusInfo: { text: '卖家已发货' },
        createTime: '2026-11-18 10:00:00',
        totalFee: '58.90',
        sellerNick: '测试店铺',
        subOrders: [
          { itemTitle: '0603 10K 1% 贴片电阻 100只', quantity: 2, price: '5.00', itemId: '660001' },
          { itemTitle: '0805 100nF 50V 贴片电容 100只', quantity: 1, price: '3.50', itemId: '660002', skuText: '0805 104K' },
        ],
      },
      {
        orderId: 'TB-FIX-0002',
        statusInfo: { text: '交易成功' },
        createTime: '2026-11-01 10:00:00',
        totalFee: '9.90',
        subOrders: [{ itemTitle: 'SS34 肖特基二极管 100只', quantity: 1, price: '9.90', itemId: '660003' }],
      },
    ],
  },
}

const TAOBAO_SESSION_EXPIRED = {
  api: 'mtop.taobao.order.queryboughtlistv2',
  data: {},
  ret: ['FAIL_SYS_SESSION_EXPIRED::Session过期'],
}

/** 老版 / 另一套结构：mainOrders + orderInfo.createTime + itemInfo.title */
const TAOBAO_LEGACY = {
  ret: ['SUCCESS::调用成功'],
  data: {
    mainOrders: [
      {
        id: 'TB-LEGACY-01',
        statusInfo: { text: '待收货' },
        orderInfo: { createTime: '2026-11-10 12:00:00' },
        priceInfo: { total: '20.00' },
        subOrders: [{ itemInfo: { title: 'LM358 双运放 SOP-8' }, priceInfo: { realTotal: '20.00' }, quantity: 5 }],
      },
    ],
  },
}

let fixtureMode = 'ok'

/** 复制一份立创响应并把订单号换成 SO-ALT-* */
function withAltOrderNos(payload) {
  const clone = JSON.parse(JSON.stringify(payload))
  for (const order of clone.result.page.dataList) {
    order.orderCode = order.orderCode.replace('SO-FIX', 'SO-ALT')
  }
  return clone
}

globalThis.fetch = async (url) => {
  const target = String(url)
  if (target.includes('order-api.szlcsc.com')) {
    if (fixtureMode === 'expired') {
      return new Response(JSON.stringify(LCSC_NEED_LOGIN), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    }
    // 第二个立创账号：订单号换成另一批，模拟「两个号各自买了料」
    const payload = fixtureMode === 'alt' ? withAltOrderNos(LCSC_OK) : LCSC_OK
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  if (target.includes('h5api.m.taobao.com')) {
    const body =
      fixtureMode === 'expired'
        ? TAOBAO_SESSION_EXPIRED
        : fixtureMode === 'legacy'
          ? TAOBAO_LEGACY
          : TAOBAO_OK
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })
  }
  throw new Error(`未预期的请求：${target}`)
}

// ---------------------------------------------------------------------------

const { createClient } = await import('@libsql/client')
const { stockIn } = await import('../lib/db.ts')
const { checkBom } = await import('../lib/bom.ts')
const {
  createAccount,
  getAccountWithCookie,
  listAccounts,
  listOrders,
  getIncomingByPartNumber,
  consumeOrderItems,
} = await import('../lib/purchase-orders.ts')
const { syncAccount } = await import('../lib/orders/sync.ts')
const { parseLcscOrders } = await import('../lib/orders/lcsc-client.ts')
const { parseTaobaoOrders, extractH5Token } = await import('../lib/orders/taobao-client.ts')

const schema = await readFile(new URL('../db/schema.sql', import.meta.url), 'utf8')
const bootstrap = createClient({ url: `file:${dbPath}` })
await bootstrap.executeMultiple(schema)
bootstrap.close()

let failed = 0
function check(name, cond, extra = '') {
  if (cond) console.log(`  ✅ ${name}`)
  else {
    failed++
    console.log(`  ❌ ${name} ${extra}`)
  }
}

// ---------------------------------------------------------------------------
console.log('场景 1：立创响应解析与状态映射')
{
  const { orders, totalPage, rawCount } = parseLcscOrders(LCSC_OK)
  check('解析出 4 单', orders.length === 4, String(orders.length))
  check('分页信息正确', totalPage === 1 && rawCount === 4, `${totalPage}/${rawCount}`)

  const byNo = Object.fromEntries(orders.map((order) => [order.orderNo, order]))
  check('已发货 → shipped', byNo['SO-FIX-0001']?.shipmentState === 'shipped', byNo['SO-FIX-0001']?.shipmentState)
  check('备货中 → pending', byNo['SO-FIX-0002']?.shipmentState === 'pending', byNo['SO-FIX-0002']?.shipmentState)
  check('已取消 → cancelled', byNo['SO-FIX-0003']?.shipmentState === 'cancelled', byNo['SO-FIX-0003']?.shipmentState)
  check(
    '有 realArriveTime → received（isArrive 不算签收）',
    byNo['SO-FIX-0004']?.shipmentState === 'received',
    byNo['SO-FIX-0004']?.shipmentState,
  )

  const first = byNo['SO-FIX-0001']
  check('状态原文转中文', first?.statusText === '已发货', String(first?.statusText))
  check('订单号/时间/金额', first?.orderNo === 'SO-FIX-0001' && first?.totalAmount === 12.45)
  check('行项目 2 行', first?.items.length === 2, String(first?.items.length))
  check(
    '立创编号进 supplierPartNo',
    first?.items[0]?.supplierPartNo === 'C910001',
    String(first?.items[0]?.supplierPartNo),
  )
  check('数量取 finalNumber', first?.items[0]?.quantity === 30, String(first?.items[0]?.quantity))
  check('单价保留小数', first?.items[0]?.unitPrice === 0.8108, String(first?.items[0]?.unitPrice))
  check(
    '品牌与封装写进 note',
    String(first?.items[0]?.note ?? '').includes('1210'),
    String(first?.items[0]?.note),
  )

  let expired = false
  try {
    parseLcscOrders(LCSC_NEED_LOGIN)
  } catch (error) {
    expired = error.name === 'CookieExpiredError'
  }
  check('needLogin → CookieExpiredError', expired)
}

// ---------------------------------------------------------------------------
console.log('\n场景 2：淘宝响应解析（新版 orderList / 老版 mainOrders）')
{
  const { orders, diagnostics } = parseTaobaoOrders(TAOBAO_OK)
  check('解析出 2 单', orders.length === 2, `${orders.length} ${diagnostics}`)
  const first = orders.find((order) => order.orderNo === 'TB-FIX-0001')
  check('「卖家已发货」→ shipped', first?.shipmentState === 'shipped', String(first?.shipmentState))
  check('行项目 2 行', first?.items.length === 2, String(first?.items.length))
  check('itemTitle/quantity/price 正确', first?.items[0]?.title.includes('10K') && first?.items[0]?.quantity === 2)
  check('SKU 写进 note', first?.items[1]?.note === '0805 104K', String(first?.items[1]?.note))
  check(
    '「交易成功」→ received',
    orders.find((order) => order.orderNo === 'TB-FIX-0002')?.shipmentState === 'received',
  )

  const legacy = parseTaobaoOrders(TAOBAO_LEGACY)
  check('老结构也能定位到订单', legacy.orders.length === 1, legacy.diagnostics)
  check('老结构 shipmentState=shipped', legacy.orders[0]?.shipmentState === 'shipped')
  check('老结构行项目解析', legacy.orders[0]?.items[0]?.quantity === 5)

  const unknown = parseTaobaoOrders({ ret: ['SUCCESS::调用成功'], data: { nothing: 1 } })
  check('认不出结构时给诊断信息', unknown.orders.length === 0 && unknown.diagnostics.length > 0)

  check(
    'Cookie 取最后一个 _m_h5_tk',
    extractH5Token('a=1; _m_h5_tk=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa_1; _m_h5_tk=bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb_2') ===
      'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  )
}

// ---------------------------------------------------------------------------
console.log('\n场景 3：立创同步端到端（账户 → 拉单 → 匹配 → 在途）')
await stockIn('C910001', 20, {
  detail: {
    partNumber: 'C910001', mpn: 'HGC1210R7106K500NSVK', name: '10uF ±10% 50V 1210',
    brand: '华瓷', packageName: '1210', category: '贴片电容(MLCC)', description: '', price: 0.8,
    productUrl: '', datasheetUrl: '', imageUrl: '',
    specifications: { 容值: '10uF', 耐压: '50V' },
  },
})
await stockIn('C910002', 1, {
  detail: {
    partNumber: 'C910002', mpn: 'SS54', name: '肖特基二极管 40V 5A SMA',
    brand: 'MDD', packageName: 'SMA', category: '肖特基二极管', description: '', price: 0.2,
    productUrl: '', datasheetUrl: '', imageUrl: '',
    specifications: { 耐压: '40V', 电流: '5A' },
  },
})

const lcscAccount = await createAccount({
  source: 'lcsc',
  label: '立创个人号',
  username: '10247038A',
  cookie: 'JSESSIONID=fake; isLoginCustomerFlag=1',
})

const lcscResult = await syncAccount(lcscAccount.id)
check('同步成功', lcscResult.status === 'ok', lcscResult.message)
check('拉 4 单写 4 单', lcscResult.fetched === 4 && lcscResult.imported === 4, `${lcscResult.fetched}/${lcscResult.imported}`)
check('C 编号自动匹配 4 行', lcscResult.matchedItems === 4, String(lcscResult.matchedItems))

{
  const orders = await listOrders({ source: 'lcsc' })
  check('库里 4 单', orders.length === 4, String(orders.length))
  const shipped = orders.find((order) => order.orderNo === 'SO-FIX-0001')
  check('订单挂在账号上', shipped?.accountLabel === '立创个人号', String(shipped?.accountLabel))
  check('已发货单计入在途：30 + 10 = 40 件', shipped?.incomingQuantity === 40, String(shipped?.incomingQuantity))
  check(
    '备货中的单不计在途',
    orders.find((order) => order.orderNo === 'SO-FIX-0002')?.incomingQuantity === 0,
  )
  check(
    '已签收的单不计在途',
    orders.find((order) => order.orderNo === 'SO-FIX-0004')?.incomingQuantity === 0,
  )

  const incoming = await getIncomingByPartNumber()
  check('在途聚合 = 30', incoming.get('C910001') === 30, String(incoming.get('C910001')))
}

{
  const { items } = await checkBom([{ designator: 'C1', name: '10uF', footprint: '1210', supplier: '', quantity: 45 }])
  check('库存 20 + 在途 30 覆盖需求 45', items[0].status === 'covered_by_incoming', items[0].status)
  check('在途数量透出到界面', items[0].incomingQuantity === 30, String(items[0].incomingQuantity))
}

// ---------------------------------------------------------------------------
console.log('\n场景 4：重复同步幂等 + 状态不回退')
{
  const again = await syncAccount(lcscAccount.id)
  check('再次同步仍成功', again.status === 'ok', again.message)
  const orders = await listOrders({ source: 'lcsc' })
  check('订单数不变（没有重复插入）', orders.length === 4, String(orders.length))
  const incoming = await getIncomingByPartNumber()
  check('在途量不变', incoming.get('C910001') === 30, String(incoming.get('C910001')))

  // 全量核销 SO-FIX-0001 的两行 → 订单转 received
  const target = orders.find((order) => order.orderNo === 'SO-FIX-0001')
  const entries = target.items.map((item) => ({
    itemId: item.id,
    quantity: item.pendingQuantity,
  }))
  await consumeOrderItems(entries)

  const afterConsume = (await listOrders({ source: 'lcsc' })).find((order) => order.orderNo === 'SO-FIX-0001')
  check('核销后订单变 received', afterConsume.shipmentState === 'received', afterConsume.shipmentState)
  check(
    '核销后在途清零',
    (await getIncomingByPartNumber()).get('C910001') === undefined,
  )

  // 平台侧仍然说「已发货」，同步不能把 received 推回 shipped
  await syncAccount(lcscAccount.id)
  const afterSync = (await listOrders({ source: 'lcsc' })).find((order) => order.orderNo === 'SO-FIX-0001')
  check('再次同步不回退已签收状态', afterSync.shipmentState === 'received', afterSync.shipmentState)
}

// ---------------------------------------------------------------------------
console.log('\n场景 5：淘宝同步 + Cookie 失效判定')
{
  const tbAccount = await createAccount({
    source: 'taobao',
    label: '淘宝个人号',
    username: 'czkssg',
    cookie: '_m_h5_tk=cccccccccccccccccccccccccccccccc_1795193296918; cookie2=abc; unb=1',
  })

  const tbResult = await syncAccount(tbAccount.id)
  check('淘宝同步成功', tbResult.status === 'ok', tbResult.message)
  check('淘宝拉到 2 单', tbResult.fetched === 2, String(tbResult.fetched))

  const tbOrders = await listOrders({ source: 'taobao' })
  check('淘宝单入库', tbOrders.length === 2, String(tbOrders.length))
  const shipped = tbOrders.find((order) => order.orderNo === 'TB-FIX-0001')
  check('淘宝发货单计入在途（3 件）', shipped?.incomingQuantity === 3, String(shipped?.incomingQuantity))
  check('淘宝行未匹配时 matchedPartNumber 为空', shipped?.items[0]?.matchedPartNumber === null)

  // Cookie 失效：立创账号切到 needLogin
  fixtureMode = 'expired'
  const expired = await syncAccount(lcscAccount.id)
  check('立创 Cookie 失效被识别', expired.status === 'cookie_expired', expired.status)
  const account = await getAccountWithCookie(lcscAccount.id)
  check('账号 Cookie 仍在库里（不因失效被清）', (account?.cookie.length ?? 0) > 0)
  const accountRow = (await listAccounts()).find((row) => row.id === lcscAccount.id)
  check('同步状态写回 cookie_expired', accountRow?.lastSyncStatus === 'cookie_expired', String(accountRow?.lastSyncStatus))
  check('失败原因写回账号', Boolean(accountRow?.lastSyncMessage), String(accountRow?.lastSyncMessage))

  fixtureMode = 'ok'
}

// ---------------------------------------------------------------------------
console.log('\n场景 6：多账号合并（同一平台两个号，订单号不重叠）')
{
  fixtureMode = 'alt'
  const second = await createAccount({
    source: 'lcsc',
    label: '立创公司号',
    cookie: 'JSESSIONID=fake2',
  })
  const secondResult = await syncAccount(second.id)
  check('第二个账号同步成功', secondResult.status === 'ok', secondResult.message)

  const all = await listOrders({ source: 'lcsc' })
  check('两个账号的订单并存（4 + 4）', all.length === 8, String(all.length))
  const labels = new Set(all.map((order) => order.accountLabel))
  check('订单能区分来源账号', labels.has('立创公司号') && labels.has('立创个人号'), [...labels].join('/'))

  // 两个号买的都是同一个料，在途应当叠加
  const incoming = await getIncomingByPartNumber()
  check('第二个账号的在途单独计入', incoming.get('C910001') === 30, String(incoming.get('C910001')))
  fixtureMode = 'ok'
}

console.log(failed === 0 ? '\n全部通过 ✅' : `\n${failed} 项失败 ❌`)
process.exit(failed === 0 ? 0 : 1)
