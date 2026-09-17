/**
 * dsh-pkg-atlas v2 — AtlasModel: the pure view layer (Task V4).
 *
 * CLASSIC SCRIPT by ruling R28: no import/export, no DOM, no cytoscape, no
 * Date.now, no Math.random — unit tests load it into a BARE `{}` VM sandbox
 * (fs.readFileSync + vm.runInNewContext) and read `globalThis.AtlasModel`.
 *
 * Contract (R26): `buildView(graph, view)` returns fully-positioned cytoscape
 * elements. Coordinates come from slot pre-allocation computed on EXPANDED
 * dimensions over the FULL graph (layout universe), so collapse and filters
 * change WHICH elements render — never ANY coordinates. Two builds over equal
 * inputs are deep-equal; the model mutates neither graph nor view.
 *
 * Public surface (frozen): buildView(graph, view) -> { elements, meta },
 * ZONE_LAYOUT. Everything else below is private and may evolve.
 */
;(function () {
  'use strict'

  /** Unit sizes for the deterministic slot layout (brief rule 2). */
  var ZONE_LAYOUT = Object.freeze({
    CELL: 46,          // pkg slot cell size (expanded grid)
    CARD_W: 132,       // collapsed group card
    CARD_H: 36,
    GAP: 12,           // gap between pkg cells / group cards / zone rows
    ZONE_GAP: 32,      // gap between zones in the band grid (both axes)
    ZONE_PAD: 28,      // zone inner padding (left/right/top/below label)
    ZONE_LABEL_H: 30,  // zone label strip above the group rows
    ZONE_COLS: 4,      // zones per band-grid row (brief rule 2)
    FLOW_W: 480,       // max group-card row width inside a zone
  })

  /**
   * Dominant aggregated-edge kind = highest member-pair count. Ties resolve by
   * this FIXED priority order — ruling: kindRank dep>mount>peer>peer-optional —
   * never by insertion order. Kinds outside the list rank last (among
   * themselves by first-seen order; defensive, scan only emits the four).
   */
  var KIND_TIE_ORDER = Object.freeze(['dep', 'mount', 'peer', 'peer-optional'])

  /** Fallback zone order when graph.categories is absent (mirrors lib/categories.js). */
  var PREFERRED_ZONE_ORDER = Object.freeze([
    'kernel', 'session', 'llm', 'tools', 'orchestration', 'integration', 'ui', 'platform', 'infra',
    'plugin', 'profiles', 'broken', 'ungrouped',
  ])

  var EMPTY = new Set()

  function toSet(v) {
    if (v == null) return null
    // Duck-typed Set check: host-realm Sets fail `instanceof Set` inside the VM sandbox.
    if (typeof v.has === 'function' && typeof v.forEach === 'function' && typeof v.size === 'number') return v
    if (Array.isArray(v)) return new Set(v)
    return null
  }
  function nameCmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }

  function buildView(graph, view) {
    var g = graph || {}
    var nodes = Array.isArray(g.nodes) ? g.nodes : []
    var gedges = Array.isArray(g.edges) ? g.edges : []
    var v = view || {}

    // ---------- view state (defaults: everything collapsed to group cards) ----------
    var collapsedCats = toSet(v.collapsedCats) || EMPTY
    var collapsedGroups = toSet(v.collapsedGroups) // null => default: ALL groups collapsed
    var excludeCats = toSet(v.filterCats) || EMPTY  // filterCats = zone ids to EXCLUDE
    var scope = v.filterScope || 'all'
    var profile = v.filterProfile == null ? null : String(v.filterProfile)
    var edgeKinds = toSet(v.edgeKinds)              // null => all kinds pass
    var showRealCross = !!v.showRealCross

    // ---------- universe: membership + group table (defensive synthesis) ----------
    var nodeById = new Map()
    var i, n, grp, z
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]
      if (n && n.id != null && !nodeById.has(n.id)) nodeById.set(n.id, n)
    }
    var declared = new Map()
    var ggroups = Array.isArray(g.groups) ? g.groups : []
    for (i = 0; i < ggroups.length; i++) {
      grp = ggroups[i]
      if (grp && grp.id != null && !declared.has(grp.id)) declared.set(grp.id, grp)
    }
    var members = new Map() // gid -> node[]
    for (i = 0; i < nodes.length; i++) {
      n = nodes[i]
      if (!n || n.id == null) continue
      var gid = n.group == null ? 'ungrouped' : String(n.group)
      var list = members.get(gid)
      if (!list) { list = []; members.set(gid, list) }
      list.push(n)
    }
    var groupById = new Map()
    members.forEach(function (_list, gid2) {
      var entry = declared.get(gid2)
      var cat = entry && entry.category
      if (!cat) {
        var hit = null
        for (var k = 0; k < _list.length; k++) { if (_list[k].category) { hit = _list[k]; break } }
        cat = hit ? hit.category : 'ungrouped'
      }
      var kind = entry && entry.kind
      if (!kind) {
        kind = gid2 === 'broken' ? 'broken' : gid2 === 'profiles' ? 'profile'
          : gid2 === 'plugin' ? 'plugin' : gid2 === 'ungrouped' ? 'ungrouped' : 'official'
      }
      groupById.set(gid2, { id: gid2, kind: String(kind), category: String(cat), members: _list })
    })
    // Groups with packageCount 0 and no member nodes cannot enter the universe above:
    // they render nowhere (defensive, brief note).

    // ---------- zones (rule 1: group→zone = groups[].category) ----------
    var cats = Array.isArray(g.categories) && g.categories.length ? g.categories : null
    var orderIds = cats ? cats.map(function (c) { return c && c.id != null ? String(c.id) : '' }).filter(Boolean)
      : PREFERRED_ZONE_ORDER.slice()
    var catIndex = new Map()
    orderIds.forEach(function (id, ix) { if (!catIndex.has(id)) catIndex.set(id, ix) })
    function zoneRank(cat) { var ix = catIndex.get(cat); return ix == null ? orderIds.length : ix }

    var zoneById = new Map()
    groupById.forEach(function (gr) {
      var zz = zoneById.get(gr.category)
      if (!zz) { zz = { id: gr.category, groups: [] }; zoneById.set(gr.category, zz) }
      zz.groups.push(gr)
    })
    var zones = Array.from(zoneById.values())
    zones.sort(function (a, b) { return zoneRank(a.id) - zoneRank(b.id) || nameCmp(a.id, b.id) })
    zones.forEach(function (zz) { zz.groups.sort(function (a, b) { return nameCmp(a.id, b.id) }) })

    // ---------- layout universe: slot pre-allocation on EXPANDED dims (rule 2) ----------
    var L = ZONE_LAYOUT
    var nodePos = new Map() // node -> {x, y} absolute, pure function of graph
    zones.forEach(function (zz) {
      // group slots: max(collapsed card, expanded ceil(sqrt(m)) grid)
      zz.groups.forEach(function (gr) {
        var m = gr.members.length
        var cols = Math.max(1, Math.ceil(Math.sqrt(m)))
        var rows = Math.ceil(m / cols)
        var gridW = cols * L.CELL + (cols - 1) * L.GAP
        var gridH = rows * L.CELL + (rows - 1) * L.GAP
        gr.cols = cols; gr.rows = rows
        gr.slotW = Math.max(L.CARD_W, gridW)
        gr.slotH = Math.max(L.CARD_H, gridH)
      })
      // groups flow into rows; row height = max inside the row
      zz.rows = []
      var contentW = 0
      zz.groups.forEach(function (gr) {
        var row = zz.rows[zz.rows.length - 1]
        if (row && row.w + L.GAP + gr.slotW > L.FLOW_W) row = null
        if (!row) { row = { items: [], w: 0, h: 0, x: 0, y: 0 }; zz.rows.push(row) }
        row.x = row.w
        row.items.push(gr)
        row.w += (row.items.length > 1 ? L.GAP : 0) + gr.slotW
        if (gr.slotH > row.h) row.h = gr.slotH
        if (row.w > contentW) contentW = row.w
      })
      var y = 0
      zz.rows.forEach(function (row) { row.y = y; y += row.h + L.GAP })
      zz.contentW = contentW
      zz.contentH = zz.rows.length ? y - L.GAP : 0
      zz.w = zz.contentW + 2 * L.ZONE_PAD
      zz.h = L.ZONE_LABEL_H + zz.contentH + 2 * L.ZONE_PAD
    })
    // zones flow on a ZONE_COLS-column grid in CATEGORY_ORDER (band grid, rule 2)
    ;(function () {
      var bandY = 0
      for (var s = 0; s < zones.length; s += L.ZONE_COLS) {
        var row = zones.slice(s, s + L.ZONE_COLS)
        var x = 0, rh = 0
        row.forEach(function (zz) {
          zz.x = x + zz.w / 2
          zz.y = bandY + zz.h / 2
          x += zz.w + L.ZONE_GAP
          if (zz.h > rh) rh = zz.h
        })
        bandY += rh + L.ZONE_GAP
      }
    })()
    // group centers + member cell centers (grid centered in the slot => stable under collapse)
    zones.forEach(function (zz) {
      var top = zz.y - zz.h / 2
      var left = zz.x - zz.w / 2
      zz.rows.forEach(function (row) {
        var rowLeft = left + L.ZONE_PAD + (zz.contentW - row.w) / 2
        row.items.forEach(function (gr) {
          gr.x = rowLeft + row.x + gr.slotW / 2
          gr.y = top + L.ZONE_PAD + L.ZONE_LABEL_H + row.y + gr.slotH / 2
          gr.members.forEach(function (mm, k) {
            var col = k % gr.cols
            var rw = Math.floor(k / gr.cols)
            nodePos.set(mm, {
              x: gr.x + (col - (gr.cols - 1) / 2) * (L.CELL + L.GAP),
              y: gr.y + (rw - (gr.rows - 1) / 2) * (L.CELL + L.GAP),
            })
          })
        })
      })
    })

    // ---------- filters: survival BEFORE aggregation (rule 5) ----------
    function survives(n2, gr) {
      if (excludeCats.has(gr.category)) return false
      if (n2.kind === 'profile') return profile == null || n2.name === profile // profiles are scope-immune
      if (scope !== 'all' && n2.scope !== scope) return false
      if (profile != null) {
        var mb = Array.isArray(n2.mountedBy) ? n2.mountedBy : []
        if (mb.indexOf(profile) < 0) return false
      }
      return true
    }
    var survivesMap = new Map() // node -> bool
    var survivorsByGroup = new Map() // gid -> surviving member count
    groupById.forEach(function (gr) {
      var c = 0
      gr.members.forEach(function (mm) {
        var ok = survives(mm, gr)
        survivesMap.set(mm, ok)
        if (ok) c++
      })
      survivorsByGroup.set(gr.id, c)
    })
    var survivorsByZone = new Map()
    zones.forEach(function (zz) {
      var c = 0
      zz.groups.forEach(function (gr) { c += survivorsByGroup.get(gr.id) || 0 })
      survivorsByZone.set(zz.id, excludeCats.has(zz.id) ? 0 : c)
    })
    function zoneShown(cat) { return !excludeCats.has(cat) && (survivorsByZone.get(cat) || 0) > 0 }
    function groupShown(gid2) { return (survivorsByGroup.get(gid2) || 0) > 0 && zoneShown(groupById.get(gid2).category) }
    function groupCollapsed(gid2) { return collapsedGroups ? collapsedGroups.has(gid2) : true }

    // ---------- endpoint resolution (rule 4) ----------
    function resolveOf(n2) {
      if (!survivesMap.get(n2)) return null
      var gid2 = n2.group == null ? 'ungrouped' : String(n2.group)
      var gr = groupById.get(gid2)
      if (!gr || !zoneShown(gr.category)) return null
      if (collapsedCats.has(gr.category)) return { id: 'cat:' + gr.category, kind: 'zone' }
      if (!groupCollapsed(gid2)) return { id: n2.id, kind: 'pkg' }
      if ((survivorsByGroup.get(gid2) || 0) > 0) return { id: 'g:' + gid2, kind: 'group' }
      return { id: 'cat:' + gr.category, kind: 'zone' } // defensive: group hidden despite survivor
    }

    // ---------- render elements in rule-8 order ----------
    var elements = []
    var zoneN = 0, groupN = 0, pkgN = 0, profileN = 0
    zones.forEach(function (zz) {
      if (!zoneShown(zz.id)) return
      zoneN++
      elements.push({
        group: 'nodes',
        data: { id: 'cat:' + zz.id, kind: 'zone', name: zz.id, count: survivorsByZone.get(zz.id), x: zz.x, y: zz.y, w: zz.w, h: zz.h },
        classes: ['zone', 'cat-' + zz.id],
      })
    })
    zones.forEach(function (zz) {
      if (!zoneShown(zz.id) || collapsedCats.has(zz.id)) return // zone shell only: no group cards
      zz.groups.forEach(function (gr) {
        if ((survivorsByGroup.get(gr.id) || 0) === 0) return
        groupN++
        var collapsed = groupCollapsed(gr.id)
        elements.push({
          group: 'nodes',
          data: {
            id: 'g:' + gr.id, parent: 'cat:' + zz.id, kind: 'group', name: gr.id,
            count: survivorsByGroup.get(gr.id), x: gr.x, y: gr.y,
            w: collapsed ? L.CARD_W : gr.slotW, h: collapsed ? L.CARD_H : gr.slotH,
          },
          classes: collapsed ? ['group', 'gk-' + gr.kind, 'collapsed'] : ['group', 'gk-' + gr.kind],
        })
      })
    })
    for (i = 0; i < nodes.length; i++) { // pkgs in graph.nodes order
      n = nodes[i]
      if (!n || n.id == null || !survivesMap.get(n)) continue
      var gid3 = n.group == null ? 'ungrouped' : String(n.group)
      var gr3 = groupById.get(gid3)
      if (!gr3) continue
      if (collapsedCats.has(gr3.category) || groupCollapsed(gid3) || !groupShown(gid3)) continue
      var p = nodePos.get(n)
      if (!p) continue
      if (n.kind === 'profile') profileN++; else pkgN++
      elements.push({
        group: 'nodes',
        data: { id: n.id, parent: 'g:' + gid3, kind: n.kind === 'profile' ? 'profile' : 'pkg', name: n.name == null ? n.id : n.name, x: p.x, y: p.y },
        classes: ['pkg', 'sk-' + (n.kind || 'package'), 'sc-' + (n.scope == null ? '' : n.scope)],
      })
    }

    // ---------- edges: prune kinds → drop-filtered → resolve → agg or real ----------
    function kindRank(k) { var ix = KIND_TIE_ORDER.indexOf(k); return ix < 0 ? KIND_TIE_ORDER.length : ix }
    function dominantKind(counts) {
      var best = null, bestC = -1, bestR = Infinity
      counts.forEach(function (c, k) {
        var r = kindRank(k)
        if (c > bestC || (c === bestC && r < bestR)) { best = k; bestC = c; bestR = r }
      })
      return best
    }
    var agg = new Map() // "s|d" -> { s, d, count, kinds: Map }
    var real = []
    var realSeen = new Set()
    for (i = 0; i < gedges.length; i++) {
      var e = gedges[i]
      if (!e || e.from == null || e.to == null) continue
      if (edgeKinds && !edgeKinds.has(e.kind)) continue
      var a = nodeById.get(e.from)
      var b = nodeById.get(e.to)
      if (!a || !b) continue                          // dangling endpoint
      if (!survivesMap.get(a) || !survivesMap.get(b)) continue // touches a pruned element
      var s = resolveOf(a)
      var d = resolveOf(b)
      if (!s || !d || s.id === d.id) continue         // self-loop after resolution
      if (showRealCross && s.kind === 'pkg' && d.kind === 'pkg') {
        var rid = 'e:' + e.from + '|' + e.to + '|' + e.kind
        if (realSeen.has(rid)) continue               // defensive: keep first of dup (from,to,kind)
        realSeen.add(rid)
        real.push({ group: 'edges', data: { id: rid, source: s.id, target: d.id, kind: String(e.kind) }, classes: ['e-' + e.kind, 'cross'] })
        continue
      }
      var key = s.id + '|' + d.id
      var bucket = agg.get(key)
      if (!bucket) { bucket = { s: s.id, d: d.id, count: 0, kinds: new Map() }; agg.set(key, bucket) }
      bucket.count++
      bucket.kinds.set(e.kind, (bucket.kinds.get(e.kind) || 0) + 1)
    }
    var aggEls = Array.from(agg.values()).sort(function (x, y) { return nameCmp(x.s, y.s) || nameCmp(x.d, y.d) })
      .map(function (bucket) {
        var kind = dominantKind(bucket.kinds)
        return {
          group: 'edges',
          data: { id: 'agg:' + bucket.s + '|' + bucket.d, source: bucket.s, target: bucket.d, count: bucket.count, kind: String(kind) },
          classes: ['e-agg', 'e-' + kind],
        }
      })
    aggEls.forEach(function (el) { elements.push(el) })
    real.forEach(function (el) { elements.push(el) })

    return {
      elements: elements,
      meta: {
        zones: zoneN, groups: groupN, pkgs: pkgN, profiles: profileN,
        realEdges: real.length, aggEdges: aggEls.length, edges: real.length + aggEls.length,
      },
    }
  }

  globalThis.AtlasModel = Object.freeze({ buildView: buildView, ZONE_LAYOUT: ZONE_LAYOUT })
})()
