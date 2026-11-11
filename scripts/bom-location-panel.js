/**
 * scripts/bom-location-panel.js — 注入到立创「辅助焊接」HTML 里的备料清单抽屉（浏览器端）
 *
 * 这个文件不会被 Next 打包，由 scripts/inject-bom-location.mjs 读入后原样内联进
 * 输出的 html。拼写故意用 ES5 风格（var/function）以兼容老 WebView / 平板浏览器。
 *
 * 依赖：注入时先写入全局 window.__INV_LOC__（见 inject-bom-location.mjs 的 payload）。
 * 约束：所有节点挂在 body 末尾、样式全部 .invl- 前缀，不改动原 app 的 DOM / 事件。
 */
;(function () {
  'use strict'

  var DATA = window.__INV_LOC__
  if (!DATA || !DATA.rows || !DATA.rows.length) return
  if (window.__INV_LOC_MOUNTED__) return
  window.__INV_LOC_MOUNTED__ = true
  // 注入点理论上在 </body> 前，但若被别的工具挪到 head 里，等 DOM 就绪再挂载
  if (!document.body) {
    document.addEventListener('DOMContentLoaded', function () { window.__INV_LOC_MOUNTED__ = false; boot() })
    return
  }
  boot()

  function boot() {

  var CSS = [
    '.invl-root{--invl-bg:#16181c;--invl-bg2:#1e2126;--invl-line:#2f343c;--invl-fg:#e7ebf1;',
    '--invl-dim:#9aa4b2;--invl-accent:#4c9aff;--invl-warn:#ffb020;--invl-bad:#ff5d5d;--invl-ok:#2ecc71;',
    'position:fixed;inset:0;z-index:2147483000;pointer-events:none;',
    'font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--invl-fg);}',
    '.invl-root *{box-sizing:border-box;}',
    '.invl-btn{pointer-events:auto;cursor:pointer;border:1px solid var(--invl-line);background:var(--invl-bg2);',
    'color:var(--invl-fg);border-radius:10px;padding:8px 14px;font-size:14px;transition:background .15s,border-color .15s;}',
    '.invl-btn:hover{border-color:var(--invl-accent);background:#242830;}',
    '.invl-btn[aria-pressed="true"]{background:var(--invl-accent);border-color:var(--invl-accent);color:#fff;}',

    /* 悬浮按钮 */
    '.invl-fab{position:absolute;right:18px;bottom:18px;pointer-events:auto;display:flex;align-items:center;gap:8px;',
    'background:linear-gradient(180deg,#2b6cff,#1f56d6);color:#fff;border:0;border-radius:999px;',
    'padding:12px 18px;font-size:15px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.45);cursor:pointer;}',
    '.invl-fab:hover{filter:brightness(1.08);}',
    '.invl-fab .invl-dot{background:rgba(255,255,255,.24);border-radius:999px;padding:1px 8px;font-size:13px;}',

    /* 抽屉 */
    '.invl-drawer{position:absolute;top:0;right:0;height:100%;width:min(600px,100vw);pointer-events:auto;',
    'background:var(--invl-bg);border-left:1px solid var(--invl-line);display:flex;flex-direction:column;',
    'box-shadow:-16px 0 48px rgba(0,0,0,.55);transform:translateX(102%);transition:transform .22s ease;}',
    '.invl-root[data-open="true"] .invl-drawer{transform:none;}',
    '.invl-root[data-open="true"] .invl-fab{display:none;}',

    '.invl-head{display:flex;align-items:center;gap:12px;padding:14px 16px;border-bottom:1px solid var(--invl-line);}',
    '.invl-title{font-size:16px;font-weight:700;}',
    '.invl-sub{color:var(--invl-dim);font-size:12px;}',
    '.invl-spacer{flex:1;}',

    '.invl-tools{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 16px;border-bottom:1px solid var(--invl-line);}',
    '.invl-search{flex:1;min-width:160px;pointer-events:auto;background:#0f1115;border:1px solid var(--invl-line);',
    'color:var(--invl-fg);border-radius:10px;padding:9px 12px;font-size:14px;outline:none;}',
    '.invl-search:focus{border-color:var(--invl-accent);}',
    '.invl-sel{pointer-events:auto;background:#0f1115;border:1px solid var(--invl-line);color:var(--invl-fg);',
    'border-radius:10px;padding:9px 10px;font-size:14px;}',

    '.invl-cols,.invl-row{display:grid;grid-template-columns:104px 1fr 150px 78px 56px;gap:10px;align-items:center;}',
    '.invl-cols{padding:8px 16px;color:var(--invl-dim);font-size:12px;border-bottom:1px solid var(--invl-line);',
    'position:sticky;top:0;background:var(--invl-bg);z-index:2;}',
    '.invl-list{flex:1;overflow-y:auto;overscroll-behavior:contain;}',
    '.invl-row{padding:10px 16px;border-bottom:1px solid #23272e;cursor:pointer;}',
    '.invl-row:hover{background:#20242b;}',
    '.invl-row[data-bad="1"]{box-shadow:inset 3px 0 0 var(--invl-bad);}',
    '.invl-loc{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:16px;font-weight:700;color:var(--invl-accent);}',
    '.invl-loc[data-empty="1"]{color:#5b6472;font-weight:400;font-size:13px;}',
    '.invl-des{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:13px;word-break:break-all;}',
    '.invl-val{font-size:14px;}',
    '.invl-val em{color:var(--invl-dim);font-style:normal;font-size:12px;display:block;margin-top:2px;}',
    '.invl-pkg{color:var(--invl-dim);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}',
    '.invl-qty{text-align:right;font-variant-numeric:tabular-nums;font-weight:600;}',
    '.invl-qty small{color:var(--invl-dim);font-weight:400;}',
    '.invl-chip{display:inline-block;font-size:11px;padding:0 6px;border-radius:6px;margin-top:4px;line-height:18px;}',
    '.invl-chip.bad{background:rgba(255,93,93,.16);color:var(--invl-bad);}',
    '.invl-chip.warn{background:rgba(255,176,32,.16);color:var(--invl-warn);}',

    '.invl-foot{padding:10px 16px;border-top:1px solid var(--invl-line);color:var(--invl-dim);font-size:12px;',
    'display:flex;gap:14px;flex-wrap:wrap;}',
    '.invl-empty{padding:40px 16px;text-align:center;color:var(--invl-dim);}',
    '.invl-toast{position:absolute;left:50%;bottom:40px;transform:translateX(-50%) translateY(12px);pointer-events:none;',
    'background:rgba(20,22,26,.96);border:1px solid var(--invl-line);color:#fff;padding:10px 18px;border-radius:12px;',
    'font-size:13px;opacity:0;transition:opacity .2s,transform .2s;}',
    '.invl-toast[data-show="1"]{opacity:1;transform:translateX(-50%) translateY(0);}',

    '@media (max-width:640px){',
    '.invl-cols,.invl-row{grid-template-columns:78px 1fr 104px 44px;gap:8px;}',
    '.invl-cols .invl-pkg,.invl-row .invl-pkg{display:none;}',
    '.invl-fab{right:12px;bottom:12px;padding:10px 14px;font-size:14px;}',
    '}',

    /* 打印：只保留清单，白底黑字，按位置排序便于走货架 */
    '@media print{',
    '.invl-root{position:static;inset:auto;}',
    '.invl-fab,.invl-tools,.invl-toast{display:none!important;}',
    '.invl-drawer{position:static;width:100%;height:auto;transform:none!important;border:0;box-shadow:none;',
    'background:#fff;color:#000;}',
    '.invl-head{border-color:#ccc;} .invl-cols{position:static;background:#fff;color:#555;border-color:#ccc;}',
    '.invl-row{border-color:#ddd;color:#000;} .invl-loc{color:#000;} .invl-val em,.invl-pkg,.invl-foot{color:#444;}',
    '.invl-foot{border-color:#ccc;} .invl-list{overflow:visible;}',
    'body>div:not(.invl-root),body>table,body>script{display:none!important;}',
    '@page{size:A4;margin:10mm;}',
    '}',
  ].join('')

  var style = document.createElement('style')
  style.id = 'invl-style'
  style.textContent = CSS
  document.head.appendChild(style)

  var root = document.createElement('div')
  root.className = 'invl-root'
  root.setAttribute('data-open', 'false')
  root.innerHTML =
    '<button class="invl-fab" type="button" data-act="open" title="备料清单（Alt+L）">' +
    '<span>📍 备料清单</span><span class="invl-dot" data-count></span></button>' +
    '<aside class="invl-drawer" role="dialog" aria-label="备料清单">' +
    '<header class="invl-head">' +
    '<div><div class="invl-title">备料清单</div><div class="invl-sub" data-sub></div></div>' +
    '<span class="invl-spacer"></span>' +
    '<button class="invl-btn" type="button" data-act="csv">导出 CSV</button>' +
    '<button class="invl-btn" type="button" data-act="print">打印</button>' +
    '<button class="invl-btn" type="button" data-act="close" title="关闭（Esc）">✕</button>' +
    '</header>' +
    '<div class="invl-tools">' +
    '<input class="invl-search" type="search" placeholder="搜位号 / 型号 / 位置…" data-search>' +
    '<select class="invl-sel" data-sort>' +
    '<option value="loc">按库存位置</option>' +
    '<option value="des">按位号</option>' +
    '<option value="val">按器件值</option>' +
    '</select>' +
    '<button class="invl-btn" type="button" data-act="shortage" aria-pressed="false">只看缺料</button>' +
    '</div>' +
    '<div class="invl-list"><div class="invl-cols"><span>库存位置</span><span>位号</span><span>型号 / 值</span><span class="invl-pkg">封装</span><span style="text-align:right">数量</span></div><div data-rows></div></div>' +
    '<div class="invl-foot" data-foot></div>' +
    '</aside>' +
    '<div class="invl-toast" data-toast></div>'
  document.body.appendChild(root)

  var el = {
    root: root,
    rows: root.querySelector('[data-rows]'),
    foot: root.querySelector('[data-foot]'),
    sub: root.querySelector('[data-sub]'),
    search: root.querySelector('[data-search]'),
    sort: root.querySelector('[data-sort]'),
    shortage: root.querySelector('[data-act="shortage"]'),
    toast: root.querySelector('[data-toast]'),
    count: root.querySelector('[data-count]'),
  }

  var state = { q: '', sort: 'loc', onlyShortage: false }
  var rows = DATA.rows.slice()

  el.count.textContent = String(rows.length)

  function locKey(row) {
    // 未设置位置排到最后
    return row.loc ? row.loc.toUpperCase() : '\uffff'
  }

  function cmp(a, b) {
    if (state.sort === 'des') return a.designators.localeCompare(b.designators, 'en', { numeric: true })
    if (state.sort === 'val') return String(a.value).localeCompare(String(b.value), 'en', { numeric: true })
    var la = locKey(a), lb = locKey(b)
    if (la !== lb) return la < lb ? -1 : 1
    return a.designators.localeCompare(b.designators, 'en', { numeric: true })
  }

  function visible() {
    var q = state.q.trim().toLowerCase()
    return rows
      .filter(function (r) {
        if (state.onlyShortage && !r.shortage && r.loc) return false
        if (!q) return true
        return (
          (r.designators || '').toLowerCase().indexOf(q) >= 0 ||
          (r.value || '').toLowerCase().indexOf(q) >= 0 ||
          (r.partNumber || '').toLowerCase().indexOf(q) >= 0 ||
          (r.mpn || '').toLowerCase().indexOf(q) >= 0 ||
          (r.name || '').toLowerCase().indexOf(q) >= 0 ||
          (r.loc || '').toLowerCase().indexOf(q) >= 0
        )
      })
      .sort(cmp)
  }

  function chip(text, kind) {
    var s = document.createElement('span')
    s.className = 'invl-chip ' + kind
    s.textContent = text
    return s
  }

  function render() {
    var list = visible()
    el.rows.textContent = ''
    if (!list.length) {
      var empty = document.createElement('div')
      empty.className = 'invl-empty'
      empty.textContent = '没有匹配的元件'
      el.rows.appendChild(empty)
      return
    }
    var frag = document.createDocumentFragment()
    list.forEach(function (r) {
      var row = document.createElement('div')
      row.className = 'invl-row'
      row.setAttribute('data-bad', r.shortage ? '1' : '0')
      row.title = '点击复制位号'

      var loc = document.createElement('div')
      loc.className = 'invl-loc'
      if (r.loc) loc.textContent = r.loc
      else {
        loc.setAttribute('data-empty', '1')
        loc.textContent = '—'
      }

      var des = document.createElement('div')
      des.className = 'invl-des'
      des.textContent = r.designators

      var val = document.createElement('div')
      val.className = 'invl-val'
      val.textContent = r.value || r.name || '—'
      var meta = document.createElement('em')
      meta.textContent = r.partNumber || r.mpn || '未关联立创编号'
      val.appendChild(meta)
      if (r.shortage) val.appendChild(chip(r.stock > 0 ? '库存 ' + r.stock : '缺料', 'bad'))
      else if (!r.loc) val.appendChild(chip('位置未录', 'warn'))

      var pkg = document.createElement('div')
      pkg.className = 'invl-pkg'
      pkg.textContent = r.footprint || ''
      pkg.title = r.footprint || ''

      var qty = document.createElement('div')
      qty.className = 'invl-qty'
      qty.textContent = String(r.qty)

      row.appendChild(loc)
      row.appendChild(des)
      row.appendChild(val)
      row.appendChild(pkg)
      row.appendChild(qty)

      row.addEventListener('click', function () {
        copy(r.designators)
      })
      frag.appendChild(row)
    })
    el.rows.appendChild(frag)
  }

  function stats() {
    var n = rows.length
    var des = DATA.counts && DATA.counts.designators ? DATA.counts.designators : 0
    var noLoc = rows.filter(function (r) { return !r.loc }).length
    var bad = rows.filter(function (r) { return r.shortage }).length
    el.sub.textContent =
      (DATA.pcbName ? DATA.pcbName + ' · ' : '') + des + ' 个位号 / ' + n + ' 种料' +
      (DATA.sourceLabel ? ' · 位置来源 ' + DATA.sourceLabel : '')
    el.foot.textContent = ''
    var parts = ['共 ' + n + ' 种料，' + des + ' 个位号']
    parts.push(noLoc ? noLoc + ' 种未设位置' : '位置齐全')
    parts.push(bad ? bad + ' 种缺料' : '库存充足')
    parts.forEach(function (t) {
      var s = document.createElement('span')
      s.textContent = t
      el.foot.appendChild(s)
    })
  }

  var toastTimer = null
  function copy(text) {
    var done = function (ok) {
      el.toast.textContent = ok ? '已复制：' + text : '复制失败，请手动选择'
      el.toast.setAttribute('data-show', '1')
      clearTimeout(toastTimer)
      toastTimer = setTimeout(function () { el.toast.setAttribute('data-show', '0') }, 1400)
    }
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () { done(true) }, function () { fallback() })
    } else fallback()

    function fallback() {
      try {
        var ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        var ok = document.execCommand('copy')
        document.body.removeChild(ta)
        done(ok)
      } catch {
        done(false)
      }
    }
  }

  function csv() {
    var head = ['库存位置', '位号', '数量', '型号/值', '立创编号', '厂商型号', '封装', '当前库存']
    var lines = [head.join(',')]
    visible().forEach(function (r) {
      lines.push([
        r.loc || '', r.designators, r.qty, r.value || r.name || '',
        r.partNumber || '', r.mpn || '', r.footprint || '',
        r.matched ? String(r.stock) : '',
      ].map(function (v) {
        v = String(v == null ? '' : v)
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v
      }).join(','))
    })
    // \ufeff 让 Excel 正确识别 UTF-8
    var blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' })
    var url = URL.createObjectURL(blob)
    var a = document.createElement('a')
    var name = (DATA.pcbName || 'PCB') + '-备料清单.csv'
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    setTimeout(function () { URL.revokeObjectURL(url) }, 3000)
  }

  function open(v) {
    el.root.setAttribute('data-open', v ? 'true' : 'false')
    if (v) {
      render()
      el.search.focus()
    }
  }

  el.root.addEventListener('click', function (e) {
    var t = e.target
    while (t && t !== el.root) {
      var act = t.getAttribute && t.getAttribute('data-act')
      if (act === 'open') return open(true)
      if (act === 'close') return open(false)
      if (act === 'csv') return csv()
      if (act === 'print') return window.print()
      if (act === 'shortage') {
        state.onlyShortage = !state.onlyShortage
        t.setAttribute('aria-pressed', state.onlyShortage ? 'true' : 'false')
        return render()
      }
      t = t.parentNode
    }
  })

  el.search.addEventListener('input', function () { state.q = el.search.value; render() })
  el.sort.addEventListener('change', function () { state.sort = el.sort.value; render() })

  document.addEventListener('keydown', function (e) {
    if (e.altKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault()
      open(el.root.getAttribute('data-open') !== 'true')
    } else if (e.key === 'Escape' && el.root.getAttribute('data-open') === 'true') {
      open(false)
    }
  })

  stats()
  render()
  } // boot()
})()
