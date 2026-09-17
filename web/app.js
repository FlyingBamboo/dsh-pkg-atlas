/* dsh-pkg-atlas viewer — plain script, global `cytoscape` only. No innerHTML for graph data. */
;(function () {
  'use strict'
  var PREFIX = '/dsh-pkg-atlas'
  var I18N = {
    zh: { title: 'DSH 包图谱', search: '搜索包名或描述…', official: '官方', plugin: '第三方',
      refresh: '重扫', focusDepth: '聚焦', noDescription: '（无描述）', loadFail: '图数据加载失败',
      retry: '重试', readme: 'README', readmeMissing: '该包未随附 README', mountedBy: '挂载方',
      dependents: '被依赖', dependencies: '依赖', external: '外部依赖', services: '消费服务（数据源覆盖：仅 cordis vendor 系）',
      path: '路径', focus: '聚焦此包', unfocus: '取消聚焦', warnings: '条数据警告', expand: '展开', collapse: '收起',
      members: '成员', profileFilterHint: '只显示该 profile 挂载的包' },
    en: { title: 'DSH Package Atlas', search: 'search packages…', official: 'official', plugin: '3rd-party',
      refresh: 'rescan', focusDepth: 'focus', noDescription: '(no description)', loadFail: 'failed to load graph',
      retry: 'retry', readme: 'README', readmeMissing: 'no README shipped', mountedBy: 'mounted by',
      dependents: 'dependents', dependencies: 'depends on', external: 'external deps', services: 'cordis services (coverage: cordis vendor only)',
      path: 'path', focus: 'focus', unfocus: 'unfocus', warnings: 'data warnings', expand: 'expand', collapse: 'collapse',
      members: 'members', profileFilterHint: 'only packages mounted by this profile' },
  }
  var lang = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
  function t(k) { return (I18N[lang] && I18N[lang][k]) || k }

  var state = {
    graph: null, byId: new Map(),
    expanded: new Set(), focus: null, selected: null,
    filters: { official: true, plugin: true, dep: true, peer: true, mount: true, profiles: new Set() },
    cy: null, tableMode: false,
  }

  // ---------- helpers ----------
  function escText(el, s) { el.textContent = s == null ? '' : String(s) }
  function displayName(n) { return n.kind === 'package' ? n.name.replace(/^@deepseek-ai\//, '') : n.name }
  function visible(n) {
    if (n.kind === 'profile') return true
    if (n.kind === 'broken') return true
    if (n.scope === 'official' && !state.filters.official) return false
    if (n.scope === 'third-party' && !state.filters.plugin) return false
    if (state.filters.profiles.size > 0 && n.mountedBy.length > 0) {
      var hit = n.mountedBy.some(function (p) { return state.filters.profiles.has(p) })
      if (!hit) return false
    }
    return true
  }
  function edgeKindOk(k) {
    if (k === 'dep') return state.filters.dep
    if (k === 'mount') return state.filters.mount
    return state.filters.peer
  }
  function containerOf(n) {
    if (n.kind === 'package' && state.expanded.has(n.group)) return n.id
    if (n.kind !== 'package' && state.expanded.has(n.group)) return n.id
    return 'g:' + n.group
  }

  // ---------- elements ----------
  function buildElements() {
    var els = [], containers = new Map(), agg = new Map()
    var vis = state.graph.nodes.filter(visible)
    for (var i = 0; i < vis.length; i++) {
      var n = vis[i]
      if (n.kind === 'package' && state.expanded.has(n.group)) { els.push(pkgEl(n)); continue }
      if (n.kind !== 'package' && state.expanded.has(n.group)) { els.push(pkgEl(n)); continue }
      var cid = 'g:' + n.group
      if (!containers.has(cid)) {
        var g = state.graph.groups.find(function (x) { return x.id === n.group }) || { id: n.group, kind: 'official' }
        containers.set(cid, { gid: n.group, members: [], kind: g.kind })
      }
      containers.get(cid).members.push(n)
    }
    containers.forEach(function (v, cid) {
      els.push({ group: 'nodes', classes: 'g k-' + v.kind, data: { id: cid, gid: v.gid, label: v.gid + ' (' + v.members.length + ')', count: v.members.length } })
    })
    for (var e = 0; e < state.graph.edges.length; e++) {
      var edge = state.graph.edges[e]
      if (!edgeKindOk(edge.kind)) continue
      var a = state.byId.get(edge.from), b = state.byId.get(edge.to)
      if (!a || !b || !visible(a) || !visible(b)) continue
      var s = containerOf(a), d = containerOf(b)
      if (s === d) continue
      var key = s + '|' + d + '|' + kindRank(edge.kind)
      var item = agg.get(key)
      if (!item) { item = { s: s, d: d, kind: edge.kind, count: 0 }; agg.set(key, item) }
      item.count++
    }
    // keep highest-rank aggregated edge per (s,d) pair for display simplicity
    var best = new Map()
    agg.forEach(function (v) {
      var k2 = v.s + '|' + v.d
      var cur = best.get(k2)
      if (!cur || rank(v.kind) > rank(cur.kind)) best.set(k2, v)
    })
    best.forEach(function (v) {
      els.push({ group: 'edges', classes: 'e e-' + v.kind, data: { source: v.s, target: v.d, count: v.count } })
    })
    return els
  }
  function rank(k) { return { mount: 3, dep: 2, peer: 1, 'peer-optional': 0 }[k] || 0 }
  function kindRank(k) { return k }
  function pkgEl(n) {
    return { group: 'nodes', classes: 'p s-' + n.scope + (n.kind === 'broken' ? ' broken' : '') + (n.kind === 'profile' ? ' profile' : ''),
      data: { id: n.id, label: displayName(n), nid: n.id } }
  }

  // ---------- render ----------
  function render() {
    if (state.tableMode) { renderTable(); return }
    try {
      if (!state.cy) {
        if (typeof window.cytoscape !== 'function') throw new Error('cytoscape missing')
        state.cy = window.cytoscape({ container: document.getElementById('graph'), elements: [], wheelSensitivity: 0.2 })
        bindCy()
      }
      state.cy.elements().remove()
      state.cy.add(buildElements())
      state.cy.style(STYLE())
      state.cy.layout({ name: 'cose', animate: false, nodeRepulsion: function () { return 200000 } }).run()
      state.cy.fit(undefined, 24)
      applyFocusClasses()
    } catch (err) {
      state.tableMode = true
      document.getElementById('graph').hidden = true
      document.getElementById('table-fallback').hidden = false
      renderTable()
    }
  }
  function STYLE() {
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches
    var text = dark ? '#dbe2ea' : '#22272e', bg = dark ? '#12161b' : '#f7f8fa'
    return [
      { selector: 'core', style: { background: bg } },
      { selector: 'node.g', style: { 'label': 'data(label)', 'font-size': 12, color: text, 'background-color': dark ? '#243140' : '#dde7f3', 'border-color': '#4b7bb5', 'border-width': 1, width: function (ele) { var c = ele.data('count') || 1; return Math.min(60 + Math.round(Math.sqrt(c) * 26), 180) }, height: 34, 'text-valign': 'center', 'text-wrap': 'ellipsis' } },
      { selector: 'node.g.k-plugin', style: { 'background-color': dark ? '#3a2f4d' : '#e9defa' } },
      { selector: 'node.g.k-vendor', style: { 'background-color': dark ? '#2f4040' : '#ddf0ef' } },
      { selector: 'node.g.k-broken', style: { 'background-color': '#7a2630', 'border-color': '#e05252' } },
      { selector: 'node.g.k-profiles', style: { 'background-color': dark ? '#403624' : '#f7ecd7' } },
      { selector: 'node.p', style: { 'label': 'data(label)', 'font-size': 9, color: text, width: 18, height: 18, 'background-color': '#6a8caf', 'text-valign': 'bottom', 'text-margin-y': 3 } },
      { selector: 'node.p.s-official', style: { 'background-color': '#4c7fb8' } },
      { selector: 'node.p.s-third-party', style: { 'background-color': '#9a6ac2' } },
      { selector: 'node.p.broken', style: { 'background-color': '#e05252', 'border-width': 2, 'border-color': '#ffd7d7' } },
      { selector: 'node.p.profile', style: { 'background-color': '#d9a441', shape: 'round-rectangle', width: 34, height: 22 } },
      { selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#ffd166' } },
      { selector: 'edge.e', style: { width: 1, 'line-color': dark ? '#44505e' : '#9aa7b4', 'curve-style': 'bezier', 'target-arrow-shape': 'triangle', 'target-arrow-color': dark ? '#44505e' : '#9aa7b4', 'font-size': 8, color: text, 'label': 'data(count)', 'text-background-color': bg, 'text-background-opacity': 0.8 } },
      { selector: 'edge.e-mount', style: { width: 2.5, 'line-color': '#3f9d6d', 'target-arrow-color': '#3f9d6d' } },
      { selector: 'edge.e-peer', style: { 'line-style': 'dotted' } },
      { selector: 'edge.e-peer-optional', style: { 'line-style': 'dashed', 'line-opacity': 0.5 } },
      { selector: '.dim', style: { opacity: 0.12 } },
      { selector: '.in-focus', style: { 'border-width': 2, 'border-color': '#ffd166' } },
    ]
  }

  function applyFocusClasses() {
    if (!state.cy) return
    state.cy.elements().removeClass('dim in-focus')
    if (!state.focus) return
    var keep = focusNeighbors(state.focus.id, Number(document.getElementById('focus-depth').value))
    state.cy.nodes().forEach(function (el) {
      var id = el.data('id')
      var inSet = keep.has(id)
      if (el.data('gid')) {
        var c = containerMembers(el.data('gid'))
        inSet = c.some(function (m) { return keep.has(m.id) })
      }
      if (inSet) el.addClass('in-focus'); else el.addClass('dim')
    })
  }
  function containerMembers(gid) {
    return state.graph.nodes.filter(function (n) { return n.group === gid && visible(n) })
  }
  function focusNeighbors(rootId, depth) {
    var keep = new Set([rootId]), frontier = [rootId]
    var adj = new Map()
    for (var i = 0; i < state.graph.edges.length; i++) {
      var e = state.graph.edges[i]
      if (!edgeKindOk(e.kind)) continue
      if (!adj.has(e.from)) adj.set(e.from, [])
      if (!adj.has(e.to)) adj.set(e.to, [])
      adj.get(e.from).push(e.to); adj.get(e.to).push(e.from)
    }
    for (var d = 0; d < depth; d++) {
      var next = []
      for (var f = 0; f < frontier.length; f++) {
        var list = adj.get(frontier[f]) || []
        for (var j = 0; j < list.length; j++) if (!keep.has(list[j])) { keep.add(list[j]); next.push(list[j]) }
      }
      frontier = next
    }
    return keep
  }

  // ---------- interaction ----------
  function bindCy() {
    var cy = state.cy
    cy.on('dbltap', 'node.g', function (evt) {
      state.expanded.has(evt.target.data('gid')) ? state.expanded.delete(evt.target.data('gid')) : state.expanded.add(evt.target.data('gid'))
      render()
    })
    cy.on('tap', 'node', function (evt) { showDetails(evt.target.data('nid') || evt.target.data('id')) })
    cy.on('tap', function (evt) { if (evt.target === cy) closeDetails() })
  }
  function setFocus(id) {
    state.focus = { id: id }
    var n = state.byId.get(id)
    if (n && n.kind === 'package') state.expanded.add(n.group)
    location.hash = n ? 'node=' + encodeURIComponent(id) : ''
    render()
  }
  function clearFocus() { state.focus = null; location.hash = ''; render() }

  // ---------- details ----------
  function showDetails(id) {
    var panel = document.getElementById('details')
    panel.hidden = false
    panel.textContent = ''
    var n = state.byId.get(id)
    if (!n) {
      if (typeof id === 'string' && id.indexOf('g:') === 0) showGroupDetails(panel, id)
      return
    }
    if (state.cy) { state.cy.elements().removeClass('selected'); var el = state.cy.getElementById(id); if (el.length) el.addClass('selected') }
    state.selected = id
    var h = document.createElement('h2'); escText(h, displayName(n)); panel.appendChild(h)
    var sub = document.createElement('div'); sub.className = 'sub'
    escText(sub, [n.kind, n.scope, n.version, n.group].join(' · ')); panel.appendChild(sub)
    var desc = document.createElement('p'); desc.className = 'desc'
    escText(desc, n.description || t('noDescription')); panel.appendChild(desc)
    addList(panel, t('mountedBy'), n.mountedBy)
    if (n.servicesRequired && n.servicesRequired.length) addList(panel, t('services'), n.servicesRequired)
    var inb = state.graph.edges.filter(function (e) { return e.to === id })
    addList(panel, t('dependents'), inb.map(function (e) { return displayNameOf(e.from) + ' (' + e.kind + ')' }))
    var out = state.graph.edges.filter(function (e) { return e.from === id })
    addList(panel, t('dependencies'), out.map(function (e) { return displayNameOf(e.to) + ' (' + e.kind + (e.unsatisfied ? ',unsatisfied' : '') + ')' }))
    addList(panel, t('external'), (n.externalDeps || []).map(function (x) { return x.name + ' ' + x.range }))
    var p = document.createElement('div'); p.className = 'path'
    escText(p, t('path') + ': '); p.appendChild(document.createTextNode(n.path)); panel.appendChild(p)
    if (n.kind === 'package') {
      var btns = document.createElement('div'); btns.className = 'btns'
      var fb = document.createElement('button')
      escText(fb, state.focus && state.focus.id === id ? t('unfocus') : t('focus'))
      fb.addEventListener('click', function () { state.focus && state.focus.id === id ? clearFocus() : setFocus(id) })
      btns.appendChild(fb)
      var rb = document.createElement('button'); escText(rb, t('readme'))
      rb.addEventListener('click', function () { loadReadme(panel, id) })
      btns.appendChild(rb)
      panel.appendChild(btns)
    }
    if (n.kind === 'broken' || n.kind === 'profile') {
      var eb = document.createElement('button')
      escText(eb, state.expanded.has(n.group) ? t('collapse') : t('expand'))
      eb.addEventListener('click', function () { state.expanded.has(n.group) ? state.expanded.delete(n.group) : state.expanded.add(n.group); render() })
      panel.appendChild(eb)
    }
  }
  function showGroupDetails(panel, cid) {
    var gid = cid.slice(2)
    var members = containerMembers(gid)
    if (state.cy) { state.cy.elements().removeClass('selected'); var gel = state.cy.getElementById(cid); if (gel.length) gel.addClass('selected') }
    state.selected = cid
    var h = document.createElement('h2'); escText(h, gid + ' (' + members.length + ')'); panel.appendChild(h)
    var b = document.createElement('div'); b.className = 'kv'
    var k = document.createElement('span'); escText(k, t('members')); b.appendChild(k)
    var v = document.createElement('span'); escText(v, String(members.length)); b.appendChild(v)
    panel.appendChild(b)
    var eb = document.createElement('button')
    escText(eb, state.expanded.has(gid) ? t('collapse') : t('expand'))
    eb.addEventListener('click', function () { state.expanded.has(gid) ? state.expanded.delete(gid) : state.expanded.add(gid); render() })
    panel.appendChild(eb)
  }
  function displayNameOf(idOrNode) {
    var n = typeof idOrNode === 'string' ? state.byId.get(idOrNode) : idOrNode
    return n ? displayName(n) : idOrNode
  }
  function addList(panel, label, items) {
    if (!items || items.length === 0) return
    var b = document.createElement('div'); b.className = 'kv'
    var k = document.createElement('span'); escText(k, label); b.appendChild(k)
    var v = document.createElement('span'); escText(v, items.join(', ')); b.appendChild(v)
    panel.appendChild(b)
  }
  function loadReadme(panel, id) {
    var pre = panel.querySelector('pre.readme')
    if (!pre) { pre = document.createElement('pre'); pre.className = 'readme'; panel.appendChild(pre) }
    escText(pre, '…')
    fetch(PREFIX + '/api/readme?id=' + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) { return res.json().then(function (j) { throw new Error(j.error || res.status) }) }
      return res.text()
    }).then(function (text) { escText(pre, text) }).catch(function (err) {
      escText(pre, err.message === 'no-readme' ? t('readmeMissing') : 'ERR ' + err.message)
    })
  }
  function closeDetails() {
    document.getElementById('details').hidden = true
    state.selected = null
    if (state.cy) state.cy.elements().removeClass('selected')
  }

  // ---------- search ----------
  function bindSearch() {
    var input = document.getElementById('search'), box = document.getElementById('search-results')
    var timer = 0
    input.addEventListener('input', function () {
      clearTimeout(timer)
      timer = setTimeout(function () {
        var q = input.value.trim().toLowerCase()
        box.textContent = ''; box.hidden = true
        if (!q) return
        var hits = state.graph.nodes.filter(function (n) {
          return n.kind === 'package' && (n.name.toLowerCase().indexOf(q) >= 0 || (n.description || '').toLowerCase().indexOf(q) >= 0)
        }).slice(0, 40)
        for (var i = 0; i < hits.length; i++) {
          let li = document.createElement('button'); li.className = 'hit'
          escText(li, displayName(hits[i]) + ' — ' + (hits[i].description || t('noDescription')).slice(0, 60))
          let target = hits[i]
          li.addEventListener('click', function () {
            box.hidden = true
            state.expanded.add(target.group)
            render()
            showDetails(target.id)
            if (state.cy && !state.tableMode) { var el = state.cy.getElementById(target.id); if (el.length) state.cy.animate({ center: { eles: el }, duration: 200 }) }
          })
          box.appendChild(li)
        }
        box.hidden = hits.length === 0
      }, 150)
    })
  }

  // ---------- table fallback ----------
  function renderTable() {
    var box = document.getElementById('table-fallback')
    box.textContent = ''
    var table = document.createElement('table')
    var thead = document.createElement('thead'); var hr = document.createElement('tr')
    ['group', 'name', 'version', 'scope', 'mountedBy'].forEach(function (c) { var th = document.createElement('th'); escText(th, c); hr.appendChild(th) })
    thead.appendChild(hr); table.appendChild(thead)
    var tbody = document.createElement('tbody')
    state.graph.nodes.filter(visible).sort(function (a, b) { return a.group === b.group ? (a.name < b.name ? -1 : 1) : (a.group < b.group ? -1 : 1) })
      .forEach(function (n) {
        var tr = document.createElement('tr')
        ;[n.group, displayName(n), n.version, n.scope, n.mountedBy.join(',')].forEach(function (v) { var td = document.createElement('td'); escText(td, v); tr.appendChild(td) })
        tr.addEventListener('click', function () { showDetails(n.id) })
        tbody.appendChild(tr)
      })
    table.appendChild(tbody); box.appendChild(table)
  }

  // ---------- boot ----------
  // Static header controls bind once at boot (R20): after a failed first load the
  // error bar + retry must already work — they cannot wait for a successful load().
  var chromeBoundOnce = false
  function bindChromeOnce() {
    if (chromeBoundOnce) return
    chromeBoundOnce = true
    ;[['f-official', 'official'], ['f-plugin', 'plugin'], ['f-mount', 'mount'], ['f-peer', 'peer'], ['f-dep', 'dep']].forEach(function (pair) {
      document.getElementById(pair[0]).addEventListener('change', function (ev) { state.filters[pair[1]] = ev.target.checked; render() })
    })
    document.getElementById('refresh').addEventListener('click', function () { load(true) })
    document.getElementById('focus-depth').addEventListener('input', function () { applyFocusClasses() })
    document.getElementById('retry').addEventListener('click', function () { document.getElementById('error-bar').hidden = true; load(false) })
  }
  // Data-dependent filters only: #f-profiles checkboxes come from the loaded graph.
  function bindFilters() {
    var pf = document.getElementById('f-profiles')
    state.graph.profiles.forEach(function (p) {
      var label = document.createElement('label'); label.title = t('profileFilterHint')
      var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = false
      cb.addEventListener('change', function () {
        cb.checked ? state.filters.profiles.add(p.name) : state.filters.profiles.delete(p.name)
        render()
      })
      label.appendChild(cb); label.appendChild(document.createTextNode(' ' + p.name))
      pf.appendChild(label)
    })
  }
  function renderMetaAndWarnings() {
    var meta = document.getElementById('meta')
    escText(meta, state.graph.nodes.filter(function (n) { return n.kind === 'package' }).length + ' pkgs · ' +
      state.graph.edges.length + ' edges · ' + state.graph.generatedAt)
    var bar = document.getElementById('warning-bar')
    bar.hidden = state.graph.warnings.length === 0
    if (bar.hidden) return
    bar.textContent = ''
    var head = document.createElement('span'); head.className = 'warnhead'
    escText(head, '⚠ ' + state.graph.warnings.length + ' ' + t('warnings'))
    var open = false
    var list = document.createElement('div'); list.className = 'warnlist'; list.hidden = true
    state.graph.warnings.forEach(function (w) { var d = document.createElement('div'); escText(d, '[' + w.type + '] ' + (w.path ? w.path + ' — ' : '') + (w.message || '')); list.appendChild(d) })
    head.addEventListener('click', function () { open = !open; list.hidden = !open })
    bar.appendChild(head); bar.appendChild(list)
  }
  function load(refresh) {
    fetch(PREFIX + '/api/graph' + (refresh ? '?refresh=1' : '')).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }).then(function (json) {
      state.graph = json
      state.byId = new Map(json.nodes.map(function (n) { return [n.id, n] }))
      state.expanded = new Set(); state.focus = null
      renderMetaAndWarnings(); bindFilters2(); render()
      var m = /node=(.+)$/.exec(decodeURIComponent(location.hash))
      if (m && state.byId.get(m[1])) setFocus(m[1])
    }).catch(function (err) {
      var bar = document.getElementById('error-bar'); bar.hidden = false
      escText(document.getElementById('error-msg'), t('loadFail') + ': ' + err.message)
    })
  }
  var filtersBoundOnce = false
  function bindFilters2() { if (filtersBoundOnce) return; filtersBoundOnce = true; bindFilters() }

  function boot() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) })
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')) })
    bindSearch()
    bindChromeOnce()
    load(false)
  }
  boot()
})()
