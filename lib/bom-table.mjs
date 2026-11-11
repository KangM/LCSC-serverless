/**
 * lib/bom-table.mjs — 注入到立创「辅助焊接」HTML 里的「库存位置」表格列（浏览器端源码）。
 *
 * 以 String.raw 模板常量保存，而不是独立 .js 文件 + 运行时 readFile：
 * Web 端（app/api/bom/inject）要把它内联进上传的 html，走 import 才能保证
 * standalone 构建把它打进产物；CLI 脚本也直接 import，两边同一份源码。
 *
 * 面板源码本身用 ES5 风格（var/function）兼容老 WebView / 平板浏览器，
 * 且不含反引号与 ${ 插值，所以能安全地放进 String.raw。
 *
 * ── 这份页面为什么必须靠 DOM 注入 ─────────────────────────────────────────
 * 表格由 React 渲染（React.createElement 建 td，没有可配置的列），表头和数据
 * 还是**两个独立的 table**：
 *   <table id="resizeTable"><thead>…</thead></table>   ← 表头（跟随横向滚动）
 *   <table id="founded"><tbody>…</tbody></table>       ← 数据行
 * 所以插列必须同时动三处：表头的 th、两个 colgroup 的 col、每个 tr 的 td。
 * 漏掉任何一个都会错位（表头和数据差一列 / 列宽塌陷）。
 *
 * 列位置按表头文字「器件编号」定位而不是写死索引：手机端（isShowOnPhone）
 * 会少掉「值」「封装」两列并把封装挪到最后，硬编码索引在平板上会插错位置。
 *
 * React 在排序/搜索/勾选时会重建 tbody，我们插的 td 会丢。更阴的是**排序时它复用
 * tr 节点、只改里面的文本**：列不会丢，但内容停在旧行上，看起来就是「点表头排序，
 * 位号列不跟着动」。所以观察器不能只问「列在不在」，必须比对每行 td 上记的
 * data-invl-stamp（位号文本指纹）与当前行内容是否一致，见 needsPatch()。
 */
