/* dsh-pkg-atlas v2 — viewer app (Task V5).
 * Plain browser script. Globals consumed: `cytoscape` (vendored 3.34.1), `AtlasModel`
 * (web/graph-model.js, loaded FIRST by index.html). DOM writes go through
 * textContent/createTextNode only; every HTML-string sink named by the XSS
 * discipline is banned (render-smoke.test.mjs pins the source itself).
 *
 * R26 architecture: paint() is the ONLY cytoscape structure-mutation path
 * (buildView → elements().remove() → add() → apply focus/selected classes).
 * All coordinates arrive pre-computed in element data (AtlasModel slot layout);
 * NO cytoscape layout is ever invoked in v2.
 *
 * Parent sizing (V5-M-6, VERIFIED against the vendored 3.34.1 dist by a headless
 * probe): compound nodes auto-fit their children (a 700x500 data-w/h parent with
 * children rendered at the children's bbox); explicit width/height only holds for
 * CHILDLESS parents. min-width/min-height act as a floor — `max(childBBox, min-*)`
 * in updateCompoundBounds — and accepted data(w)/data(h) maps directly at any
 * magnitude (no mapData clamping). Zones/groups therefore carry width/height AND
 * min-width/min-height from data(w)/data(h), with compound-sizing-wrt-labels
 * 'exclude' (dist enum is include|exclude) so child labels cannot inflate the box.
 * cytoscape keeps position OUTSIDE data — paint() maps data.x/data.y into the
 * element-json `position` field on add (positions still 100% AtlasModel).
 */
