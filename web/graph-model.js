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
 * pathSets(graph, rootId, depth), ZONE_LAYOUT. Everything else below is
 * private and may evolve.
 *
 * V2.2a adds the two VIEW dimensions (R38/R39): `view.granularity`
 * ('groups' default = byte-identical to BASE; 'packages' renders every group
 * expanded, collapsedGroups ignored, collapsedCats still honored) and
 * `view.focus` ({rootId, depth} → subgraph of pathSets members with induced
 * REAL edges only; invalid/empty → base-path view). pathSets moved in from
 * app.js as the canonical implementation — the app copy still ships until
 * task B deletes it, and byte-parity of the two is pinned by tests.
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

  /**
   * R35/R36 path-traversal kinds — canonical copy (V2.2a). Semantics are the
   * byte-twin of the app.js pair that still ships there: DOWN is a package's
   * own dependency paths, so `mount` is NOT a down kind; UP accepts every
   * kind because climbing mount backwards is what takes a member to its
   * bundle and on to `profile:<name>`.
   */
  var DOWN_EDGE_KINDS = Object.freeze(['dep', 'peer', 'peer-optional'])
  var UP_EDGE_KINDS = Object.freeze(['dep', 'mount', 'peer', 'peer-optional'])

  var EMPTY = new Set()

  /**
   * normalizeDepth(depth) → null | 1 | 2 | 3 (R35, verbatim app.js twin).
   * `null` = UNLIMITED and the shipped default: 0 / absent / junk all
   * normalize to null (an unusable depth widens the view, never silently
   * narrows it); 1..3 kept, fractions floor, >3 clamps to 3.
   */
  function normalizeDepth(depth) {
    var v = typeof depth === 'number' && isFinite(depth) ? Math.floor(depth) : 0
    return v >= 1 ? Math.min(3, v) : null
  }

  /**
   * pathSets(graph, rootId, depth) →
   *   { rootId, down:Set, up:Set, both:Set, downEdges:Set, upEdges:Set }
   *
   * CANONICAL copy (V2.2a): the two directed path universes of one package,
   * computed over the REAL scan edges — never over rendered aggregates.
   * Semantics byte-exact to the app.js implementation it came from:
   *  - down: BFS over OUT-edges whose kind DOWN_EDGE_KINDS allows.
   *  - up:   BFS over IN-edges whose kind UP_EDGE_KINDS allows (mount
   *          included, traversed backwards → the profile climb).
   *  - both: down ∩ up (cycle members). The root is in NONE of the three.
   * `depth` (normalizeDepth) limits each direction independently; null is
   * unlimited. Cycle-safe via the visited set. Induced edge rule: the kind
   * must be one this direction traverses AND both endpoints sit in
   * (that set ∪ root). Edge keys are 'e:<from>|<to>|<kind>' — the same id
   * real cross edges carry, so a rendered edge matches a key verbatim.
   * Deterministic (Sets built in graph.edges order, never hash order),
   * defensive (malformed edges skipped, junk inputs → empty sets) and
   * side-effect free: graph is never written.
   */
  function pathSets(graph, rootId, depth) {
    var g = graph || {}
    var list = Array.isArray(g.edges) ? g.edges : []
    var root = String(rootId == null ? '' : rootId)
    var max = normalizeDepth(depth)
    var clean = [], out = new Map(), inc = new Map()
    for (var i = 0; i < list.length; i++) {
      var e = list[i]
      if (!e || e.from == null || e.to == null) continue
      var from = String(e.from), to = String(e.to), kind = String(e.kind)
      clean.push({ from: from, to: to, kind: kind })
      var ix = clean.length - 1
      var la = out.get(from); if (!la) { la = []; out.set(from, la) }
      la.push(ix)
      var lb = inc.get(to); if (!lb) { lb = []; inc.set(to, lb) }
      lb.push(ix)
    }
    function walk(adjacent, kinds, outward) {
      var seen = new Set([root])
      var frontier = [root]
      for (var layer = 1; frontier.length && (max === null || layer <= max); layer++) {
        var next = []
        for (var f = 0; f < frontier.length; f++) {
          var links = adjacent.get(frontier[f])
          if (!links) continue
          for (var k = 0; k < links.length; k++) {
            var ce = clean[links[k]]
            if (kinds.indexOf(ce.kind) < 0) continue
            var other = outward ? ce.to : ce.from
            if (seen.has(other)) continue
            seen.add(other); next.push(other)
          }
        }
        frontier = next
      }
      seen.delete(root)
      return seen
    }
    var down = walk(out, DOWN_EDGE_KINDS, true)
    var up = walk(inc, UP_EDGE_KINDS, false)
    var both = new Set()
    down.forEach(function (id) { if (up.has(id)) both.add(id) })
    var downSide = new Set(down); downSide.add(root)
    var upSide = new Set(up); upSide.add(root)
    var downEdges = new Set(), upEdges = new Set()
    for (var j = 0; j < clean.length; j++) {
      var ce2 = clean[j]
      var key = 'e:' + ce2.from + '|' + ce2.to + '|' + ce2.kind
      if (DOWN_EDGE_KINDS.indexOf(ce2.kind) >= 0 && downSide.has(ce2.from) && downSide.has(ce2.to)) downEdges.add(key)
      if (UP_EDGE_KINDS.indexOf(ce2.kind) >= 0 && upSide.has(ce2.from) && upSide.has(ce2.to)) upEdges.add(key)
    }
    return { rootId: root, down: down, up: up, both: both, downEdges: downEdges, upEdges: upEdges }
  }

  /** toSet-style defense (brief rule 3): a focus that is not an object with a
   *  string rootId is indistinguishable from focus=null. */
  function parseFocus(f) {
    if (!f || typeof f !== 'object') return null
    if (typeof f.rootId !== 'string') return null
    return { rootId: f.rootId, depth: normalizeDepth(f.depth) }
  }

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
    // V2.2a view dimensions. granularity defaults to 'groups' (BASE behavior,
    // byte-identical); 'packages' renders every group expanded and ignores
    // collapsedGroups. focus parses with toSet-style defense: null = base view.
    var granularity = v.granularity === 'packages' ? 'packages' : 'groups'
    var focusIn = parseFocus(v.focus)

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
          : gid2 === 'plugin' ? 'plugin' : gid2 === 'vendor' ? 'vendor'
            : gid2 === 'ungrouped' ? 'ungrouped' : 'official'
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
      // groups flow into rows; row height = max inside the row.
      // I-5: EVERY item needs its OWN leading-edge offset inside the row. A single
      // `row.x` per row made every card in the row share one x (they stacked). The
      // per-item offset lives on the group (`gr.rowX`); `row.w` stays the row TOTAL
      // width (contentW + the (contentW - row.w)/2 centering still read it).
      zz.rows = []
      var contentW = 0
      zz.groups.forEach(function (gr) {
        var row = zz.rows[zz.rows.length - 1]
        if (row && row.w + L.GAP + gr.slotW > L.FLOW_W) row = null
        if (!row) { row = { items: [], w: 0, h: 0, y: 0 }; zz.rows.push(row) }
        if (row.items.length) row.w += L.GAP
        gr.rowX = row.w
        row.items.push(gr)
        row.w += gr.slotW
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
          gr.x = rowLeft + gr.rowX + gr.slotW / 2
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
    function groupCollapsed(gid2) {
      if (granularity === 'packages') return false // R38: collapsedGroups is ignored
      return collapsedGroups ? collapsedGroups.has(gid2) : true
    }

    // ---------- focus subgraph (R38/R39) — a NEW branch; the base path below is untouched ----------
    // M = pathSets(graph, rootId, depth).down ∪ .up ∪ .both ∪ {root}, evaluated
    // over the RAW graph, then intersected with survivors (R39: members of
    // excluded zones are evicted; induced edges re-cut over the survivors).
    // Unknown root or an M that empties under the filters falls back to the
    // base-path view (meta.focus = null records the request that did not apply).
    var focusSets = null, focusMembers = null
    if (focusIn) {
      focusSets = pathSets(g, focusIn.rootId, focusIn.depth)
      if (nodeById.has(focusSets.rootId)) {
        var cand = new Set([focusSets.rootId])
        focusSets.down.forEach(function (id) { cand.add(id) })
        focusSets.up.forEach(function (id) { cand.add(id) })
        focusSets.both.forEach(function (id) { cand.add(id) })
        var fms = new Set()
        cand.forEach(function (id) {
          var nd = nodeById.get(id)
          if (nd && survivesMap.get(nd)) fms.add(id)
        })
        if (fms.size > 0) focusMembers = fms
      }
    }
    if (focusMembers) {
      // Render fewer elements from the SAME layout universe (slot
      // pre-allocation ran unconditionally above — coordinates are identical
      // to the granularity:'packages' build by construction).
      var fel = []
      var fz = 0, fg = 0, fp = 0, fw = 0
      var fGroupCount = new Map() // gid -> rendered member count (focus semantics for data.count)
      focusMembers.forEach(function (id2) {
        var nd2 = nodeById.get(id2)
        var gid4 = nd2.group == null ? 'ungrouped' : String(nd2.group)
        fGroupCount.set(gid4, (fGroupCount.get(gid4) || 0) + 1)
      })
      zones.forEach(function (zz) { // zones in category order; member-free zones simply absent
        var zc = 0
        zz.groups.forEach(function (gr) { zc += fGroupCount.get(gr.id) || 0 })
        if (zc === 0) return
        fz++
        fel.push({
          group: 'nodes',
          data: { id: 'cat:' + zz.id, kind: 'zone', name: zz.id, count: zc, x: zz.x, y: zz.y, w: zz.w, h: zz.h },
          classes: ['zone', 'cat-' + zz.id, 'ctx'],
        })
      })
      zones.forEach(function (zz) { // ancestor containers of surviving members, expanded slot sizes
        var zc2 = 0
        zz.groups.forEach(function (gr) { zc2 += fGroupCount.get(gr.id) || 0 })
        if (zc2 === 0) return
        zz.groups.forEach(function (gr) {
          var gc = fGroupCount.get(gr.id) || 0
          if (gc === 0) return
          fg++
          fel.push({
            group: 'nodes',
            data: {
              id: 'g:' + gr.id, parent: 'cat:' + zz.id, kind: 'group', name: gr.id,
              count: gc, x: gr.x, y: gr.y, w: gr.slotW, h: gr.slotH,
            },
            classes: ['group', 'gk-' + gr.kind, 'ctx'],
          })
        })
      })
      for (i = 0; i < nodes.length; i++) { // member pkgs in graph.nodes order
        n = nodes[i]
        if (!n || n.id == null || !survivesMap.get(n)) continue
        var mk = String(n.id)
        if (!focusMembers.has(mk)) continue
        var gid5 = n.group == null ? 'ungrouped' : String(n.group)
        if (!groupById.get(gid5)) continue
        var p5 = nodePos.get(n)
        if (!p5) continue
        if (n.kind === 'profile') fw++; else fp++
        fel.push({
          group: 'nodes',
          data: { id: n.id, parent: 'g:' + gid5, kind: n.kind === 'profile' ? 'profile' : 'pkg', name: n.name == null ? n.id : n.name, x: p5.x, y: p5.y },
          classes: ['pkg', 'sk-' + (n.kind || 'package'), 'sc-' + (n.scope == null ? '' : n.scope)],
        })
      }
      // Induced REAL edges only: (downEdges ∪ upEdges) ∩ survivor endpoints,
      // walked in graph.edges order and deduped by key — the SAME element shape
      // as today's real cross edges ('e-'+kind + cross classes). Aggregates are
      // never produced in focus mode, even between two members of one group.
      var fEdges = []
      var fSeen = new Set()
      for (i = 0; i < gedges.length; i++) {
        var fe = gedges[i]
        if (!fe || fe.from == null || fe.to == null) continue
        var fs2 = String(fe.from), ft2 = String(fe.to)
        if (fs2 === ft2) continue // self-loops never render (base path drops them too)
        if (!focusMembers.has(fs2) || !focusMembers.has(ft2)) continue
        var fkey = 'e:' + fs2 + '|' + ft2 + '|' + String(fe.kind)
        if (!focusSets.downEdges.has(fkey) && !focusSets.upEdges.has(fkey)) continue
        if (fSeen.has(fkey)) continue
        fSeen.add(fkey)
        fEdges.push({ group: 'edges', data: { id: fkey, source: fs2, target: ft2, kind: String(fe.kind) }, classes: ['e-' + fe.kind, 'cross'] })
      }
      fEdges.forEach(function (el0) { fel.push(el0) })
      return {
        elements: fel,
        meta: {
          zones: fz, groups: fg, pkgs: fp, profiles: fw,
          realEdges: fEdges.length, aggEdges: 0, edges: fEdges.length,
          focus: { rootId: focusSets.rootId, depth: focusIn.depth, members: focusMembers.size, edges: fEdges.length },
        },
      }
    }

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

    var meta = {
      zones: zoneN, groups: groupN, pkgs: pkgN, profiles: profileN,
      realEdges: real.length, aggEdges: aggEls.length, edges: real.length + aggEls.length,
    }
    // Byte-identity rule: the focus meta key appears ONLY when a focus object
    // was actually requested — a requested-but-not-applied focus records null.
    if (focusIn) meta.focus = null
    return { elements: elements, meta: meta }
  }

  globalThis.AtlasModel = Object.freeze({ buildView: buildView, pathSets: pathSets, ZONE_LAYOUT: ZONE_LAYOUT })
})()
