/* dsh-pkg-atlas v2 — viewer app (Task V5 core + Task V6 interaction layer).
 * Plain browser script. Globals consumed: `cytoscape` (vendored 3.34.1), `AtlasModel`
 * (web/graph-model.js, loaded FIRST by index.html). DOM writes go through
 * textContent/createTextNode only; every HTML-string sink named by the XSS
 * discipline is banned (render-smoke.test.mjs pins the source itself).
 *
 * R26 architecture: paint() is the ONLY cytoscape structure-mutation path
 * (buildView → elements().remove() → add() → apply focus/selected classes).
 * All coordinates arrive pre-computed in element data (AtlasModel slot layout);
 * NO cytoscape layout is ever invoked in v2. Every control in V6 mutates
 * `state.view` (or state.focus/selected/theme/lang) and then calls paint() —
 * no control touches cytoscape elements directly.
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

  // ---------- i18n (V6: every control/panel string carries a zh+en key) ----------
  var I18N = {
    zh: { title: 'DSH 包图谱', search: '搜索包名或描述…', refresh: '重扫', retry: '重试',
      loadFail: '图数据加载失败', warnings: '条数据警告', noDescription: '（无描述）',
      langSwitch: 'EN',
      preparing: '准备中…', phaseListing: '枚举目录', phaseManifests: '读取清单',
      phaseAssembling: '装配图谱', phaseDone: '完成',
      scopeLabel: '类型', scopeAll: '全部', scopeOfficial: '官方', scopeThird: '第三方',
      profileLabel: 'Profile', profileAll: '全部', realCrossLabel: '真实跨包线',
      edgeKindsLabel: '边型',
      focusLabel: '聚焦深度', focusUnlimited: '不限', focusOn: '聚焦上下游', focusOff: '取消聚焦',
      legendTitle: '图例', legendShapes: '节点形状', legendEdges: '边类型', legendFocus: '聚焦路径',
      shOfficial: '官方包', shThirdParty: '第三方包', shProfile: 'Profile', shBroken: '断链包',
      egDep: '依赖 dep', egMount: '挂载 mount', egPeer: '对等 peer',
      egPeerOpt: '可选对等 peer-opt', egAgg: '聚合边（粗细∝计数）',
      membersLabel: '成员', groupsLabel: '组', pkgsLabel: '包',
      // R35 path lists (depsLabel/dependentsLabel stay: the edge details panel uses them)
      pathDownLabel: '依赖路径 ↓', pathUpLabel: '被依赖路径 ↑',
      pathCountLabel: '{n} · 最深 {d} 层', pathNoneLabel: '无', pathDistLabel: 'd{n}',
      mountsLabel: '挂载 ↓',
      depsLabel: '依赖 →', dependentsLabel: '← 被依赖',
      unsatLabel: '未满足', bundleSurfaceLabel: 'bundle 面', declaredDepsLabel: '声明依赖',
      readmeLabel: 'README', noReadmeLabel: '（无 README）', moreLabel: '+{n} 更多',
      kindLabel: '类型', groupLabel: '组', zoneLabel: '区' },
    en: { title: 'DSH Package Atlas', search: 'search packages…', refresh: 'rescan', retry: 'retry',
      loadFail: 'failed to load graph', warnings: 'data warnings', noDescription: '(no description)',
      langSwitch: '中文',
      preparing: 'preparing…', phaseListing: 'listing directories', phaseManifests: 'reading manifests',
      phaseAssembling: 'assembling graph', phaseDone: 'done',
      scopeLabel: 'scope', scopeAll: 'all', scopeOfficial: 'official', scopeThird: 'third-party',
      profileLabel: 'Profile', profileAll: 'all', realCrossLabel: 'real cross edges',
      edgeKindsLabel: 'edge kinds',
      focusLabel: 'focus depth', focusUnlimited: 'unlimited', focusOn: 'focus paths', focusOff: 'clear focus',
      legendTitle: 'Legend', legendShapes: 'node shapes', legendEdges: 'edge kinds', legendFocus: 'focus paths',
      shOfficial: 'official pkg', shThirdParty: 'third-party', shProfile: 'profile', shBroken: 'broken',
      egDep: 'depends dep', egMount: 'mount', egPeer: 'peer',
      egPeerOpt: 'optional peer (peer-opt)', egAgg: 'aggregate (width ∝ count)',
      membersLabel: 'members', groupsLabel: 'groups', pkgsLabel: 'packages',
      pathDownLabel: 'depends paths ↓', pathUpLabel: 'depended-on paths ↑',
      pathCountLabel: '{n} · {d} levels deep', pathNoneLabel: 'none', pathDistLabel: 'd{n}',
      mountsLabel: 'mounts ↓',
      depsLabel: 'depends on →', dependentsLabel: '← depended by',
      unsatLabel: 'unsatisfied', bundleSurfaceLabel: 'bundle surface', declaredDepsLabel: 'declared deps',
      readmeLabel: 'README', noReadmeLabel: '(no README)', moreLabel: '+{n} more',
      kindLabel: 'kind', groupLabel: 'group', zoneLabel: 'zone' },
  }
  var lang = (navigator.language || 'zh').toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en'
  function t(k) { return (I18N[state.lang] && I18N[state.lang][k]) || k }

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

  // The four edge kinds lib/scan.js emits, in legend order. The edge-kind filter
  // checkboxes (index.html #edge-kinds) carry exactly these data-kind values.
  var EDGE_KINDS_ALL = ['dep', 'mount', 'peer', 'peer-optional']
  // R35: the kinds each focus direction may traverse. DOWN is a package's own
  // dependency paths, so `mount` is NOT a down kind (a mount edge X→Y reads
  // "X mounts Y", i.e. Y's path runs UP to X). UP accepts every kind: climbing
  // mount backwards is what takes a member to its bundle and on to profile:<name>.
  var DOWN_EDGE_KINDS = ['dep', 'peer', 'peer-optional']
  var UP_EDGE_KINDS = ['dep', 'mount', 'peer', 'peer-optional']

  // R36 direction palette (both themes): down = amber family, up = teal family,
  // both = magenta family. R36 forbids colliding with what already ships —
  // profiles gold #c08a2e/#c9a45c/#d9a441, third-party purple #9a6ac2/#8a5fc0/
  // #c194e8, broken red #e05252/#c04a4a, dep blue #4c7fb8/#6da3d8, mount green
  // #3f9d6d/#57b98a, selection gold #ffd166 — every hex below is distinct from
  // all of those and from the zone palette (test/render-smoke.test.mjs pins it,
  // and style.css repeats these SAME hexes for the legend swatches).
  var FOCUS_COLORS = {
    light: { down: '#b45309', up: '#0e7490', both: '#be185d' },
    dark: { down: '#f59e0b', up: '#22d3ee', both: '#ec4899' },
  }
  // Path lists are unbounded in depth (R35: 完整路径列表); the row COUNT is
  // capped like the retired dep blocks were (same +N 更多 tail).
  var PATH_ROW_CAP = 60

  // ---------- state (brief Interfaces) ----------
  var state = {
    graph: null, byId: new Map(), groupIds: new Set(), groupZone: new Map(),
    cy: null, tableMode: false,
    theme: 'light', lang: lang,
    loading: false, // a graph fetch (+ its status poll) is in flight
    // AtlasModel `view` input. Defaults = the model defaults: every group collapsed
    // (collapsedGroups null), no zone excluded, all scopes/profiles/edge kinds pass.
    view: {
      collapsedCats: new Set(), collapsedGroups: null,
      filterCats: new Set(), filterScope: 'all', filterProfile: null,
      edgeKinds: null, showRealCross: false,
    },
    focus: null,   // null | {rootId, depth}  (R35: depth null = unlimited — the
                   // default; 1-3 via #focus-depth. Only kind=package nodes are roots.)
    selected: null,
  }

  // =======================================================================
  // PURE HELPERS (V6): DOM-free, graph-in/graph-out. render-smoke.test.mjs
  // extracts these by name (extractBalanced anchors below) and unit-tests
  // them in a bare function scope — keep them self-contained (no closure
  // reads beyond the listed constant), no DOM, no cytoscape.
  // =======================================================================

  /**
   * normalizeDepth(depth) → null | 1 | 2 | 3 (R35).
   * `null` = UNLIMITED, and it is the shipped default: the depth control's
   * value 0 means unlimited, so 0 / absent / junk all normalize to null (an
   * unusable depth must widen the view, never silently narrow it to one layer).
   * 1..3 are kept, fractions floor, anything above 3 clamps to 3.
   */
  function normalizeDepth(depth) {
    var v = typeof depth === 'number' && isFinite(depth) ? Math.floor(depth) : 0
    return v >= 1 ? Math.min(3, v) : null
  }

  /**
   * pathSets(graph, rootId, depth) →
   *   { rootId, down:Set, up:Set, both:Set, downEdges:Set, upEdges:Set }
   *
   * R35/R36: the two directed path universes of one package, computed over the
   * REAL scan edges (graph.edges `{from,to,kind[,unsatisfied]}`) — never over the
   * rendered aggregates, which depend on the current collapse state.
   *  - down: BFS over OUT-edges whose kind DOWN_EDGE_KINDS allows.
   *  - up:   BFS over IN-edges whose kind UP_EDGE_KINDS allows (mount included,
   *          traversed backwards → a member climbs to its bundle and on to
   *          `profile:<name>` without special-casing).
   *  - both: down ∩ up (cycle members).
   * The root is in NONE of the three sets: it always paints `selected`.
   * `depth` (normalizeDepth) limits the layers of EACH direction independently;
   * null is unlimited. Cycle-safe via the visited set.
   * Edge sets follow the INDUCED rule: the kind must be one this direction
   * traverses AND both endpoints must sit in (that set ∪ root) — so an edge
   * between two lit nodes with the wrong kind stays dark, and an edge that leaves
   * the set stays dark. An edge present in BOTH sets paints with the `both`
   * color. Edge keys are 'e:<from>|<to>|<kind>', AtlasModel's own real-cross edge
   * id, so a rendered real edge carries the key verbatim.
   * Deterministic (Sets built in graph.edges order, never hash order), defensive
   * (malformed edges skipped, junk inputs → empty sets) and side-effect free:
   * graph (and any view) is never written.
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

  /**
   * buildPathLists(sets, graph, byId) → { down: Row[], up: Row[] }
   * Row = { id, name, version, dist, kinds, unsat, isProfile }
   *
   * The details-panel data half of R35. `sets` is a pathSets() result (it carries
   * rootId, which is all this function needs from it beyond the Sets). Per row:
   *  - dist  = the node's BFS layer in THAT direction (1 = direct), recomputed
   *            over the direction's induced edge set — the set every member was
   *            discovered through, so a member is always reachable from the root.
   *  - kinds = the deduped kinds of the path edges that REACH the node (the down
   *            row of a both-direction node therefore lists its dependency kind,
   *            its up row the kind that reaches it backwards — a profile row ends
   *            up carrying `mount`).
   *  - unsat = one of those reaching edges is `unsatisfied`.
   *  - isProfile / name: `profile:` ids are flagged and the prefix is stripped
   *            for display. Names and versions come from the graph nodes
   *            VERBATIM (they are attacker-influenced third-party data — the
   *            renderer writes them with escText, never as markup).
   * Sort: dist asc, then display name asc, then id. A node in `both` appears in
   * both lists, each with its own dist/kinds. Junk inputs → two empty lists.
   */
  function buildPathLists(sets, graph, byId) {
    var s = sets || {}
    var g = graph || {}
    var list = Array.isArray(g.edges) ? g.edges : []
    var root = String(s.rootId == null ? '' : s.rootId)
    function kindRank(k) { var ix = EDGE_KINDS_ALL.indexOf(k); return ix < 0 ? EDGE_KINDS_ALL.length : ix }
    function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
    function build(dirSet, edgeSet, outward) {
      var rows = []
      if (!(dirSet instanceof Set) || !(edgeSet instanceof Set) || !dirSet.size) return rows
      var reach = function (e) { return outward ? e.to : e.from }
      var prev = function (e) { return outward ? e.from : e.to }
      var adj = new Map(), clean = []
      for (var i = 0; i < list.length; i++) {
        var e = list[i]
        if (!e || e.from == null || e.to == null) continue
        var from = String(e.from), to = String(e.to), kind = String(e.kind)
        if (!edgeSet.has('e:' + from + '|' + to + '|' + kind)) continue
        var ce = { from: from, to: to, kind: kind, unsat: !!e.unsatisfied }
        clean.push(ce)
        var p = prev(ce)
        var la = adj.get(p); if (!la) { la = []; adj.set(p, la) }
        la.push(ce)
      }
      var dist = new Map()
      dist.set(root, 0)
      var frontier = [root]
      for (var layer = 1; frontier.length; layer++) {
        var next = []
        for (var f = 0; f < frontier.length; f++) {
          var links = adj.get(frontier[f])
          if (!links) continue
          for (var k = 0; k < links.length; k++) {
            var t = reach(links[k])
            if (dist.has(t) || !dirSet.has(t)) continue
            dist.set(t, layer); next.push(t)
          }
        }
        frontier = next
      }
      dirSet.forEach(function (id) {
        var d = dist.get(id)
        if (d === undefined || d < 1) return // not reachable inside the induced set
        var kinds = [], unsat = false
        for (var j = 0; j < clean.length; j++) {
          if (reach(clean[j]) !== id) continue
          if (kinds.indexOf(clean[j].kind) < 0) kinds.push(clean[j].kind)
          if (clean[j].unsat) unsat = true
        }
        kinds.sort(function (x, y) { return kindRank(x) - kindRank(y) })
        var n = byId && typeof byId.get === 'function' ? byId.get(id) : null
        var isProfile = id.indexOf('profile:') === 0
        var name = n && n.name != null ? String(n.name) : id
        if (isProfile && name.indexOf('profile:') === 0) name = name.slice('profile:'.length)
        rows.push({
          id: id, name: name, version: n && n.version != null ? String(n.version) : null,
          dist: d, kinds: kinds, unsat: unsat, isProfile: isProfile,
        })
      })
      rows.sort(function (a, b) { return a.dist - b.dist || cmp(a.name, b.name) || cmp(a.id, b.id) })
      return rows
    }
    return {
      down: build(s.down, s.downEdges, true),
      up: build(s.up, s.upEdges, false),
    }
  }

  /**
   * matchNodes(graph, query, limit) → Array<node>. Search over EVERY graph node
   * (packages, profiles, broken — the whole visible universe), matching name and
   * description case-insensitively. Rank: name prefix → name substring →
   * description-only; then name asc. limit defaults to 40.
   */
  function matchNodes(graph, query, limit) {
    var g = graph || {}
    var nodes = Array.isArray(g.nodes) ? g.nodes : []
    var q = String(query == null ? '' : query).trim().toLowerCase()
    if (!q) return []
    var cap = typeof limit === 'number' && limit > 0 ? limit : 40
    var hits = []
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]
      if (!n || n.id == null) continue
      var name = String(n.name == null ? n.id : n.name)
      var lname = name.toLowerCase()
      var ldesc = String(n.description == null ? '' : n.description).toLowerCase()
      var rank = lname.indexOf(q) === 0 ? 0 : lname.indexOf(q) > 0 ? 1 : ldesc.indexOf(q) >= 0 ? 2 : -1
      if (rank >= 0) hits.push({ n: n, rank: rank, name: name })
    }
    hits.sort(function (a, b) { return a.rank - b.rank || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) })
    return hits.slice(0, cap).map(function (h) { return h.n })
  }

  /**
   * progressFor(status) → null | {state, phase, pct, scanned, total}.
   * Maps a /api/status snapshot (lib/scan.js state machine:
   * state idle|scanning|ready|failed, phase null|listing|manifests|assembling|done)
   * onto progress-bar UI state: `null` = hide the bar (terminal states), else a
   * visible frame. pct is clamped to [0,100] and 0 while total is unknown.
   */
  function progressFor(status) {
    if (!status || typeof status !== 'object') return null
    var st = status.state
    if (st === 'ready' || st === 'failed') return null
    var scanned = typeof status.scanned === 'number' && isFinite(status.scanned) && status.scanned > 0 ? status.scanned : 0
    var total = typeof status.total === 'number' && isFinite(status.total) && status.total > 0 ? status.total : 0
    var pct = total > 0 ? Math.min(100, Math.floor((scanned / total) * 100)) : 0
    return { state: st === 'scanning' ? 'scanning' : 'idle', phase: status.phase || null, pct: pct, scanned: scanned, total: total }
  }

  /**
   * edgeKindsFor(checked) → null | Set<string>.
   * The edge-kind checkbox set mapped onto the AtlasModel `view.edgeKinds`
   * field: every kind checked → null (the model's "all kinds pass" default),
   * otherwise the checked Set (an empty Set passes nothing — deliberate).
   */
  function edgeKindsFor(checked) {
    var list = Array.isArray(checked) ? checked.map(String) : []
    var set = new Set(list)
    for (var i = 0; i < EDGE_KINDS_ALL.length; i++) {
      if (!set.has(EDGE_KINDS_ALL[i])) return set
    }
    return null
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
    return (state.lang === 'zh' ? (c.zh || c.en) : (c.en || c.zh)) || catId
  }
  function shortName(name, kind) {
    var s = name == null ? '' : String(name)
    return kind === 'package' ? s.replace(/^@deepseek-ai\//, '') : s
  }
  function isDark() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) } catch (e) { return false }
  }
  function gidOf(n) { return n.group == null ? 'ungrouped' : String(n.group) }
  function zoneOf(n) { return state.groupZone.get(gidOf(n)) || String(n.category || 'ungrouped') }

  // ---------- STYLE (rebuilt per theme; V5 Step 1 + V6 flash/dim) ----------
  function styleFor(theme) {
    var dark = theme === 'dark'
    var text = dark ? '#dbe2ea' : '#22272e'
    var bg = dark ? '#12161b' : '#f7f8fa'
    var edgeLine = dark ? '#44505e' : '#9aa7b4'
    var peer = dark ? '#6da3d8' : '#4c7fb8'
    var peerOpt = dark ? '#3f5a74' : '#9dc1e8'
    var mount = dark ? '#57b98a' : '#3f9d6d'
    var st = [
      // Theme of the canvas. `background` is NOT a cytoscape property (3.34.1:
      // "The style property `background: …` is invalid"); the core spelling is
      // background-color. Dist caveat, verified here: the canvas renderer never
      // draws a core background (CRp.clearCanvas only clearRects) and the webgl
      // path reads the CONTAINER's CSS background (getBGColor) — so web/style.css
      // paints #graph with these same colors (the pairing is pinned by a test).
      { selector: 'core', style: { 'background-color': bg } },

      // ---- zones: `zone` + `cat-<zoneId>` classes, w/h floors per V5-M-6 above ----
      { selector: 'node.zone', style: {
        shape: 'rectangle', 'background-opacity': 0.12,
        'border-width': 1.5, 'border-opacity': 0.85,
        width: 'data(w)', height: 'data(h)', 'min-width': 'data(w)', 'min-height': 'data(h)',
        'compound-sizing-wrt-labels': 'exclude',
        label: 'data(label)', 'font-size': 13, 'font-weight': 'bold', color: text,
        'text-valign': 'top-inside', 'text-halign': 'center', 'text-margin-y': 8,
        'text-wrap': 'ellipsis', 'text-max-width': 300,
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
    // CARD vs CONTAINER (I-2, dist-verified): `:not()` does NOT exist in the
    // 3.34.1 selector engine — the old `node.group:not(.collapsed)` rule was
    // rejected outright ("The selector … is invalid"), so the container override
    // landed on NOTHING and every group painted at the base opacity. The state is
    // structural instead: an expanded group ALWAYS has its members in the element
    // set (survivors > 0 is the render gate) → `:parent`; a collapsed card never
    // does (AtlasModel omits them) → the base CARD look. (`:orphan` is NOT the
    // card marker in this dist — it means "no parent", and every group card has a
    // zone parent; `:childless` is the childless test, `:parent` the container one.)
    st.push({ selector: 'node.group', style: {
      shape: 'round-rectangle', 'border-width': 1,
      width: 'data(w)', height: 'data(h)', 'min-width': 'data(w)', 'min-height': 'data(h)',
      'compound-sizing-wrt-labels': 'exclude',
      label: 'data(label)', 'font-size': 11, color: text, 'text-wrap': 'ellipsis', 'text-max-width': 120,
      'text-valign': 'top-inside', 'text-halign': 'center', 'text-margin-y': 4, 'background-opacity': 0.9,
    } })
    st.push({ selector: 'node.group:parent', style: { 'background-opacity': 0.14, 'border-width': 1.25 } })
    // The card is a 132×36 chip: its label centers. The container keeps the
    // top-inside strip. (This is what makes the model's `collapsed` class carry a
    // selector — the I-6 derived guard requires every emitted class to have one.)
    st.push({ selector: 'node.group.collapsed', style: { 'text-valign': 'center', 'text-margin-y': 0 } })
    // gk-<kind> palette. `vendor` is NOT optional: lib/scan.js emits group kind
    // `vendor` (dir startsWith 'vendor/') → infra zone; without an entry the card
    // falls back to cytoscape's defaults (verified: rgb(238,238,238)/rgb(204,204,204)).
    var gk = dark
      ? { official: ['#243140', '#4b7bb5'], plugin: ['#3a2f4d', '#9a6ac2'], profile: ['#403624', '#c9a45c'], broken: ['#4a262a', '#e05252'], vendor: ['#1f3b34', '#4fc2a0'], ungrouped: ['#3a3a3a', '#9aa4ae'] }
      : { official: ['#dde7f3', '#4b7bb5'], plugin: ['#e9defa', '#8a5fc0'], profile: ['#f7ecd7', '#c08a2e'], broken: ['#f4d3d6', '#c04a4a'], vendor: ['#d9ece6', '#0f7d64'], ungrouped: ['#e8e8e8', '#909aa4'] }
    Object.keys(gk).forEach(function (kind) {
      st.push({ selector: 'node.group.gk-' + kind, style: { 'background-color': gk[kind][0], 'border-color': gk[kind][1] } })
    })

    // ---- packages: shape mapping R29 (ellipse/hexagon/rectangle/diamond) ----
    // classes from AtlasModel: pkg sk-<node.kind> sc-<node.scope>
    st.push({ selector: 'node.pkg', style: {
      shape: 'ellipse', width: 16, height: 16,
      label: 'data(label)', 'font-size': 8, color: text,
      'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 3,
      'text-wrap': 'ellipsis', 'text-max-width': 96, 'background-opacity': 1,
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

    // ---- selection / focus / flash classes (applied only inside paint + reveal) ----
    // Selection is an UNDERLAY halo, not a border: V21 hands node borders to the
    // f-* direction colors, and a border-based ring would be overwritten on any
    // selected element that is also a path member (underlay draws under the shape,
    // so the two never compete for the same property).
    st.push({ selector: 'node.selected', style: {
      'underlay-color': '#ffd166', 'underlay-opacity': 0.55, 'underlay-padding': 4,
    } })
    st.push({ selector: 'edge.selected', style: { 'overlay-color': '#ffd166', 'overlay-opacity': 0.3, 'overlay-padding': 4 } })
    st.push({ selector: '.in-focus', style: { 'border-width': 2, 'border-color': '#ffd166' } })
    st.push({ selector: '.dim', style: { opacity: 0.15 } })
    // V6 search reveal: a transient (1.2s) highlight on the target element.
    st.push({ selector: 'node.flash', style: {
      'border-width': 4, 'border-color': '#ffd166', 'background-opacity': 1,
      'overlay-color': '#ffd166', 'overlay-opacity': 0.25, 'overlay-padding': 6,
    } })
    // ---- V21 R36: focus direction colors — MUST stay LAST ----
    // A property is resolved by the LAST matching rule (verified against the
    // frozen 3.34.1 dist: it resolves by declaration order, not by selector
    // specificity — a 2-token `.node.f-up` beats a 3-token `node.pkg.sc-official`
    // purely because it comes later). So this block belongs after every
    // e-<kind>/sc-*/gk-*/sk-* rule: a focused dashed e-peer edge keeps its
    // dashed LINE-STYLE (this block never sets line-style) and takes its COLORS
    // from here. A focused member also carries .in-focus (gold border) — these
    // rules win that tie, which is exactly R36's "direction color" ruling.
    var fc = FOCUS_COLORS[theme] || FOCUS_COLORS.light
    st.push({ selector: 'node.f-down', style: { 'border-width': 2.5, 'border-color': fc.down } })
    st.push({ selector: 'node.f-up', style: { 'border-width': 2.5, 'border-color': fc.up } })
    st.push({ selector: 'node.f-both', style: { 'border-width': 2.5, 'border-color': fc.both } })
    st.push({ selector: 'edge.f-e-down', style: { 'line-color': fc.down, 'target-arrow-color': fc.down } })
    st.push({ selector: 'edge.f-e-up', style: { 'line-color': fc.up, 'target-arrow-color': fc.up } })
    st.push({ selector: 'edge.f-e-both', style: { 'line-color': fc.both, 'target-arrow-color': fc.both } })
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

  // focus/selected classes — the ONLY element mutation inside paint's tail.
  // V21: the sets come from the PURE pathSets() over the REAL graph.edges (not
  // the rendered aggregate edges — those depend on the current collapse state and
  // would make focus collapse-dependent). Each hit maps onto whatever actually
  // renders: the pkg node itself, else its group card, else its zone shell; the
  // ancestors of kept elements are never dimmed. Direction classes are written as
  // LITERAL addClass calls (the STYLE↔class guard derives the pairing from them).
  function renderIdOf(id) {
    var cy = state.cy
    if (cy.getElementById(id).length) return id
    var n = state.byId.get(id)
    if (!n) return null
    var gid = gidOf(n)
    if (cy.getElementById('g:' + gid).length) return 'g:' + gid
    var zid = state.groupZone.get(gid)
    if (zid && cy.getElementById('cat:' + zid).length) return 'cat:' + zid
    return null
  }
  function applyClasses() {
    var cy = state.cy
    if (!cy) return
    cy.elements().removeClass('dim in-focus selected f-down f-up f-both f-e-down f-e-up f-e-both')
    if (state.focus) {
      var sets = pathSets(state.graph, state.focus.rootId, state.focus.depth)
      var rootRid = renderIdOf(String(state.focus.rootId))
      var keep = new Set()
      var dirOf = new Map() // rendered id -> { down, up }
      if (rootRid) keep.add(rootRid)
      function mark(id, down, up) {
        var rid = renderIdOf(id)
        if (!rid) return
        keep.add(rid)
        var f = dirOf.get(rid)
        if (!f) { f = { down: false, up: false }; dirOf.set(rid, f) }
        f.down = f.down || down
        f.up = f.up || up
      }
      sets.down.forEach(function (id) { mark(id, true, sets.up.has(id)) })
      sets.up.forEach(function (id) { mark(id, sets.down.has(id), true) })
      // a focused element drags its ancestor chain in with it
      keep.forEach(function (id) {
        var el = cy.getElementById(id)
        if (el.length) el.parents().forEach(function (p) { keep.add(p.id()) })
      })
      // the induced edge rule counts the root as a member of both sides
      function sideHas(rid, side) {
        if (rootRid && rid === rootRid) return true
        var f = dirOf.get(rid)
        return !!(f && f[side])
      }
      cy.nodes().forEach(function (el) {
        var id = el.id()
        if (!keep.has(id)) { el.addClass('dim'); return }
        el.addClass('in-focus')
        var f = dirOf.get(id)
        if (!f) return
        if (f.down && f.up) el.addClass('f-both')
        else if (f.down) el.addClass('f-down')
        else if (f.up) el.addClass('f-up')
      })
      cy.edges().forEach(function (el) {
        var src = el.data('source'), tgt = el.data('target')
        if (!keep.has(src) || !keep.has(tgt)) { el.addClass('dim'); return }
        el.addClass('in-focus')
        var dn = sideHas(src, 'down') && sideHas(tgt, 'down')
        var up = sideHas(src, 'up') && sideHas(tgt, 'up')
        if (dn && up) el.addClass('f-e-both')
        else if (dn) el.addClass('f-e-down')
        else if (up) el.addClass('f-e-up')
      })
    }
    if (state.selected) {
      var sel = cy.getElementById(state.selected)
      if (sel.length) sel.addClass('selected')
    }
  }

  // ---------- interaction (V5 Step 2 + V6 selection/focus) ----------
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
    // single click → selection + details panel (V6 Step 4)
    cy.on('tap', 'node, edge', function (evt) { selectNode(evt.target.id()) })
    cy.on('tap', function (evt) { if (evt.target === cy) selectNode(null) })
  }
  function toggleGroup(gid) {
    if (!state.view.collapsedGroups) state.view.collapsedGroups = new Set(state.groupIds)
    state.view.collapsedGroups.has(gid) ? state.view.collapsedGroups.delete(gid) : state.view.collapsedGroups.add(gid)
    paint()
  }
  // R35: focus follows selection, and a PACKAGE node is the only legal focus
  // root. isFocusRoot() also owns the rescan guard (a root that vanished or
  // changed kind can no longer anchor a focus).
  function isFocusRoot(id) {
    var n = id == null ? null : state.byId.get(String(id))
    return !!(n && n.kind === 'package')
  }
  // Selecting anything that is not a package (broken/profile node, group card,
  // zone shell, or a blank tap) clears the focus; tapping an EDGE leaves it alone
  // (an edge is not a root, and selecting one must not drop the path being read).
  function focusForId(id) {
    var s = String(id == null ? '' : id)
    if (!s) return null
    if (!state.byId.has(s)) {
      if (s.indexOf('agg:') === 0 || s.indexOf('e:') === 0) return state.focus
      return null
    }
    return isFocusRoot(s) ? { rootId: s, depth: depthOfCtl() } : null
  }
  function selectNode(id) {
    state.selected = id
    state.focus = focusForId(id)
    renderDetails(id)
    syncFocusCtl()
    paint(false) // selection/focus-only repaint: keep the viewport
  }
  // Expand the view so `n` renders: its zone un-collapsed AND un-filtered, its
  // group un-collapsed. (view mutations only — paint() renders the result.)
  function expandPath(n) {
    var gid = gidOf(n)
    var zid = state.groupZone.get(gid) || String(n.category || 'ungrouped')
    state.view.collapsedCats.delete(zid)
    state.view.filterCats.delete(zid)
    if (!state.view.collapsedGroups) state.view.collapsedGroups = new Set(state.groupIds)
    state.view.collapsedGroups.delete(gid)
  }
  function revealNode(n) {
    if (!n) return
    expandPath(n)
    state.selected = n.id
    state.focus = focusForId(n.id) // search reveal selects → R35 focus follows
    paint()
    renderDetails(n.id)
    syncFocusCtl()
    flashReveal(n.id)
  }
  // V6 Step 2: center+zoom animation and a 1.2s transient `.flash` class.
  function flashReveal(id) {
    if (!state.cy || state.tableMode) return
    var el = state.cy.getElementById(id)
    if (!el.length) return
    state.cy.animate({ center: { eles: el }, zoom: Math.max(state.cy.zoom(), 1.4), duration: 250 })
    el.addClass('flash')
    setTimeout(function () {
      // the element may already be gone (a repaint rebuilds everything): no-op then
      var again = state.cy && state.cy.getElementById(id)
      if (again && again.length) again.removeClass('flash')
    }, 1200)
  }
  // V6 Step 3 / V21 R35: structural focus reveal — expand the ROOT and every
  // path member's ancestors, repaint (applyClasses writes the f-* classes), then
  // pan+zoom + 1.2s flash on the root. Reached from the details 聚焦 button, the
  // depth slider and the #node= deep link; a plain tap focuses through
  // selectNode() without expanding anything (the tapped node is visible already).
  function focusNode(rootId, depth, selectId) {
    var d = normalizeDepth(depth)
    state.focus = { rootId: rootId, depth: d }
    var sets = pathSets(state.graph, rootId, d)
    var rn = state.byId.get(String(rootId))
    if (rn) expandPath(rn)
    sets.down.forEach(function (id) { var n = state.byId.get(id); if (n) expandPath(n) })
    sets.up.forEach(function (id) { var n = state.byId.get(id); if (n) expandPath(n) })
    if (selectId) state.selected = selectId
    paint()
    syncFocusCtl()
    if (selectId) renderDetails(selectId)
    if (selectId) flashReveal(selectId)
  }
  function depthOfCtl() {
    var s = document.getElementById('focus-depth')
    var v = s ? parseInt(s.value, 10) : 0
    // R35: the control's value 0 means UNLIMITED (and it is the default);
    // anything unparseable falls back to the same unlimited reading.
    return v === 0 ? null : v >= 1 && v <= 3 ? v : null
  }
  function syncFocusCtl() {
    var ctl = document.getElementById('focus-ctl')
    if (!ctl) return
    ctl.hidden = !state.focus
    var sel = document.getElementById('focus-depth')
    if (state.focus && sel) sel.value = String(state.focus.depth == null ? 0 : state.focus.depth)
  }

  // ---------- search (V6 Step 2: pure matcher + Enter selects the top hit) ----------
  var searchHits = []
  function bindSearch() {
    var input = document.getElementById('search'), box = document.getElementById('search-results')
    var timer = 0
    function run() {
      box.textContent = ''; box.hidden = true
      searchHits = []
      if (!state.graph) return
      var q = input.value.trim()
      if (!q) return
      searchHits = matchNodes(state.graph, q, 40)
      searchHits.forEach(function (target) {
        var li = document.createElement('button'); li.className = 'hit'
        escText(li, shortName(target.name, target.kind) + ' — ' + (target.description || t('noDescription')).slice(0, 60))
        li.addEventListener('click', function () { box.hidden = true; revealNode(target) })
        box.appendChild(li)
      })
      box.hidden = searchHits.length === 0
    }
    input.addEventListener('input', function () { clearTimeout(timer); timer = setTimeout(run, 150) })
    input.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter' && searchHits.length) { box.hidden = true; revealNode(searchHits[0]) }
    })
  }

  // ---------- boot progress (V6 Step 1) ----------
  // `/api/status` is the scanner state machine (lib/scan.js):
  //   { state: idle|scanning|ready|failed, phase: null|listing|manifests|assembling|done,
  //     scanned, total, startedAt, finishedAt, error }
  // The graph fetch itself BLOCKS server-side until a scan finishes (single-flight
  // join), so the poll loop only drives the bar while `state.loading` is true.
  // `failed` still gets one fallback chance: /api/graph serves the previous cache
  // when one exists — the fetch succeeding IS the fallback; error bar only once
  // the fetch itself rejects.
  var pollTimer = 0
  function stopPoll() { if (pollTimer) { clearTimeout(pollTimer); pollTimer = 0 } }
  function pollTick() {
    pollTimer = 0
    if (!state.loading) return
    fetch(PREFIX + '/api/status').then(function (r) { return r.ok ? r.json() : null })
      .then(function (s) { if (state.loading) showProgress(progressFor(s)) })
      .catch(function () { /* transient poll failure: keep waiting for the graph fetch */ })
    if (state.loading) pollTimer = setTimeout(pollTick, 300)
  }
  function progressText(p) {
    if (p.state !== 'scanning') return t('preparing')
    var key = { listing: 'phaseListing', manifests: 'phaseManifests', assembling: 'phaseAssembling', done: 'phaseDone' }[p.phase]
    var s = key ? t(key) : t('preparing')
    if (p.total > 0) s += ' · ' + p.scanned + '/' + p.total
    return s
  }
  function showProgress(p) {
    var bar = document.getElementById('progress-bar')
    if (!bar) return
    if (!p) { bar.hidden = true; return }
    bar.hidden = false // style.css drives [hidden] vs flex; see the pinned rule
    var fill = bar.querySelector('.progress-fill')
    if (fill) fill.style.width = p.pct + '%'
    var txt = bar.querySelector('.progress-text')
    if (txt) escText(txt, progressText(p))
  }

  // ---------- details panel (V6 Step 4) ----------
  var detailsToken = 0
  function head(box, text) { var h = document.createElement('h2'); escText(h, text); box.appendChild(h); return h }
  function kvRow(box, key, value) {
    var d = document.createElement('div'); d.className = 'kv'
    var k = document.createElement('span'); escText(k, key)
    var v = document.createElement('span'); escText(v, value)
    d.appendChild(k); d.appendChild(v); box.appendChild(d); return d
  }
  function secTitle(box, text) { var s = document.createElement('div'); s.className = 'sec'; escText(s, text); box.appendChild(s); return s }
  function jumpButton(box, label, onClick) {
    var b = document.createElement('button'); b.className = 'jump'
    escText(b, label)
    b.addEventListener('click', onClick)
    box.appendChild(b)
    return b
  }
  function crumbButton(box, label, onClick) {
    var b = document.createElement('button'); b.className = 'crumb'
    escText(b, label)
    b.addEventListener('click', onClick)
    return b
  }
  function idToLabel(id) {
    var s = String(id)
    if (s.indexOf('cat:') === 0) return zoneTitle(s.slice(4))
    if (s.indexOf('g:') === 0) return s.slice(2)
    var n = state.byId.get(s)
    return n ? shortName(n.name, n.kind) : s
  }
  function nodeByName(name) {
    var nodes = state.graph && Array.isArray(state.graph.nodes) ? state.graph.nodes : []
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i] && nodes[i].kind === 'package' && nodes[i].name === name) return nodes[i]
    }
    return null
  }

  function renderDetails(id) {
    var box = document.getElementById('details')
    if (!box) return
    var tok = ++detailsToken
    box.textContent = ''
    if (!id || !state.graph) { box.hidden = true; return }
    box.hidden = false
    var s = String(id)
    if (s.indexOf('cat:') === 0) { detailsZone(box, s.slice(4)); return }
    if (s.indexOf('g:') === 0) { detailsGroup(box, s.slice(2)); return }
    if (s.indexOf('agg:') === 0 || s.indexOf('e:') === 0) { detailsEdge(box, s); return }
    var n = state.byId.get(s)
    if (n) { detailsNode(box, n, tok); return }
    box.hidden = true
  }

  function detailsZone(box, cid) {
    head(box, zoneTitle(cid))
    var groups = []
    state.groupIds.forEach(function (gid) { if (state.groupZone.get(gid) === cid) groups.push(gid) })
    groups.sort()
    var pkgCount = 0
    state.graph.nodes.forEach(function (n) { if (!n || n.id == null) return; if ((state.groupZone.get(gidOf(n)) || String(n.category || 'ungrouped')) === cid) pkgCount++ })
    kvRow(box, t('groupsLabel'), groups.length)
    kvRow(box, t('pkgsLabel'), pkgCount)
    if (groups.length) {
      secTitle(box, t('membersLabel'))
      groups.slice(0, 100).forEach(function (gid) {
        jumpButton(box, gid, function () { selectNode('g:' + gid) })
      })
      if (groups.length > 100) kvRow(box, '', t('moreLabel').replace('{n}', groups.length - 100))
    }
  }

  function detailsGroup(box, gid) {
    var zone = state.groupZone.get(gid)
    var crumbs = document.createElement('div'); crumbs.className = 'crumbs'
    if (zone) crumbs.appendChild(crumbButton(box, zoneTitle(zone), function () { selectNode('cat:' + zone) }))
    box.appendChild(crumbs)
    head(box, gid)
    var members = state.graph.nodes.filter(function (n) { return n && n.id != null && gidOf(n) === gid })
    members.sort(function (a, b) { return String(a.name) < String(b.name) ? -1 : String(a.name) > String(b.name) ? 1 : 0 })
    kvRow(box, t('membersLabel'), members.length)
    secTitle(box, t('membersLabel'))
    members.slice(0, 100).forEach(function (m) {
      jumpButton(box, shortName(m.name, m.kind) + (m.version && m.version !== '-' ? ' @' + m.version : ''), function () { revealNode(m) })
    })
    if (members.length > 100) kvRow(box, '', t('moreLabel').replace('{n}', members.length - 100))
  }

  function detailsEdge(box, id) {
    if (!state.cy) { box.hidden = true; return }
    var el = state.cy.getElementById(id)
    if (!el.length) { box.hidden = true; return }
    var kind = el.data('kind')
    var count = el.data('count')
    head(box, String(kind) + (count > 0 ? ' ×' + count : ''))
    var src = el.data('source'), tgt = el.data('target')
    jumpButton(box, t('depsLabel') + ' ' + idToLabel(src), function () { selectNode(String(src)) })
    jumpButton(box, idToLabel(tgt) + ' ' + t('dependentsLabel'), function () { selectNode(String(tgt)) })
  }

  function detailsNode(box, n, tok) {
    head(box, String(n.name == null ? n.id : n.name))
    // three-level breadcrumb: zone (zh/en) → group → kind badge
    var gid = gidOf(n), zid = state.groupZone.get(gid) || String(n.category || 'ungrouped')
    var crumbs = document.createElement('div'); crumbs.className = 'crumbs'
    crumbs.appendChild(crumbButton(box, zoneTitle(zid), function () { selectNode('cat:' + zid) }))
    crumbs.appendChild(document.createTextNode(' → '))
    crumbs.appendChild(crumbButton(box, gid, function () { selectNode('g:' + gid) }))
    crumbs.appendChild(document.createTextNode(' → '))
    var badge = document.createElement('span'); badge.className = 'badge'
    escText(badge, String(n.kind) + (n.scope ? ' · ' + n.scope : ''))
    crumbs.appendChild(badge)
    box.appendChild(crumbs)
    if (n.version && n.version !== '-') kvRow(box, 'v', n.version)
    if (n.path) { var p = document.createElement('div'); p.className = 'path'; escText(p, n.path); box.appendChild(p) }
    var desc = document.createElement('div'); desc.className = 'desc'
    escText(desc, n.description || t('noDescription'))
    box.appendChild(desc)
    if (n.flags && n.flags.unreadable) kvRow(box, 'flags', 'unreadable')

    // R35: the two path lists replace the old 挂载方 block and the kind-grouped
    // deps/dependents counts — they carry everything those did (mounted-by is the
    // `mount` row of the up list) plus the whole transitive chain.
    var lists = buildPathLists(pathSets(state.graph, n.id, null), state.graph, state.byId)
    pathListSection(box, t('pathDownLabel'), lists.down)
    pathListSection(box, t('pathUpLabel'), lists.up)
    // `mount` is not a DOWN path kind (R35: X→mount→Y means Y's path runs UP to
    // X), so what THIS node mounts is invisible to both lists. It is the app's
    // headline question (「dsh-base 到底把哪些包挂载进来」), so it keeps its own
    // section — rows of the same shape, built straight off the mount out-edges.
    mountOutSection(box, n.id)

    // profile nodes: declared deps + bundle surface (graph.profiles entry)
    if (n.kind === 'profile') {
      var prof = null
      var profiles = Array.isArray(state.graph.profiles) ? state.graph.profiles : []
      profiles.forEach(function (p) { if (p && p.name === n.name) prof = p })
      if (prof) {
        var deps = prof.dependencies && typeof prof.dependencies === 'object' ? prof.dependencies : {}
        var names = Object.keys(deps)
        if (names.length) {
          secTitle(box, t('declaredDepsLabel'))
          names.forEach(function (dn) {
            jumpButton(box, dn + ' ' + String(deps[dn]), function () {
              var target = nodeByName(dn)
              if (target) revealNode(target)
            })
          })
        }
        var bundles = Array.isArray(prof.bundles) ? prof.bundles : []
        if (bundles.length) {
          secTitle(box, t('bundleSurfaceLabel'))
          bundles.forEach(function (bn) {
            jumpButton(box, String(bn), function () {
              var target = nodeByName(String(bn))
              if (target) revealNode(target)
            })
          })
        }
      }
    }

    // focus button (V6 Step 3 entry)
    var btns = document.createElement('div'); btns.className = 'btns'
    var fb = document.createElement('button'); escText(fb, t('focusOn'))
    fb.addEventListener('click', function () { focusNode(n.id, depthOfCtl(), n.id) })
    btns.appendChild(fb)
    box.appendChild(btns)

    // README (v1 route: GET /api/readme?id=…, text/plain; token discards a stale
    // response after the selection moved on)
    if (n.kind === 'package') {
      var holder = document.createElement('div')
      box.appendChild(holder)
      fetch(PREFIX + '/api/readme?id=' + encodeURIComponent(n.id)).then(function (res) { return res.ok ? res.text() : null })
        .then(function (text) {
          if (tok !== detailsToken) return
          secTitle(holder, t('readmeLabel'))
          var pre = document.createElement('pre'); pre.className = 'readme'
          escText(pre, text == null ? t('noReadmeLabel') : text)
          holder.appendChild(pre)
        })
        .catch(function () { if (tok === detailsToken) { secTitle(holder, t('readmeLabel')); var e2 = document.createElement('pre'); e2.className = 'readme'; escText(e2, t('noReadmeLabel')); holder.appendChild(e2) } })
    }
  }

  // ---------- V21 R35 path-list blocks ----------
  // One row = `name@version · d{layer} · kind badges · ⚠`, click = selectNode(row.id)
  // which re-roots the focus on that row. Row text (attacker-influenced third-party
  // names) goes through escText only; the classes reuse .jump/.badge/.unsat.
  function pathRow(box, row, onClick) {
    var b = document.createElement('button'); b.className = 'jump'
    var nm = document.createElement('span')
    escText(nm, row.name + (row.version && row.version !== '-' ? '@' + row.version : ''))
    b.appendChild(nm)
    if (row.dist != null) {
      var d = document.createElement('span'); d.className = 'dist'
      escText(d, ' · ' + t('pathDistLabel').replace('{n}', row.dist))
      b.appendChild(d)
    }
    row.kinds.forEach(function (k) {
      var s = document.createElement('span'); s.className = 'badge'
      escText(s, k)
      b.appendChild(document.createTextNode(' '))
      b.appendChild(s)
    })
    if (row.unsat) {
      var u = document.createElement('span'); u.className = 'unsat'
      escText(u, ' ⚠ ' + t('unsatLabel'))
      b.appendChild(u)
    }
    b.addEventListener('click', onClick)
    box.appendChild(b)
  }
  // Header carries the count and the deepest layer (「N · 最深 M 层」); an empty
  // list still renders its title with 「无」 so the two sections never disappear.
  function pathListSection(box, title, rows) {
    if (!rows.length) { secTitle(box, title + ' · ' + t('pathNoneLabel')); return }
    var deepest = 0
    rows.forEach(function (r) { if (r.dist > deepest) deepest = r.dist })
    secTitle(box, title + ' · ' + t('pathCountLabel').replace('{n}', rows.length).replace('{d}', deepest))
    rows.slice(0, PATH_ROW_CAP).forEach(function (r) {
      pathRow(box, r, function () { selectNode(r.id) })
    })
    if (rows.length > PATH_ROW_CAP) kvRow(box, '', t('moreLabel').replace('{n}', rows.length - PATH_ROW_CAP))
  }
  // What this node MOUNTS (its bundle surface). R35's down kinds exclude `mount`
  // (correct for the highlight), so these packages are not path rows — they get
  // their own block instead of the shipped answer to 「谁被它挂载」 disappearing.
  function mountOutSection(box, id) {
    var rows = []
    var seen = new Set()
    var edges = Array.isArray(state.graph.edges) ? state.graph.edges : []
    edges.forEach(function (e) {
      if (!e || e.from == null || e.to == null) return
      if (String(e.from) !== String(id) || String(e.kind) !== 'mount') return
      var otherId = String(e.to)
      if (seen.has(otherId)) return
      seen.add(otherId)
      var tn = state.byId.get(otherId)
      var isProfile = otherId.indexOf('profile:') === 0
      var name = tn && tn.name != null ? String(tn.name) : otherId
      if (isProfile && name.indexOf('profile:') === 0) name = name.slice('profile:'.length)
      rows.push({
        id: otherId, name: name, version: tn && tn.version != null ? String(tn.version) : null,
        dist: null, kinds: ['mount'], unsat: !!e.unsatisfied, isProfile: isProfile,
      })
    })
    if (!rows.length) return
    rows.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1 })
    secTitle(box, t('mountsLabel') + ' · ' + rows.length)
    rows.slice(0, PATH_ROW_CAP).forEach(function (r) {
      pathRow(box, r, function () { selectNode(r.id) })
    })
    if (rows.length > PATH_ROW_CAP) kvRow(box, '', t('moreLabel').replace('{n}', rows.length - PATH_ROW_CAP))
  }

  // ---------- legend (V6 Step 6: 4 shapes + 5 edge kinds, collapsible) ----------
  function buildLegend() {
    var box = document.getElementById('legend')
    if (!box) return
    box.textContent = ''
    if (!state.graph) return
    var head = document.createElement('button'); head.className = 'leg-head'
    var body = document.createElement('div'); body.className = 'leg-body'
    function headLabel() { escText(head, t('legendTitle') + (body.hidden ? ' ▸' : ' ▾')) }
    head.addEventListener('click', function () { body.hidden = !body.hidden; headLabel() })
    headLabel()
    box.appendChild(head); box.appendChild(body)
    function legSec(text) { var s = document.createElement('div'); s.className = 'leg-sec'; escText(s, text); body.appendChild(s) }
    function legRow(swatchClass, swatchKind, text) {
      var row = document.createElement('div'); row.className = 'leg-row'
      var sw = document.createElement('span'); sw.className = swatchKind + ' ' + swatchClass
      var lab = document.createElement('span'); escText(lab, text)
      row.appendChild(sw); row.appendChild(lab); body.appendChild(row)
    }
    legSec(t('legendShapes'))
    legRow('sh-official', 'leg-shape', t('shOfficial'))
    legRow('sh-third-party', 'leg-shape', t('shThirdParty'))
    legRow('sh-profile', 'leg-shape', t('shProfile'))
    legRow('sh-broken', 'leg-shape', t('shBroken'))
    legSec(t('legendEdges'))
    legRow('ek-dep', 'leg-edge', t('egDep'))
    legRow('ek-mount', 'leg-edge', t('egMount'))
    legRow('ek-peer', 'leg-edge', t('egPeer'))
    legRow('ek-peer-optional', 'leg-edge', t('egPeerOpt'))
    legRow('ek-agg', 'leg-edge', t('egAgg'))
    legSec(t('legendFocus'))
    legRow('fp-down', 'leg-edge', t('pathDownLabel'))
    legRow('fp-up', 'leg-edge', t('pathUpLabel'))
  }

  // ---------- zone chips (V6 Step 5) ----------
  // Mapping (documented deviation from a naive "selected-only" chip bar): the
  // AtlasModel field is `filterCats` = zones to EXCLUDE. Chips therefore start
  // with NOTHING dimmed (all 13 zones shown) and a click DIMS the chip and
  // hides its zone (chip ⇔ excluded). Multi-select AND composes naturally.
  function buildZoneChips() {
    var box = document.getElementById('zone-chips')
    if (!box) return
    box.textContent = ''
    if (!state.graph) return
    var cats = Array.isArray(state.graph.categories) && state.graph.categories.length
      ? state.graph.categories.map(function (c) { return c && c.id != null ? String(c.id) : '' }).filter(Boolean)
      : ZONE_IDS_FALLBACK.slice()
    cats.forEach(function (id) {
      var b = document.createElement('button'); b.className = 'chip'
      var dot = document.createElement('span'); dot.className = 'dot'
      var z = (ZONE_COLORS[state.theme] || {})[id] || (ZONE_COLORS[state.theme === 'dark' ? 'light' : 'dark'] || {})[id] || { line: '#8a94a0' }
      dot.style.backgroundColor = z.line // constant palette — never user data
      var nm = document.createElement('span'); nm.className = 'n'; escText(nm, zoneTitle(id))
      b.appendChild(dot); b.appendChild(nm)
      if (state.view.filterCats.has(id)) b.classList.add('off')
      b.addEventListener('click', function () {
        if (state.view.filterCats.has(id)) state.view.filterCats.delete(id); else state.view.filterCats.add(id)
        b.classList.toggle('off', state.view.filterCats.has(id))
        paint()
      })
      box.appendChild(b)
    })
  }

  // ---------- top-bar filter controls (V6 Step 5: all drive state.view → paint) ----------
  function rebuildFilterControls() {
    var sel = document.getElementById('scope-filter')
    if (sel) {
      sel.textContent = ''
      ;[['all', 'scopeAll'], ['official', 'scopeOfficial'], ['third-party', 'scopeThird']].forEach(function (o) {
        var op = document.createElement('option'); op.value = o[0]; escText(op, t(o[1])); sel.appendChild(op)
      })
      sel.value = state.view.filterScope
    }
    var ps = document.getElementById('profile-filter')
    if (ps) {
      ps.textContent = ''
      var op0 = document.createElement('option'); op0.value = ''; escText(op0, t('profileAll')); ps.appendChild(op0)
      var seen = new Set()
      var profiles = state.graph && Array.isArray(state.graph.profiles) ? state.graph.profiles : []
      profiles.forEach(function (p) {
        if (!p || p.name == null || seen.has(String(p.name))) return
        seen.add(String(p.name))
        var op = document.createElement('option'); op.value = String(p.name); escText(op, p.name); ps.appendChild(op)
      })
      // a profile that vanished after a rescan must not silently filter to empty
      if (state.view.filterProfile != null && !seen.has(state.view.filterProfile)) state.view.filterProfile = null
      ps.value = state.view.filterProfile || ''
    }
    var cross = document.getElementById('show-real-cross')
    if (cross) cross.checked = !!state.view.showRealCross
    document.querySelectorAll('#edge-kinds input[data-kind]').forEach(function (ch) {
      ch.checked = !state.view.edgeKinds || state.view.edgeKinds.has(ch.getAttribute('data-kind'))
    })
  }
  function syncEdgeKinds() {
    var kinds = []
    document.querySelectorAll('#edge-kinds input[data-kind]').forEach(function (ch) {
      if (ch.checked) kinds.push(ch.getAttribute('data-kind'))
    })
    state.view.edgeKinds = edgeKindsFor(kinds)
    paint()
  }

  // ---------- table fallback (migrated; V6: row click fills the details panel) ----------
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
      tr.addEventListener('click', function () { selectNode(n.id) })
      tbody.appendChild(tr)
    })
    table.appendChild(tbody); box.appendChild(table)
  }

  // ---------- boot chrome (R20: binds once, survives a failed first load) ----------
  var chromeBoundOnce = false
  function bindChromeOnce() {
    if (chromeBoundOnce) return
    chromeBoundOnce = true
    // 重扫: refresh=1 fetch + the status poll runs inside loadGraph; keepView=true
    document.getElementById('refresh').addEventListener('click', function () { loadGraph(true, true) })
    document.getElementById('retry').addEventListener('click', function () { document.getElementById('error-bar').hidden = true; loadGraph(false, false) })
    document.getElementById('lang-btn').addEventListener('click', function () {
      state.lang = state.lang === 'zh' ? 'en' : 'zh'
      try { document.documentElement.setAttribute('lang', state.lang) } catch (e) { /* headless */ }
      applyI18n()
    })
    var depthSel = document.getElementById('focus-depth')
    if (depthSel) depthSel.addEventListener('change', function () {
      if (state.focus) focusNode(state.focus.rootId, depthOfCtl(), null)
    })
    var focusClear = document.getElementById('focus-clear')
    if (focusClear) focusClear.addEventListener('click', function () {
      state.focus = null
      syncFocusCtl()
      paint(false) // class-only change: no structural repaint, keep the viewport
    })
    var scope = document.getElementById('scope-filter')
    if (scope) scope.addEventListener('change', function () { state.view.filterScope = scope.value || 'all'; paint() })
    var prof = document.getElementById('profile-filter')
    if (prof) prof.addEventListener('change', function () { state.view.filterProfile = prof.value || null; paint() })
    var cross = document.getElementById('show-real-cross')
    if (cross) cross.addEventListener('change', function () { state.view.showRealCross = !!cross.checked; paint() })
    document.querySelectorAll('#edge-kinds input[data-kind]').forEach(function (ch) {
      ch.addEventListener('change', syncEdgeKinds)
    })
    var mq = null
    try { mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)') } catch (e) { /* no mq */ }
    if (mq && typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', function (ev) {
        state.theme = ev.matches ? 'dark' : 'light'
        buildZoneChips() // chip dots carry the themed palette
        paint()
      })
    }
  }

  function renderMetaAndWarnings() {
    var meta = document.getElementById('meta')
    escText(meta, state.graph.nodes.filter(function (n) { return n.kind === 'package' }).length + ' pkgs · ' +
      state.graph.edges.length + ' edges · ' + state.graph.generatedAt)
    var bar = document.getElementById('warning-bar')
    var warns = Array.isArray(state.graph.warnings) ? state.graph.warnings : []
    bar.hidden = warns.length === 0
    if (bar.hidden) return
    bar.textContent = ''
    var head = document.createElement('span'); head.className = 'warnhead'
    escText(head, '⚠ ' + warns.length + ' ' + t('warnings'))
    var open = false
    var list = document.createElement('div'); list.className = 'warnlist'; list.hidden = true
    warns.forEach(function (w) { var d = document.createElement('div'); escText(d, '[' + w.type + '] ' + (w.path ? w.path + ' — ' : '') + (w.message || '')); list.appendChild(d) })
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

  // Install a freshly fetched graph. `keepView` (the 重扫 path) preserves the
  // whole view object — collapse sets, chips, scope/profile/edge-kind/cross —
  // and only prunes focus/selection pointing at vanished nodes. The boot path
  // resets to freshView() and then applies the `#node=` deep link exactly once
  // (V5 double-painted here: paint() + revealNode() — focusNode paints once).
  function applyGraph(json, keepView) {
    state.graph = json
    state.byId = new Map(json.nodes.map(function (n) { return [n.id, n] }))
    computeGroupUniverse()
    if (keepView) {
      // a focus root that vanished OR stopped being a package cannot anchor R35
      if (state.focus && !isFocusRoot(state.focus.rootId)) state.focus = null
      if (state.selected && state.selected.indexOf(':') < 0 && !state.byId.has(state.selected)) state.selected = null
    } else {
      state.view = freshView()
      state.focus = null
      state.selected = null
    }
    rebuildFilterControls()
    buildZoneChips()
    buildLegend()
    renderMetaAndWarnings()
    syncFocusCtl()
    if (!keepView) {
      var hash = ''
      try { hash = decodeURIComponent(location.hash) } catch (e) { hash = location.hash }
      var m = /node=(.+)$/.exec(hash)
      if (m) {
        var n = state.byId.get(m[1])
        if (n) { focusNode(n.id, null, n.id); return } // R35: a deep link focuses at UNLIMITED depth
      }
    }
    paint()
    renderDetails(state.selected)
  }

  // fetch + poll live together: the poll animates #progress-bar from /api/status
  // every 300ms while the graph request is in flight (server-side it joins the
  // single-flight scan and resolves when the scan lands); the terminal cleanup
  // hides the bar whether the fetch resolved or rejected.
  function loadGraph(refresh, keepView) {
    if (state.loading) return
    state.loading = true
    document.getElementById('error-bar').hidden = true
    showProgress({ state: 'idle', phase: null, pct: 0, scanned: 0, total: 0 })
    pollTick()
    fetch(PREFIX + '/api/graph' + (refresh ? '?refresh=1' : ''))
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json() })
      .then(function (json) { applyGraph(json, keepView) })
      .catch(function (err) {
        var bar = document.getElementById('error-bar'); bar.hidden = false
        escText(document.getElementById('error-msg'), t('loadFail') + ': ' + err.message)
      })
      .then(function () { state.loading = false; stopPoll(); showProgress(null) })
  }

  // ---------- i18n application (V6: lang switch is live) ----------
  function applyI18n() {
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')) })
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.getAttribute('data-i18n-ph')) })
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.getAttribute('data-i18n-title')) })
    rebuildFilterControls()
    buildZoneChips()
    buildLegend()
    if (state.graph) renderMetaAndWarnings()
    syncFocusCtl()
    renderDetails(state.selected)
    if (state.tableMode) renderTable()
  }

  function boot() {
    state.theme = isDark() ? 'dark' : 'light'
    applyI18n() // static chrome labels + placeholders (graph-dependent parts no-op)
    bindSearch()
    bindChromeOnce()
    loadGraph(false, false) // boot: poll /api/status + fetch /api/graph
  }
  boot()
})()