;(function () {
  'use strict'
  var PREFIX = '/dsh-pkg-atlas'

  // ---------- i18n (migrated from v1; V6 re-adds details/focus keys) ----------
  var I18N = {
    zh: { title: 'DSH 包图谱', search: '搜索包名或描述…', refresh: '重扫', retry: '重试',
      loadFail: '图数据加载失败', warnings: '条数据警告', noDescription: '（无描述）' },
    en: { title: 'DSH Package Atlas', search: 'search packages…', refresh: 'rescan', retry: 'retry',
      loadFail: 'failed to load graph', warnings: 'data warnings', noDescription: '(no description)' },
  }
  var lang = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
  function t(k) { return (I18N[lang] && I18N[lang][k]) || k }

  // ---------- zone palette (V5 Step 1): 13 zones × light/dark ----------
  // Fill is applied at 12% alpha via background-opacity; `line` colors the zone
  // border and the zone title text. Zone ids == graph.categories ids
  // (lib/categories.js: CATEGORY_ORDER + SPECIAL_ZONES).
  var ZONE_COLORS = {
    light: {
      kernel: { line: '#4a5fd0' }, session: { line: '#2f81c2' }, llm: { line: '#12a5a5' },
      tools: { line: '#55a630' }, orchestration: { line: '#7f9e1c' }, integration: { line: '#c9971b' },
      ui: { line: '#d1417c' }, platform: { line: '#4f6b8a' }, infra: { line: '#0f7d64' },
      plugin: { line: '#9a6ac2' }, profiles: { line: '#d9a441' }, broken: { line: '#d0433f' },
      ungrouped: { line: '#8a94a0' },
    },
    dark: {
      kernel: { line: '#8d9bff' }, session: { line: '#6db3ef' }, llm: { line: '#4fd0d8' },
      tools: { line: '#8fd06a' }, orchestration: { line: '#bcd84f' }, integration: { line: '#ecc24f' },
      ui: { line: '#f07fae' }, platform: { line: '#8fa9c9' }, infra: { line: '#4fc2a0' },
      plugin: { line: '#c194e8' }, profiles: { line: '#eec06a' }, broken: { line: '#ef7b78' },
      ungrouped: { line: '#a8b2be' },
    },
  }
  var ZONE_IDS_FALLBACK = ['kernel', 'session', 'llm', 'tools', 'orchestration', 'integration', 'ui',
    'platform', 'infra', 'plugin', 'profiles', 'broken', 'ungrouped']

  // ---------- state (brief Interfaces) ----------
  var state = {
    graph: null, byId: new Map(), groupIds: new Set(), groupZone: new Map(),
    cy: null, tableMode: false,
    theme: 'light', lang: lang,
    // AtlasModel `view` input. Defaults = the model defaults: every group collapsed
    // (collapsedGroups null), no zone excluded, all scopes/profiles/edge kinds pass.
    view: {
      collapsedCats: new Set(), collapsedGroups: null,
      filterCats: new Set(), filterScope: 'all', filterProfile: null,
      edgeKinds: null, showRealCross: false,
    },
    focus: null,   // null | {rootId, depth}   (trigger UI is V6; class logic lives here)
    selected: null,
  }

  // ---------- helpers ----------
  function escText(el, s) { el.textContent = s == null ? '' : String(s) }
  function catById() {
    var m = new Map()
    var cats = state.graph && Array.isArray(state.graph.categories) ? state.graph.categories : []
    cats.forEach(function (c) { if (c && c.id != null) m.set(String(c.id), c) })
    return m
  }
  // V5-M-5: zone data.name is the raw category id — the visible title must come
  // from graph.categories {id, zh, en}, never the raw id.
  function zoneTitle(catId) {
    var c = catById().get(catId)
    if (!c) return catId
    return (lang === 'zh' ? (c.zh || c.en) : (c.en || c.zh)) || catId
  }
  function shortName(name, kind) {
    var s = name == null ? '' : String(name)
    return kind === 'pkg' ? s.replace(/^@deepseek-ai\//, '') : s
  }
  function isDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch (e) { return false }
  }

  // ---------- STYLE (rebuilt per theme; V5 Step 1) ----------
  function styleFor(theme) {
    var dark = theme === 'dark'
    var text = dark ? '#dbe2ea' : '#22272e'
    var bg = dark ? '#12161b' : '#f7f8fa'
    var edgeLine = dark ? '#44505e' : '#9aa7b4'
    var peer = dark ? '#6da3d8' : '#4c7fb8'
    var peerOpt = dark ? '#3f5a74' : '#9dc1e8'
    var mount = dark ? '#57b98a' : '#3f9d6d'
    var st = [
      { selector: 'core', style: { background: bg } },

      // ---- zones: `zone` + `cat-<zoneId>` classes, w/h floors per V5-M-6 above ----
      { selector: 'node.zone', style: {
        shape: 'rectangle', 'background-opacity': 0.12,
        'border-width': 1.5, 'border-opacity': 0.85,
        width: 'data(w)', height: 'data(h)', 'min-width': 'data(w)', 'min-height': 'data(h)',
        'compound-sizing-wrt-labels': 'exclude',
        label: 'data(label)', 'font-size': 13, 'font-weight': 'bold', color: text,
        'text-valign': 'top-inside', 'text-halign': 'center', 'text-margin-y': 8,
        'text-wrap': 'ellipsis', 'max-text-width': 300,
      } },
      // per-zone fill/border/label colors (ZONE_COLORS[theme][zoneId])
    ]
    var table = ZONE_COLORS[theme] || ZONE_COLORS.light
    var ids = (state.graph && Array.isArray(state.graph.categories) && state.graph.categories.length)
      ? state.graph.categories.map(function (c) { return c && c.id != null ? String(c.id) : '' }).filter(Boolean)
      : ZONE_IDS_FALLBACK
    ids.forEach(function (id) {
      var z = table[id] || (ZONE_COLORS[theme === 'dark' ? 'light' : 'dark'] || {})[id] || { line: dark ? '#8fa9c9' : '#4f6b8a' }
      st.push({ selector: 'node.zone.cat-' + id, style: {
        'background-color': z.line, 'border-color': z.line, color: z.line,
      } })
    })

    // ---- group cards: `group` + `gk-<kind>` + optional `collapsed` ----
    st.push({ selector: 'node.group', style: {
      shape: 'round-rectangle', 'border-width': 1,
      width: 'data(w)', height: 'data(h)', 'min-width': 'data(w)', 'min-height': 'data(h)',
      'compound-sizing-wrt-labels': 'exclude',
      label: 'data(label)', 'font-size': 11, color: text, 'text-wrap': 'ellipsis', 'max-text-width': 120,
      'text-valign': 'top-inside', 'text-halign': 'center', 'text-margin-y': 4, 'background-opacity': 0.9,
    } })
    st.push({ selector: 'node.group:not(.collapsed)', style: { 'background-opacity': 0.14, 'border-width': 1.25 } })
    var gk = dark
      ? { official: ['#243140', '#4b7bb5'], plugin: ['#3a2f4d', '#9a6ac2'], profile: ['#403624', '#c9a45c'], broken: ['#4a262a', '#e05252'], ungrouped: ['#3a3a3a', '#9aa4ae'] }
      : { official: ['#dde7f3', '#4b7bb5'], plugin: ['#e9defa', '#8a5fc0'], profile: ['#f7ecd7', '#c08a2e'], broken: ['#f4d3d6', '#c04a4a'], ungrouped: ['#e8e8e8', '#909aa4'] }
    Object.keys(gk).forEach(function (kind) {
      st.push({ selector: 'node.group.gk-' + kind, style: { 'background-color': gk[kind][0], 'border-color': gk[kind][1] } })
    })

    // ---- packages: shape mapping R29 (ellipse/hexagon/rectangle/diamond) ----
    // classes from AtlasModel: pkg sk-<node.kind> sc-<node.scope>
    st.push({ selector: 'node.pkg', style: {
      shape: 'ellipse', width: 16, height: 16,
      label: 'data(label)', 'font-size': 8, color: text,
      'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 3,
      'text-wrap': 'ellipsis', 'max-text-width': 96, 'background-opacity': 1,
    } })
    st.push({ selector: 'node.pkg.sc-official', style: { 'background-color': dark ? '#6da3d8' : '#4c7fb8' } })
    st.push({ selector: 'node.pkg.sc-third-party', style: { shape: 'hexagon', 'background-color': dark ? '#c194e8' : '#9a6ac2' } })
    st.push({ selector: 'node.pkg.sk-profile', style: { shape: 'rectangle', 'background-color': '#d9a441', width: 34, height: 20 } })
    st.push({ selector: 'node.pkg.sk-broken', style: { shape: 'diamond', 'background-color': '#e05252', 'border-width': 2, 'border-color': dark ? '#ffd7d7' : '#8f2b2b' } })

    // ---- edges: e-<kind> (+ e-agg for aggregates, cross for real-cross pairs) ----
    st.push({ selector: 'edge', style: {
      'curve-style': 'bezier', width: 1, 'line-color': edgeLine,
      'target-arrow-shape': 'triangle', 'target-arrow-color': edgeLine,
    } })
    st.push({ selector: 'edge.e-peer', style: { 'line-style': 'dashed', 'line-color': peer, 'target-arrow-color': peer } })
    st.push({ selector: 'edge.e-peer-optional', style: { 'line-style': 'dotted', 'line-color': peerOpt, 'target-arrow-color': peerOpt } })
    st.push({ selector: 'edge.e-mount', style: { 'line-color': mount, 'target-arrow-color': mount, width: 1.6 } })
    // e-agg AFTER the kind rules: aggregate edges carry [e-agg, e-<kind>] and the
    // log-width/count-label must win over the kind rule's fixed width.
    st.push({ selector: 'edge.e-agg', style: {
      width: function (ele) { var c = ele.data('count'); c = c > 0 ? c : 1; return Math.log10(c + 1) * 1.2 + 1 },
      label: 'data(count)', 'font-size': 8, color: text,
      'text-background-color': bg, 'text-background-opacity': 0.8, 'text-background-padding': 2,
    } })
    st.push({ selector: 'edge.cross', style: { opacity: 0.5 } })

    // ---- selection / focus classes (applied only inside paint) ----
    st.push({ selector: 'node.selected', style: { 'border-width': 3, 'border-color': '#ffd166' } })
    st.push({ selector: 'edge.selected', style: { 'overlay-color': '#ffd166', 'overlay-opacity': 0.3, 'overlay-padding': 4 } })
    st.push({ selector: '.in-focus', style: { 'border-width': 2, 'border-color': '#ffd166' } })
    st.push({ selector: '.dim', style: { opacity: 0.12 } })
    return st
  }

  // ---------- paint(): the single render path (R26) ----------
  // `refit === false` keeps the current viewport (selection-only repaints must not
  // fight the user's zoom/pan); every structural change refits.
  function paint(refit) {
    if (!state.graph) return // static chrome binds at boot; ignore interaction until first load
    if (state.tableMode) { renderTable(); return }
    try {
      if (!state.cy) {
        if (typeof window.cytoscape !== 'function') throw new Error('cytoscape missing')
        if (!window.AtlasModel || typeof window.AtlasModel.buildView !== 'function') throw new Error('AtlasModel missing')
        state.cy = window.cytoscape({ container: document.getElementById('graph'), elements: [], wheelSensitivity: 0.2 })
        bindCy()
      }
      var built = window.AtlasModel.buildView(state.graph, state.view)
      // Label annotation (V5-M-5 / group ×N / pkg short names). This decorates the
      // FRESH element objects buildView returned per call — the model output contract
      // (id/parent/x/y/w/h/classes) is consumed exactly as emitted.
      built.elements.forEach(function (el) {
        var d = el.data
        if (d.kind === 'zone') d.label = zoneTitle(d.name)
        else if (d.kind === 'group') d.label = d.name + ' ×' + d.count
        else d.label = shortName(d.name, d.kind)
      })
      // cytoscape keeps position OUTSIDE data (verified against the vendored dist:
      // data.x/data.y alone leave elements at 0,0) — so paint() maps AtlasModel's
      // data.x/data.y into the add-json `position` field. Coordinates still come
      // exclusively from AtlasModel; no layout call.
      var cyEls = built.elements.map(function (el) {
        if (el.group !== 'nodes') return el
        return { group: el.group, classes: el.classes, data: el.data, position: { x: el.data.x, y: el.data.y } }
      })
      state.cy.elements().remove()
      state.cy.add(cyEls)
      state.cy.style(styleFor(state.theme))
      applyClasses()
      if (refit !== false) state.cy.fit(undefined, 24)
    } catch (err) {
      console.warn('atlas graph render failed, using table fallback', err)
      state.tableMode = true
      document.getElementById('graph').hidden = true
      document.getElementById('legend').hidden = true
      document.getElementById('table-fallback').hidden = false
      renderTable()
    }
  }

  // focus/selected classes — the ONLY element mutation inside paint's tail
  function applyClasses() {
    var cy = state.cy
    if (!cy) return
    cy.elements().removeClass('dim in-focus selected')
    if (state.focus) {
      var root = cy.getElementById(state.focus.rootId)
      if (root.length) {
        var keep = new Set([state.focus.rootId])
        var frontier = [state.focus.rootId]
        var depth = state.focus.depth > 0 ? state.focus.depth : 2
        for (var d = 0; d < depth; d++) {
          var next = []
          frontier.forEach(function (id) {
            var el = cy.getElementById(id)
            if (!el.length) return
            el.connectedEdges().forEach(function (e) {
              var other = e.source().same(el) ? e.target() : e.source()
              if (other.length && !keep.has(other.id())) { keep.add(other.id()); next.push(other.id()) }
            })
          })
          frontier = next
        }
        // a focused element drags its ancestor chain in with it
        keep.forEach(function (id) {
          var el = cy.getElementById(id)
          if (el.length) el.parents().forEach(function (p) { keep.add(p.id()) })
        })
        cy.nodes().forEach(function (el) { if (keep.has(el.id())) el.addClass('in-focus'); else el.addClass('dim') })
        cy.edges().forEach(function (el) {
          if (keep.has(el.data('source')) && keep.has(el.data('target'))) el.addClass('in-focus'); else el.addClass('dim')
        })
      }
    }
    if (state.selected) {
      var sel = cy.getElementById(state.selected)
      if (sel.length) sel.addClass('selected')
    }
  }

  // ---------- interaction (V5 Step 2) ----------
  function bindCy() {
    var cy = state.cy
    // double-click zone shell → toggle zone collapse. Zone data.name IS the raw
    // category id (contract); the label is the localized title (V5-M-5).
    // cytoscape bubbles child events to ancestor-matched handlers with the front
    // element kept in evt.target — only act when the FRONT element is the zone.
    cy.on('dbltap', 'node.zone', function (evt) {
      if (!evt.target.hasClass('zone')) return
      var cid = evt.target.data('name')
      state.view.collapsedCats.has(cid) ? state.view.collapsedCats.delete(cid) : state.view.collapsedCats.add(cid)
      paint()
    })
    // double-click group card → toggle that group. collapsedGroups defaults to
    // null = ALL collapsed, so materialize the full set on the first flip.
    cy.on('dbltap', 'node.group', function (evt) {
      if (!evt.target.hasClass('group')) return
      toggleGroup(String(evt.target.data('id')).replace(/^g:/, ''))
    })
    // single click → selection only (details panel is V6)
    cy.on('tap', 'node, edge', function (evt) { select(evt.target.id()) })
    cy.on('tap', function (evt) { if (evt.target === cy) select(null) })
  }
  function toggleGroup(gid) {
    if (!state.view.collapsedGroups) state.view.collapsedGroups = new Set(state.groupIds)
    state.view.collapsedGroups.has(gid) ? state.view.collapsedGroups.delete(gid) : state.view.collapsedGroups.add(gid)
    paint()
  }
  function select(id) {
    state.selected = id
    paint(false) // selection-only repaint: keep the viewport
  }
  function revealNode(n) {
    // expand path to a package: its zone un-collapsed, its group un-collapsed.
    // The zone id comes from the GROUP's category (AtlasModel rule 1), which can
    // differ from the node's own `category` field if the group entry disagrees.
    var gid = n.group == null ? 'ungrouped' : String(n.group)
    var zid = state.groupZone.get(gid)
    if (zid) state.view.collapsedCats.delete(zid)
    if (!state.view.collapsedGroups) state.view.collapsedGroups = new Set(state.groupIds)
    state.view.collapsedGroups.delete(gid)
    state.selected = n.id
    paint()
    if (state.cy && !state.tableMode) {
      var el = state.cy.getElementById(n.id)
      if (el.length) state.cy.animate({ center: { eles: el }, duration: 200 })
    }
  }

  // ---------- search (v1 behavior; details-panel hop deferred to V6) ----------
  function bindSearch() {
    var input = document.getElementById('search'), box = document.getElementById('search-results')
    var timer = 0
    input.addEventListener('input', function () {
      clearTimeout(timer)
      timer = setTimeout(function () {
        if (!state.graph) return
        var q = input.value.trim().toLowerCase()
        box.textContent = ''; box.hidden = true
        if (!q) return
        var hits = state.graph.nodes.filter(function (n) {
          return n.kind === 'package' && (n.name.toLowerCase().indexOf(q) >= 0 || (n.description || '').toLowerCase().indexOf(q) >= 0)
        }).slice(0, 40)
        for (var i = 0; i < hits.length; i++) {
          var li = document.createElement('button'); li.className = 'hit'
          escText(li, shortName(hits[i].name, 'pkg') + ' — ' + (hits[i].description || t('noDescription')).slice(0, 60))
          var target = hits[i]
          li.addEventListener('click', function () { box.hidden = true; revealNode(target) })
          box.appendChild(li)
        }
        box.hidden = hits.length === 0
      }, 150)
    })
  }

  // ---------- table fallback (migrated; row click only selects — V6 fills details) ----------
  function renderTable() {
    var box = document.getElementById('table-fallback')
    box.textContent = ''
    var table = document.createElement('table')
    var thead = document.createElement('thead'); var hr = document.createElement('tr')
    ['group', 'name', 'version', 'scope', 'mountedBy'].forEach(function (c) { var th = document.createElement('th'); escText(th, c); hr.appendChild(th) })
    thead.appendChild(hr); table.appendChild(thead)
    var tbody = document.createElement('tbody')
    state.graph.nodes.slice().sort(function (a, b) {
      var ga = a.group == null ? 'ungrouped' : String(a.group), gb = b.group == null ? 'ungrouped' : String(b.group)
      return ga !== gb ? (ga < gb ? -1 : 1) : (String(a.name) < String(b.name) ? -1 : 1)
    }).forEach(function (n) {
      var tr = document.createElement('tr')
      ;[n.group, n.name, n.version, n.scope, (n.mountedBy || []).join(',')].forEach(function (v) { var td = document.createElement('td'); escText(td, v); tr.appendChild(td) })
      tr.addEventListener('click', function () { state.selected = n.id })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody); box.appendChild(table)
  }

  // ---------- boot chrome (R20: binds once, survives a failed first load) ----------
  var chromeBoundOnce = false
  function bindChromeOnce() {
    if (chromeBoundOnce) return
    chromeBoundOnce = true
    document.getElementById('refresh').addEventListener('click', function () { load(true) })
    document.getElementById('retry').addEventListener('click', function () { document.getElementById('error-bar').hidden = true; load(false) })
    var mq = null
    try { mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)') } catch (e) { /* no mq */ }
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', function (ev) {
        state.theme = ev.matches ? 'dark' : 'light'
        paint()
      })
    }
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

  function freshView() {
    return {
      collapsedCats: new Set(), collapsedGroups: null,
      filterCats: new Set(), filterScope: 'all', filterProfile: null,
      edgeKinds: null, showRealCross: false,
    }
  }

  // Group-id universe + group→zone mapping re-derived EXACTLY as AtlasModel does:
  // members key on node `group` (null → 'ungrouped'); the zone is the declared
  // graph.groups[].category, else the first member with a `category`, else
  // 'ungrouped'. collapse/toggle bookkeeping must speak the model's language.
  function computeGroupUniverse() {
    var declared = new Map()
    ;(state.graph.groups || []).forEach(function (g) {
      if (g && g.id != null && !declared.has(g.id)) declared.set(String(g.id), g)
    })
    var firstCat = new Map()
    state.groupIds = new Set()
    state.groupZone = new Map()
    state.graph.nodes.forEach(function (n) {
      if (!n || n.id == null) return
      var gid = n.group == null ? 'ungrouped' : String(n.group)
      state.groupIds.add(gid)
      if (!firstCat.has(gid) && n.category) firstCat.set(gid, String(n.category))
    })
    state.groupIds.forEach(function (gid) {
      var e = declared.get(gid)
      var cat = e && e.category ? e.category : firstCat.get(gid)
      state.groupZone.set(gid, cat ? String(cat) : 'ungrouped')
    })
  }

  function load(refresh) {
    fetch(PREFIX + '/api/graph' + (refresh ? '?refresh=1' : '')).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status)
      return res.json()
    }).then(function (json) {
      state.graph = json
      state.byId = new Map(json.nodes.map(function (n) { return [n.id, n] }))
      computeGroupUniverse()
      state.view = freshView()
      state.focus = null
      state.selected = null
      renderMetaAndWarnings()
      var m = /node=(.+)$/.exec(decodeURIComponent(location.hash))
      if (m) {
        var n = state.byId.get(m[1])
        if (n) state.focus = { rootId: n.id, depth: 2 }
      }
      paint()
      if (n && state.cy && !state.tableMode) {
        // deep-link target: reveal (expand path) + center, keeping focus state
        revealNode(n)
      }
    }).catch(function (err) {
      var bar = document.getElementById('error-bar'); bar.hidden = false
      escText(document.getElementById('error-msg'), t('loadFail') + ': ' + err.message)
    })
  }

  function boot() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) })
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')) })
    state.theme = isDark() ? 'dark' : 'light'
    bindSearch()
    bindChromeOnce()
    load(false)
  }
  boot()
})()