export const TABLE_SOURCE = String.raw`(function () {
  var DATA = window.__INV_LOC__
  if (!DATA || !DATA.byDesignator) return
  if (window.__INV_TABLE_MOUNTED__) return
  window.__INV_TABLE_MOUNTED__ = true

  var HEADER = '库存位置'
  // 64px 够放 R1G1 / CL2A3；左侧 BOM 面板本来就比原表窄（原表 min-width 945px），
  // 每多 1px 都要多滚一点，能不占就不占。
  var COL_WIDTH = 64
  var patching = false
  var timer = null

  // ── 样式：尽可能贴近原生表头/单元格，避免看起来像外挂 ──────────────────
  function style() {
    var css = [
      '.invl-td{border-top:1px solid #cbcbcb;font-size:13px;line-height:1.35;padding:5px 8px;vertical-align:top;word-break:break-all}',
      '.invl-ok{font-family:Menlo,Consolas,monospace;font-weight:700;color:#0a7f3f;letter-spacing:.02em}',
      '.invl-none{color:#b26a00;font-size:12px}',
      '.invl-pkg{color:#c2410c;font-size:11px;font-weight:600}',
      '.invl-empty{color:#c4c4c4}',
      '.invl-th{background:#f2f2f2;border:1px solid #cbcbcb;height:22px;line-height:15px;padding-left:10px;padding-right:10px;text-align:left;white-space:nowrap}'
    ].join('\n')
    var el = document.createElement('style')
    el.setAttribute('data-invl', '')
    el.appendChild(document.createTextNode(css))
    ;(document.head || document.documentElement).appendChild(el)
  }

  // ── 读一行的位号 ────────────────────────────────────────────────────────
  // cell 结构：<td><p><span>C1</span><span>、</span><span>C4</span></p>
  //                   <p><span>3个器件</span>…</p></td>
  // 只取第一个 p，第二个 p 是「3个器件」计数，混进来会解析出垃圾。
  function cellDesignators(cell) {
    if (!cell) return ''
    var p = cell.querySelector('p')
    if (p) return p.textContent || ''
    var span = cell.querySelector('span')
    return span ? span.textContent || '' : ''
  }

  function splitDesignators(text) {
    var parts = String(text || '').split(/[、,，;；\s]+/)
    var out = []
    for (var i = 0; i < parts.length; i++) {
      var v = parts[i].replace(/^\s+|\s+$/g, '')
      if (v) out.push(v)
    }
    return out
  }

  function indexOfHeader(ths, text) {
    for (var i = 0; i < ths.length; i++) {
      if ((ths[i].textContent || '').indexOf(text) >= 0) return i
    }
    return -1
  }

  /**
   * 一行里可能有多个位号（C1、C4、C8），逐个查表。四种状态必须分开：
   *   · 有位置      → 绿色货位码（R1G1）
   *   · 封装不符    → 库里有同值料但封装不同，**不能拿去用**（拿错料比没料更坑）
   *   · 未入库      → 库里根本没有这个料
   *   · 已入库没录位号 → 「—」
   * 只显示「空」等于什么都没告诉用户，所以每种都给了明确文案 + title 说明。
   */
  function paint(td, tr, topIdx, botIdx) {
    var des = splitDesignators(cellDesignators(cellAt(tr, topIdx)))
    var bottom = splitDesignators(cellDesignators(cellAt(tr, botIdx)))
    var all = des.concat(bottom)

    var refs = []
    var pkgMiss = 0
    var noMatch = 0
    var noRef = 0
    var pkgHint = ''
    var noneHint = ''
    for (var i = 0; i < all.length; i++) {
      var entry = DATA.byDesignator[all[i]]
      if (!entry) { noRef++; continue }
      if (!entry.m) {
        if (entry.why === 'pkg') {
          pkgMiss++
          if (!pkgHint) pkgHint = entry.hint || ''
        } else {
          noMatch++
          if (!noneHint) noneHint = entry.hint || ''
        }
        continue
      }
      if (!entry.r) { noRef++; continue }
      if (refs.indexOf(entry.r) < 0) refs.push(entry.r)
    }

    if (refs.length) {
      td.className = 'invl-td invl-ok'
      td.textContent = refs.join(' / ')
      td.title = '系统位号：' + refs.join(' / ')
    } else if (pkgMiss && !noMatch) {
      td.className = 'invl-td invl-pkg'
      td.textContent = '封装不符'
      td.title = '库里有同值同品类的元件但封装不同' + (pkgHint ? '（' + pkgHint + '）' : '') + '，不能直接拿去用'
    } else if (noMatch) {
      td.className = 'invl-td invl-none'
      td.textContent = '未入库'
      td.title = '这批料还没录进系统库存' + (noneHint ? '：' + noneHint : '')
    } else if (noRef) {
      td.className = 'invl-td invl-empty'
      td.textContent = '—'
      td.title = '已入库，但这条流水没填位号'
    } else {
      // 一个位号都没读出来（表格结构变了），宁可留空也不显示误导性的文字
      td.className = 'invl-td invl-empty'
      td.textContent = ''
    }
  }

  function insertCol(table, idx) {
    if (!table) return
    var cg = table.querySelector('colgroup')
    if (!cg) return
    var col = document.createElement('col')
    col.setAttribute('width', String(COL_WIDTH))
    col.setAttribute('data-invl', '')
    cg.insertBefore(col, cg.children[idx] || null)
  }

  /**
   * 取第 idx 个「原表」单元格：跳过我们自己插的 td/th。
   * 插列后 children 的下标整体后移，直接用 children[idx] 会读到隔壁列。
   */
  function cellAt(tr, idx) {
    if (!tr || idx < 0) return null
    var kids = tr.children
    var n = 0
    for (var i = 0; i < kids.length; i++) {
      if (kids[i].hasAttribute('data-invl')) continue
      if (n === idx) return kids[i]
      n++
    }
    return null
  }

  /** 定位表头/表体与关键列。每次都现算 —— 列数、列序都可能被 React 改（手机端少两列）。 */
  function layout() {
    var headTable = document.getElementById('resizeTable')
    var bodyTable = document.getElementById('founded')
    if (!headTable || !bodyTable) return null
    var headRow = headTable.querySelector('thead tr')
    if (!headRow) return null
    var body = bodyTable.querySelector('tbody')
    if (!body) return null
    var ths = headRow.children
    var idIdx = indexOfHeader(ths, '器件编号')
    if (idIdx < 0) return null // 表头没有这一列（结构变了）→ 不动，宁可不显示也不插错
    return {
      headTable: headTable,
      bodyTable: bodyTable,
      headRow: headRow,
      body: body,
      idIdx: idIdx,
      topIdx: indexOfHeader(ths, '顶层位号'),
      botIdx: indexOfHeader(ths, '底层位号')
    }
  }

  /**
   * 一行的「内容指纹」：顶层/底层位号单元格里的文本。
   *
   * 排序时 React 是**复用 tr 节点、只改里面的单元格**（不是移动节点），所以我们插的
   * 那一列会留在原来的位置上，内容却已经不是这一行了。只检查「列在不在」发现不了
   * 这种情况，必须拿指纹比对。
   */
  function rowStamp(tr, lay) {
    var top = lay.topIdx >= 0 ? cellDesignators(cellAt(tr, lay.topIdx)) : ''
    var bot = lay.botIdx >= 0 ? cellDesignators(cellAt(tr, lay.botIdx)) : ''
    return top + '|' + bot
  }

  function patch() {
    var lay = layout()
    if (!lay) return

    patching = true
    try {
      // 先摘掉旧补丁，再统一按「原始列」算索引，保证幂等（多次调用结果一致）
      removeOld(lay.headTable)
      removeOld(lay.bodyTable)

      var ths = lay.headRow.children
      var th = document.createElement('th')
      th.className = 'invl-th'
      th.setAttribute('data-invl', '')
      th.setAttribute('title', '系统里录入的位号（货架位置）')
      th.textContent = HEADER
      lay.headRow.insertBefore(th, ths[lay.idIdx] || null)

      insertCol(lay.headTable, lay.idIdx)
      insertCol(lay.bodyTable, lay.idIdx)

      var rows = lay.body.children
      for (var i = 0; i < rows.length; i++) {
        var tr = rows[i]
        if (!tr || tr.nodeType !== 1) continue
        var td = document.createElement('td')
        td.className = 'invl-td'
        td.setAttribute('data-invl', '')
        td.setAttribute('data-invl-stamp', rowStamp(tr, lay))
        if (lay.topIdx >= 0) paint(td, tr, lay.topIdx, lay.botIdx < 0 ? lay.topIdx : lay.botIdx)
        tr.insertBefore(td, cellAt(tr, lay.idIdx) || null)
      }
    } finally {
      patching = false
    }
  }

  function removeOld(table) {
    var nodes = table.querySelectorAll('[data-invl]')
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]
      if (n.parentNode) n.parentNode.removeChild(n)
    }
  }

  /**
   * 需要补列吗？三种情况都要补：
   *   · 表头没有我们那一列（React 重建了 thead / 首次挂载）
   *   · 某一行没有我们那一列（React 重建了 tbody）
   *   · 列还在，但指纹和当前行内容不符（React 复用 tr 改了内容 = 排序/搜索后的错位）
   * 全都不需要时直接返回，避免「补 → MutationObserver 触发 → 再补」的死循环。
   */
  function needsPatch() {
    var lay = layout()
    if (!lay) return false
    if (!lay.headRow.querySelector('th[data-invl]')) return true
    var rows = lay.body.children
    if (!rows.length) return false
    for (var i = 0; i < rows.length; i++) {
      var tr = rows[i]
      if (!tr || tr.nodeType !== 1) continue
      var td = null
      var kids = tr.children
      for (var j = 0; j < kids.length; j++) {
        if (kids[j].hasAttribute('data-invl')) { td = kids[j]; break }
      }
      if (!td) return true
      if (td.getAttribute('data-invl-stamp') !== rowStamp(tr, lay)) return true
    }
    return false
  }

  function schedule() {
    if (timer) return
    timer = setTimeout(function () {
      timer = null
      patch()
    }, 120)
  }

  function boot() {
    style()
    patch()
    var obs = new MutationObserver(function () {
      if (patching) return
      if (!needsPatch()) return
      schedule()
    })
    obs.observe(document.body, { childList: true, subtree: true, characterData: true })
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot)
  } else {
    boot()
  }
})()`
