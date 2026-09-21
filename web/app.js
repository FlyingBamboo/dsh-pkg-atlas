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
      focusLabel: '聚焦深度', focusUnlimited: '不限', focusOn: '聚焦上下游', focusOff: '退出路径',
      backLabel: '返回',
      lodGroups: '组级', lodPkgs: '包级', lodLabel: '显示粒度（组级＝组卡片，双击组卡展开该区成员；包级＝全部展开）',
      peekDeps: '直接依赖', peekDependents: '直接被依赖', peekUnsat: '含未满足边', peekBroken: '断链包',
      chipShowAll: '全部显示', chipHideAll: '全部隐藏',
      legendTitle: '图例', legendShapes: '节点形状', legendEdges: '边类型', legendFocus: '聚焦路径',
      shOfficial: '官方包', shThirdParty: '第三方包', shProfile: 'Profile', shBroken: '断链包',
      egDep: '依赖 dep', egMount: '挂载 mount', egPeer: '对等 peer',
      egPeerOpt: '可选对等 peer-opt', egAgg: '聚合边（组聚焦内出现，粗细∝计数）',
      // V2.3: pkgsLabel retired with the zone COUNT row — the 成员包（N） header is
      // that count now. membersLabel stays (the peek card's 成员 N row).
      membersLabel: '成员', groupsLabel: '组',
      memberPkgsLabel: '成员包（{n}）', brokenLabel: '断链包',
      // R35 path lists (depsLabel/dependentsLabel stay: the edge details panel uses them)
      pathDownLabel: '依赖路径 ↓', pathUpLabel: '被依赖路径 ↑',
      pathCountLabel: '{n} · 最深 {d} 层', pathNoneLabel: '无', pathDistLabel: 'd{n}',
      mountsLabel: '挂载 ↓',
      depsLabel: '依赖 →', dependentsLabel: '← 被依赖',
      unsatLabel: '未满足', bundleSurfaceLabel: 'bundle 面', declaredDepsLabel: '声明依赖',
      readmeLabel: 'README', noReadmeLabel: '（无 README）', moreLabel: '+{n} 更多',
      kindLabel: '类型', groupLabel: '组', zoneLabel: '区',
      // V2.4b group focus: the disabled depth hint + the related-neighborhood headers
      groupFocusDepth: '组聚焦固定 1 跳（深度不适用）',
      relatedGroupsLabel: '相关组（{n}）', relatedPkgsLabel: '相关包（{n}）' },
    en: { title: 'DSH Package Atlas', search: 'search packages…', refresh: 'rescan', retry: 'retry',
      loadFail: 'failed to load graph', warnings: 'data warnings', noDescription: '(no description)',
      langSwitch: '中文',
      preparing: 'preparing…', phaseListing: 'listing directories', phaseManifests: 'reading manifests',
      phaseAssembling: 'assembling graph', phaseDone: 'done',
      scopeLabel: 'scope', scopeAll: 'all', scopeOfficial: 'official', scopeThird: 'third-party',
      profileLabel: 'Profile', profileAll: 'all', realCrossLabel: 'real cross edges',
      edgeKindsLabel: 'edge kinds',
      focusLabel: 'focus depth', focusUnlimited: 'unlimited', focusOn: 'focus paths', focusOff: 'exit path',
      backLabel: 'back',
      lodGroups: 'groups', lodPkgs: 'packages', lodLabel: 'display granularity (groups = cards, dbl-click a card to open its members; packages = all expanded)',
      peekDeps: 'depends', peekDependents: 'depended by', peekUnsat: 'unsatisfied edges', peekBroken: 'broken package',
      chipShowAll: 'show all', chipHideAll: 'hide all',
      legendTitle: 'Legend', legendShapes: 'node shapes', legendEdges: 'edge kinds', legendFocus: 'focus paths',
      shOfficial: 'official pkg', shThirdParty: 'third-party', shProfile: 'profile', shBroken: 'broken',
      egDep: 'depends dep', egMount: 'mount', egPeer: 'peer',
      egPeerOpt: 'optional peer (peer-opt)', egAgg: 'aggregate (in group focus, width ∝ count)',
      membersLabel: 'members', groupsLabel: 'groups',
      memberPkgsLabel: 'member packages ({n})', brokenLabel: 'broken',
      pathDownLabel: 'depends paths ↓', pathUpLabel: 'depended-on paths ↑',
      pathCountLabel: '{n} · {d} levels deep', pathNoneLabel: 'none', pathDistLabel: 'd{n}',
      mountsLabel: 'mounts ↓',
      depsLabel: 'depends on →', dependentsLabel: '← depended by',
      unsatLabel: 'unsatisfied', bundleSurfaceLabel: 'bundle surface', declaredDepsLabel: 'declared deps',
      readmeLabel: 'README', noReadmeLabel: '(no README)', moreLabel: '+{n} more',
      kindLabel: 'kind', groupLabel: 'group', zoneLabel: 'zone',
      // V2.4b group focus: the disabled depth hint + the related-neighborhood headers
      groupFocusDepth: 'group focus is fixed at 1 hop (depth does not apply)',
      relatedGroupsLabel: 'related groups ({n})', relatedPkgsLabel: 'related packages ({n})' },
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
  // capped like the retired dep blocks were (same +N 更多 tail). V22b caps it
  // PER LAYER tier (see groupRowsByDist/tierBlock).
  var PATH_ROW_CAP = 60

  // V2.3 container member lists: the details panel caps the rows it PAINTS, but
  // buildGroupMembers always reports the TRUE total next to them (an honest meta
  // count is the whole point of the +N tail — a truncated header would lie).
  var GROUP_MEMBER_CAP = 200
  var WHEEL_SENS = 2.5         // cytoscape CORE OPTION (not a style property)
  // Hover peek: a 250ms dwell keeps fly-over gestures silent.
  var PEEK_DEBOUNCE_MS = 250
  var PEEK_DESC_CAP = 140
  // Path-mode back stack + breadcrumb.
  var PATH_STACK_CAP = 20
  var CRUMB_MAX = 4

  // ---------- state (brief Interfaces) ----------
  var state = {
    graph: null, byId: new Map(), groupIds: new Set(), groupZone: new Map(),
    cy: null, tableMode: false,
    theme: 'light', lang: lang,
    loading: false, // a graph fetch (+ its status poll) is in flight
    // AtlasModel `view` input. Defaults = the model defaults: every group collapsed
    // (collapsedGroups null), no zone excluded, all scopes/profiles/edge kinds pass.
    // V2.3: `granularity` IS the displayed tier and the top-bar segment control
    // writes it straight through (two states, 组级 default — the V2.2b auto-LOD
    // that derived it from the zoom is gone); `focus` is mirrored from state.focus
    // inside paint() — the model turns it into the path-mode subgraph (V2.2a).
    view: {
      collapsedCats: new Set(), collapsedGroups: null,
      filterCats: new Set(), filterScope: 'all', filterProfile: null,
      edgeKinds: null, showRealCross: false,
      granularity: 'groups', focus: null,
    },
    focus: null,   // null | {rootId, depth}  (R35: depth null = unlimited — the
                   // default; 1-3 via #focus-depth. Only kind=package nodes are roots.)
    // V22b path-mode back stack (walk history, newest last, cap PATH_STACK_CAP)
    // and the viewport snapshot taken at ENTRY (deep copy — cytoscape's pan()
    // object is live). A non-null viewport IS the armed marker for the exit
    // animation: restoreViewport() is the only reader and it spends it.
    pathStack: [], viewport: null,
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

  /** 'g:' is the group-card id prefix AtlasModel itself emits — a 'g:' focus
   *  root is a GROUP (V2.4b). Package id namespaces (npm names, profile:,
   *  broken:) never collide with it; the model uses the same slice(0,2) rule. */
  function isGroupRootId(id) {
    return String(id == null ? '' : id).indexOf('g:') === 0
  }

  /**
   * assembleView(view) → the view object paint hands to AtlasModel.buildView.
   * V2.4b brief ruling: at the PACKAGES tier the app forces
   * view.showRealCross = true — R43 retired the base aggregate edges, so the
   * package tier without real cross edges renders a graph WITHOUT A SINGLE
   * EDGE, a UX regression the R43 ruling does not intend. The forcing happens
   * ONLY on the assembled copy: state.view (and the #show-real-cross checkbox)
   * keep the user's own value, so a tier switch back to 组级 restores it verbatim.
   */
  function assembleView(view) {
    var v = view || {}
    if (v.granularity !== 'packages' || v.showRealCross) return v
    var out = {}, k
    for (k in v) if (Object.prototype.hasOwnProperty.call(v, k)) out[k] = v[k]
    out.showRealCross = true
    return out
  }

  // R35/R36 pathSets: the V2.2a-era duplicate lived here; AtlasModel.pathSets is
  // the canonical implementation since V2.2a and this file now CONSUMES it
  // (applyClasses / focusNode / detailsNode). The V21 semantics suite runs
  // against the model export (render-smoke loadAppPure bridges it in-realm);
  // the consumption + no-copy guard is pinned there and in graph-model V22-00.

  /**
   * catTitle(categories, catId, lang) → localized zone title, raw id fallback.
   * Same resolution the state-level zoneTitle() wrapper applies (declared
   * graph.categories entry; zh picks .zh, en picks .en, each falls back to the
   * other, then to the id). Pure so the peek card can resolve titles without a
   * state closure.
   */
  function catTitle(categories, catId, lang) {
    var cats = Array.isArray(categories) ? categories : []
    var want = String(catId == null ? 'ungrouped' : catId)
    for (var i = 0; i < cats.length; i++) {
      var c = cats[i]
      if (!c || c.id == null || String(c.id) !== want) continue
      var zh = c.zh == null ? null : String(c.zh)
      var en = c.en == null ? null : String(c.en)
      return (lang === 'zh' ? (zh || en) : (en || zh)) || want
    }
    return want
  }

  /**
   * groupZoneOf(graph, gid) → the zone a group renders in, derived EXACTLY like
   * AtlasModel.computeZoneMapping: declared groups[].category wins, else the
   * first member node carrying a category, else 'ungrouped'.
   */
  function groupZoneOf(graph, gid) {
    var g = graph || {}
    var want = String(gid == null ? '' : gid)
    var gs = Array.isArray(g.groups) ? g.groups : []
    for (var i = 0; i < gs.length; i++) {
      if (gs[i] && String(gs[i].id) === want) {
        if (gs[i].category) return String(gs[i].category)
        break
      }
    }
    var ns = Array.isArray(g.nodes) ? g.nodes : []
    for (var j = 0; j < ns.length; j++) {
      var n = ns[j]
      if (!n) continue
      var ng = n.group == null ? 'ungrouped' : String(n.group)
      if (ng === want && n.category) return String(n.category)
    }
    return 'ungrouped'
  }

  /**
   * buildGroupMembers(sel, graph) → { total, rows, capped }  (V2.3).
   * The details-panel data half for the two CONTAINER kinds. `sel` is
   * { kind: 'group' | 'zone', id: <group id | category id> }:
   *  - a GROUP lists the nodes whose `group` is that id (null == 'ungrouped' —
   *    the identical keying AtlasModel and computeGroupUniverse use, and the
   *    reason a declared `graph.groups` entry with no member node lists nothing:
   *    the card renders, but there is genuinely nothing inside it);
   *  - a ZONE lists every node whose GROUP maps into it through groupZoneOf
   *    (declared groups[].category → else the first member carrying a
   *    category → else 'ungrouped'), i.e. exactly what the zone shell contains.
   * Row = { id, name, version, scope, kind, broken, unsat }. `kind` is the NODE
   * kind ('package' | 'profile' | 'broken') and `broken` the convenience flag;
   * `unsat` is the buildPathLists idiom (`!!e.unsatisfied`) applied to EVERY edge
   * touching the node, either direction, any kind — a package whose only link is
   * an unsatisfied one is exactly as broken as a path row that flags it.
   * Every string comes off the graph node VERBATIM: names and versions are
   * attacker-influenced third-party data and the renderer writes them with
   * escText, never as markup. Sort name → version → id (nulls sort as '' so the
   * order is total and independent of input order). `rows` is capped at
   * GROUP_MEMBER_CAP, `total` is the TRUE count and `capped` tells the renderer
   * to print the +N tail — a header that counted only the rows it painted would
   * under-report the container, which is the one thing a count must never do.
   */
  function buildGroupMembers(sel, graph) {
    var g = graph || {}
    var s = sel || {}
    var kind = String(s.kind == null ? '' : s.kind)
    var want = String(s.id == null ? '' : s.id)
    if (kind !== 'group' && kind !== 'zone') return { total: 0, rows: [], capped: false }
    var nodes = Array.isArray(g.nodes) ? g.nodes : []
    var edges = Array.isArray(g.edges) ? g.edges : []
    var unsat = new Set()
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]
      if (!e || !e.unsatisfied || e.from == null || e.to == null) continue
      unsat.add(String(e.from)); unsat.add(String(e.to))
    }
    function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
    function key(v) { return v == null ? '' : String(v) }
    var zoneCache = new Map()
    var rows = []
    for (var j = 0; j < nodes.length; j++) {
      var n = nodes[j]
      if (!n || n.id == null) continue
      var gid = n.group == null ? 'ungrouped' : String(n.group)
      if (kind === 'group') {
        if (gid !== want) continue
      } else {
        // one groupZoneOf per distinct group, not per node: the zone answer is a
        // property of the group, and this keeps a 200-package zone linear.
        var z = zoneCache.get(gid)
        if (z === undefined) { z = groupZoneOf(g, gid); zoneCache.set(gid, z) }
        if (z !== want) continue
      }
      var nkind = key(n.kind)
      rows.push({
        id: String(n.id), name: n.name == null ? String(n.id) : String(n.name),
        version: n.version == null ? null : String(n.version),
        scope: n.scope == null ? null : String(n.scope),
        kind: nkind, broken: nkind === 'broken', unsat: unsat.has(String(n.id)),
      })
    }
    rows.sort(function (a, b) { return cmp(key(a.name), key(b.name)) || cmp(key(a.version), key(b.version)) || cmp(a.id, b.id) })
    var max = typeof GROUP_MEMBER_CAP === 'number' && GROUP_MEMBER_CAP > 0 ? GROUP_MEMBER_CAP : 200
    return { total: rows.length, rows: rows.slice(0, max), capped: rows.length > max }
  }

  /**
   * buildRelatedGroups(sets, graph, groupsMeta, tier) → Row[]  (V2.4b details half).
   * `sets` is the AtlasModel.groupFocusSets() result for the FOCUSED group. The
   * direction truth rides the edge keys: a downEdges key is a root→neighbor edge
   * (its `to` endpoint names the neighbor), an upEdges key is neighbor→root (its
   * `from` does) — so a group seen from both sides is exactly the both side
   * groupFocusSets already subtracted into sets.both. `tier` picks the row key:
   * 'groups' aggregates the neighbor's GROUP, 'packages' keeps each neighbor
   * PACKAGE separate (those rows re-root path mode; group rows walk focus).
   * Row = { gid, name, count, kinds, dir, brokenZone }:
   *  - count = the A-side aggregate-edge count = the number of root-incident
   *    edge keys landing on that neighbor (packages tier: its touching-edge count
   *    — the identical arithmetic, just keyed one level lower);
   *  - kinds = deduped reaching kinds in EDGE_KINDS_ALL order;
   *  - brokenZone = the neighbor's zone is 'broken' (groupsMeta: Map gid→zone,
   *    the app's state.groupZone; duck-typed, absent → no flag);
   *  - sort dir(down,up,both) → name → gid. Junk (null containers, malformed
   *    keys, unknown nodes, a neighbor keyed on the root itself) drops silently.
   */
  function buildRelatedGroups(sets, graph, groupsMeta, tier) {
    var s = sets || {}
    var g = graph || {}
    var pkgs = tier === 'packages'
    var meta = groupsMeta && typeof groupsMeta.get === 'function' ? groupsMeta : new Map()
    var groupOf = new Map() // pid -> gid (the model's own group-of rule)
    var nodeName = new Map() // pid -> display name (name || id, VERBATIM)
    var nodes = Array.isArray(g.nodes) ? g.nodes : []
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i]
      if (!n || n.id == null) continue
      var pid = String(n.id)
      if (!groupOf.has(pid)) {
        groupOf.set(pid, n.group == null ? 'ungrouped' : String(n.group))
        nodeName.set(pid, n.name == null ? pid : String(n.name))
      }
    }
    var DIR_RANK = { down: 0, up: 1, both: 2 }
    function cmp(a, b) { return a < b ? -1 : a > b ? 1 : 0 }
    function kindRank(k) { var ix = EDGE_KINDS_ALL.indexOf(k); return ix < 0 ? EDGE_KINDS_ALL.length : ix }
    var rows = new Map()
    function harvest(edgeSet, dir, otherIsFrom) {
      if (!edgeSet || typeof edgeSet.forEach !== 'function') return
      edgeSet.forEach(function (key) {
        var k = String(key == null ? '' : key)
        if (k.indexOf('e:') !== 0) return
        var parts = k.slice(2).split('|')
        if (parts.length !== 3) return // malformed key: drop, never invent a row
        var from = parts[0], to = parts[1], kind = parts[2]
        var other = otherIsFrom ? from : to
        var gid = groupOf.get(other)
        if (gid === undefined || gid === s.rootGid || gid === '') return // unknown node / root itself
        var ekey = pkgs ? other : gid
        var row = rows.get(ekey)
        if (!row) { row = { gid: ekey, count: 0, kinds: [], dir: dir }; rows.set(ekey, row) }
        row.count += 1
        if (row.dir !== dir && row.dir !== 'both') row.dir = 'both' // seen from both sides
        if (row.kinds.indexOf(kind) < 0) row.kinds.push(kind)
      })
    }
    harvest(s.downEdges, 'down', false) // root→X ⇒ the NEIGHBOR is the target
    harvest(s.upEdges, 'up', true) // X→root ⇒ the NEIGHBOR is the source
    var out = []
    rows.forEach(function (row) {
      var zoneGid = pkgs ? groupOf.get(row.gid) : row.gid
      out.push({
        gid: row.gid,
        name: pkgs ? nodeName.get(row.gid) : row.gid,
        count: row.count,
        kinds: row.kinds.sort(function (a, b) { return kindRank(a) - kindRank(b) || cmp(a, b) }),
        dir: row.dir,
        brokenZone: meta.get(zoneGid) === 'broken',
      })
    })
    out.sort(function (a, b) {
      return (DIR_RANK[a.dir] - DIR_RANK[b.dir]) || cmp(a.name, b.name) || cmp(a.gid, b.gid)
    })
    return out
  }

  /**
   * buildPeekCard(n, graph, byId, lang) → the hover-peek DATA object (V22b).
   * `n` is the RENDERED element descriptor {id, kind, name, count} (kind is the
   * cytoscape data.kind: 'zone' | 'group' | 'pkg' | 'profile'); graph supplies
   * categories/edges, byId the graph node behind a package id. Returns
   *   { kind, title, version, zone, group, desc, descCut,
   *     deps, dependents, unsat, broken, members }
   * with nulls marking rows the renderer must skip. Counts follow the R35 path
   * algebra, not raw edge arithmetic: `deps` = DISTINCT packages reached by this
   * node's OUT dep/peer/peer-optional edges (mount is not a dependency),
   * `dependents` = DISTINCT sources of its IN edges of ALL kinds (mount counts —
   * a bundle is depended-on through its mounts), self-loops never count, and two
   * kinds on one pair count once. `unsat` = any direct edge (any kind, either
   * direction) is unsatisfied. Names/versions/descriptions ride VERBATIM — the
   * renderer writes them with escText (peek text is attacker-controlled data).
   */
  function buildPeekCard(n, graph, byId, lang) {
    var g = graph || {}
    var data = n || {}
    var id = String(data.id == null ? '' : data.id)
    var kind = String(data.kind == null ? '' : data.kind)
    var out = {
      kind: kind, title: String(data.name == null ? id : data.name), version: null,
      zone: null, group: null, desc: null, descCut: false,
      deps: null, dependents: null, unsat: false, broken: false, members: null,
    }
    if (kind === 'zone' || kind === 'group') {
      out.zone = kind === 'zone'
        ? catTitle(g.categories, data.name, lang)
        : catTitle(g.categories, groupZoneOf(g, data.name), lang)
      if (kind === 'zone') out.title = out.zone
      else out.group = out.title
      if (typeof data.count === 'number' && isFinite(data.count)) out.members = data.count
      return out
    }
    var node = byId && typeof byId.get === 'function' ? byId.get(id) : null
    if (node) {
      out.title = String(node.name == null ? id : node.name)
      out.version = node.version == null ? null : String(node.version)
      out.group = node.group == null ? null : String(node.group)
      out.zone = catTitle(g.categories, groupZoneOf(g, out.group == null ? 'ungrouped' : out.group), lang)
      out.broken = String(node.kind) === 'broken'
      if (node.description != null) {
        var d = String(node.description)
        var cap = typeof PEEK_DESC_CAP === 'number' ? PEEK_DESC_CAP : 140
        if (d.length > cap) { d = d.slice(0, cap); out.descCut = true }
        out.desc = d
      }
    }
    var edges = Array.isArray(g.edges) ? g.edges : []
    var deps = 0, ups = 0
    var seenDown = new Set(), seenUp = new Set()
    for (var i = 0; i < edges.length; i++) {
      var e = edges[i]
      if (!e || e.from == null || e.to == null || e.kind == null) continue
      var from = String(e.from), to = String(e.to), k = String(e.kind)
      if (from === to) continue // a package never (peeks at) depending on itself
      if (e.unsatisfied && (from === id || to === id)) out.unsat = true
      if (from === id) {
        if (DOWN_EDGE_KINDS.indexOf(k) < 0) continue
        if (!seenDown.has(to)) { seenDown.add(to); deps++ }
      } else if (to === id) {
        if (UP_EDGE_KINDS.indexOf(k) < 0) continue
        if (!seenUp.has(from)) { seenUp.add(from); ups++ }
      }
    }
    out.deps = deps
    out.dependents = ups
    return out
  }

  /**
   * pushPathStack(stack, id, cap) → NEW array (V22b path-mode back stack).
   * Consecutive same-root entries dedupe (walking a→b→a must not stack 'a'
   * twice), the newest entry rides the tail, and the cap drops from the HEAD
   * (oldest walk history dies first). null/undefined ids never enter.
   */
  function pushPathStack(stack, id, cap) {
    var out = Array.isArray(stack) ? stack.slice() : []
    if (id == null) return out
    var s = String(id)
    if (out.length && out[out.length - 1] === s) return out
    out.push(s)
    var max = typeof cap === 'number' && cap > 0 ? cap : PATH_STACK_CAP
    while (out.length > max) out.shift()
    return out
  }

  /**
   * pathChainText(labels, sep) → breadcrumb chain text (V22b).
   * `labels` arrives oldest-first with the CURRENT root last. At most CRUMB_MAX
   * entries are shown; longer chains collapse to '… → newest…' (tail survives —
   * the entries the user walked to most recently are the interesting ones).
   */
  function pathChainText(labels, sep) {
    if (!Array.isArray(labels)) return ''
    var ls = []
    for (var i = 0; i < labels.length; i++) {
      if (labels[i] != null && labels[i] !== '') ls.push(String(labels[i]))
    }
    if (!ls.length) return ''
    var joiner = sep == null ? ' → ' : String(sep)
    var cap = typeof CRUMB_MAX === 'number' ? CRUMB_MAX : 4
    if (ls.length <= cap) return ls.join(joiner)
    return '…' + joiner + ls.slice(ls.length - cap).join(joiner)
  }

  /**
   * groupRowsByDist(rows) → [{dist, rows[]}] ascending (V22b tiered lists).
   * Input order (buildPathLists: name asc) survives INSIDE a tier; out-of-order
   * input still segments ascending (defensive). Rows without a numeric dist land
   * in tier 0 (never produced by buildPathLists — mount rows never reach this).
   */
  function groupRowsByDist(rows) {
    var out = []
    if (!Array.isArray(rows) || !rows.length) return out
    var map = new Map()
    rows.forEach(function (r) {
      var d = r && typeof r.dist === 'number' ? r.dist : 0
      var t = map.get(d)
      if (!t) { t = { dist: d, rows: [] }; map.set(d, t) }
      t.rows.push(r)
    })
    Array.from(map.keys()).sort(function (a, b) { return a - b })
      .forEach(function (d) { out.push(map.get(d)) })
    return out
  }

  /**
   * Chip state predicates (V22b): filterCats is the EXCLUDE set (R32 semantics
   * survive every new gesture). soloToggleFor: a chip's dblclick hides every
   * OTHER category; performing it again while already soloed restores all.
   * hideAllCats/showAllCats drive the two row-tail buttons.
   */
  function soloToggleFor(allCats, current, id) {
    var all = Array.isArray(allCats) ? allCats.map(String) : []
    var cur = current && typeof current.has === 'function' ? current : new Set()
    var s = String(id)
    var solo = new Set()
    all.forEach(function (c) { if (c !== s) solo.add(c) })
    var already = !cur.has(s)
    solo.forEach(function (c) { if (!cur.has(c)) already = false })
    return already ? new Set() : solo
  }
  function hideAllCats(allCats) {
    var all = Array.isArray(allCats) ? allCats.map(String) : []
    return new Set(all)
  }
  function showAllCats() { return new Set() }

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
    // V22b ctx: in a path-mode view the member ancestors (zones + group frames)
    // render as CONTEXT — a dashed, strongly faded outline that stays locatable
    // without competing with the lit members inside it. Model rule: only zones
    // and group containers carry `ctx` in a focus view, members never; the
    // fit-to-path logic (pathFitEles) keys off that same shape.
    st.push({ selector: 'node.ctx', style: { 'border-style': 'dashed', 'background-opacity': 0.05 } })

    // ---- packages: shape mapping R29 (ellipse/hexagon/rectangle/diamond) ----
    // classes from AtlasModel: pkg sk-<node.kind> sc-<node.scope>
    // V2.3 LABEL CLAMP (the real fix for the browser-only label overlap): the
    // overlap is TEXT on TEXT — SIBLING pkg labels side by side, never box on
    // box. Both compound rules above pin width/height/min-* to data(w)/data(h)
    // with compound-sizing-wrt-labels:'exclude', so group/zone frames NEVER grow
    // with child labels. What collides: a pkg label centres under its node, and
    // the shipped 96 clamp let it outgrow the intra-row centre pitch
    // CELL(46)+GAP(12)=58 (graph-model ZONE_LAYOUT) and lie across the next
    // column's text — short names hide it, scoped long names do not. 50 fits a
    // label inside the pitch (96 was 1.66× it). Headless cytoscape has no font
    // metrics, so no probe here can reproduce the overlap; the numeric pin in
    // the tests is the guard.
    st.push({ selector: 'node.pkg', style: {
      shape: 'ellipse', width: 16, height: 16,
      label: 'data(label)', 'font-size': 8, color: text,
      'text-valign': 'bottom', 'text-halign': 'center', 'text-margin-y': 3,
      'text-wrap': 'ellipsis', 'text-max-width': 50, 'background-opacity': 1,
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
    // V22b ek-off: the model's focus view keeps ALL induced edges (V2.2a data-
    // layer ruling — edgeKinds is a UI intent, not a path fact), so the user's
    // edge-kind filter is enforced UI-side: applyClasses tags a focused edge
    // whose kind is unchecked. LAST so display:none beats every color/width rule
    // (and it is NOT .dim: the kind filter hides, the focus never fades).
    // display:none on edges is valid in this frozen dist (pinned by the V22b
    // dist-validity test — 'none' is the enum default, the dist rejects others).
    st.push({ selector: 'edge.ek-off', style: { display: 'none' } })
    return st
  }

  // ---------- paint(): the single render path (R26) ----------
  // `refit === false` keeps the current viewport (selection-only repaints must not
  // fight the user's zoom/pan); every structural change refits.
  function paint(refit) {
    if (!state.graph) return // static chrome binds at boot; ignore interaction until first load
    if (state.tableMode) { renderTable(); return }
    hidePeek() // the elements under a live peek are about to be destroyed
    state.view.focus = state.focus // THE single place focus flows into the model (V22b)
    try {
      if (!state.cy) {
        if (typeof window.cytoscape !== 'function') throw new Error('cytoscape missing')
        if (!window.AtlasModel || typeof window.AtlasModel.buildView !== 'function') throw new Error('AtlasModel missing')
        state.cy = window.cytoscape({ container: document.getElementById('graph'), elements: [], wheelSensitivity: WHEEL_SENS })
        bindCy()
      }
      var built = window.AtlasModel.buildView(state.graph, assembleView(state.view))
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
      if (refit !== false) {
        // V22b: meta.focus is THREE-STATE (absent = never requested | null =
        // requested but fell back | object = the path subgraph is what renders).
        // Only an ACTIVE path view refits to the path: the ctx zone/group frames
        // span whole layout rows and would shrink the path into a corner.
        var focusApplied = built.meta && built.meta.focus && typeof built.meta.focus === 'object'
        // V2.4b: a groups-mode GROUP focus renders cards only — pathFitEles (a
        // pkg/profile selector) is empty there, and fitting an empty collection
        // is undefined behavior. The render set is the neighborhood itself, so
        // the ordinary whole-view refit is the honest fallback.
        if (focusApplied && pathFitEles(state.cy).length) state.cy.fit(pathFitEles(state.cy), 40)
        else state.cy.fit(undefined, 24)
      }
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
  // V21: the sets come from AtlasModel.pathSets (canonical since V2.2a; the app
  // copy was deleted in V22b) over the REAL graph.edges (not
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
    cy.elements().removeClass('dim in-focus selected f-down f-up f-both f-e-down f-e-up f-e-both ek-off')
    if (state.focus) {
      // V2.4b: a 'g:' rootId is a GROUP focus — the neighborhood comes from
      // groupFocusSets (1-hop, disjoint tiers), everything else keeps the
      // V2.2b package-root machinery verbatim.
      var groupFocus = isGroupRootId(state.focus.rootId)
      var pkgsTier = !!(state.view && state.view.granularity === 'packages')
      var sets = groupFocus
        ? AtlasModel.groupFocusSets(state.graph, String(state.focus.rootId).slice(2))
        : AtlasModel.pathSets(state.graph, state.focus.rootId, state.focus.depth)
      // V22b: the model's focus view ignores edgeKinds (data-layer ruling), so
      // the user's kind filter is a UI-layer tag: ek-off → display:none. Never
      // .dim — hiding a kind and fading a non-member are different statements.
      var ek = state.view && state.view.edgeKinds
      var ekHide = !!(ek && typeof ek.has === 'function')
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
      if (groupFocus) {
        // V2.4a contract (A concerns#1): groupFocusSets is DISJOINT — both is
        // SUBTRACTED out of down/up and pkgsDown/pkgsUp, so the third side must
        // be lit EXPLICITLY (mark(…, true, true) → f-both) or both-side members
        // would silently dim. Mark on the tier that renders: groups mode lights
        // the neighbor CARDS by their g: ids; the packages tier lights member
        // pkgs (the g: frames ride along as uncolored ancestors — V22b ctx rule:
        // colors belong on nodes rendering as content, not as outlines).
        var gSide = pkgsTier
          ? [['pkgsDown', true, false], ['pkgsUp', false, true], ['pkgsBoth', true, true]]
          : [['down', true, false], ['up', false, true], ['both', true, true]]
        gSide.forEach(function (p) {
          var bag = sets[p[0]]
          if (!bag || typeof bag.forEach !== 'function') return
          bag.forEach(function (id) { mark(pkgsTier ? id : 'g:' + id, p[1], p[2]) })
        })
        // Root members render INSIDE the root frame (packages tier): subject
        // side — kept, never colored, never dimmed.
        if (sets.rootPkgs && typeof sets.rootPkgs.forEach === 'function') {
          sets.rootPkgs.forEach(function (id) { var r = renderIdOf(id); if (r) keep.add(r) })
        }
      } else {
        sets.down.forEach(function (id) { mark(id, true, sets.up.has(id)) })
        sets.up.forEach(function (id) { mark(id, sets.down.has(id), true) })
      }
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
        if (ekHide && !ek.has(String(el.data('kind')))) el.addClass('ek-off')
        var src = el.data('source'), tgt = el.data('target')
        if (!keep.has(src) || !keep.has(tgt)) { el.addClass('dim'); return }
        el.addClass('in-focus')
        // R37 applied to edges: membership is not direction. The colour comes
        // from the SAME rule pathSets uses (kind ∈ that direction's kinds AND the
        // endpoints sit on that side), so a mount edge between two DOWN members
        // stays kind-coloured instead of going amber.
        var eid = el.id()
        var dn, up
        if (groupFocus && eid.indexOf('agg:') === 0) {
          // V2.4b: inside a group focus the aggregate edge IS a direction fact
          // by construction — the model buckets agg:root|X purely from downEdges
          // and agg:X|root purely from upEdges — so the rule reads the root
          // endpoint, not the bucket-dominant kind (a mount-dominant down bucket
          // would go dark under the package-mode rule and R37 was never about
          // focus-local aggregates).
          dn = String(el.data('source')) === String(state.focus.rootId)
          up = String(el.data('target')) === String(state.focus.rootId)
        } else if (eid.indexOf('e:') === 0) {
          // Real cross edge: AtlasModel's id IS the pathSets key
          // ('e:'+from+'|'+to+'|'+kind, graph-model.js buildView), so the pure
          // rule answers directly — an edge in neither set is in-focus but dark,
          // and one in both (a cycle member) paints with the both colour.
          dn = sets.downEdges.has(eid)
          up = sets.upEdges.has(eid)
        } else {
          // Aggregate edge ('agg:'+s+'|'+d): it stands for a bucket of raw edges
          // and carries only the dominant data.kind, so no raw key exists to look
          // up. Apply the kind half of the rule here and take the endpoint half
          // through the very same container predicate the nodes use (sideHas): a
          // card/zone counts on the side its mapped members sit on, the root's
          // own container on both.
          var ekind = String(el.data('kind') == null ? '' : el.data('kind'))
          dn = DOWN_EDGE_KINDS.indexOf(ekind) >= 0 && sideHas(src, 'down') && sideHas(tgt, 'down')
          up = UP_EDGE_KINDS.indexOf(ekind) >= 0 && sideHas(src, 'up') && sideHas(tgt, 'up')
        }
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

  // ---------- interaction (V5 Step 2 + V6 selection/focus + V22b path mode) ----------
  function bindCy() {
    var cy = state.cy
    var peekTimer = 0
    // V2.3: NO auto-LOD. The displayed tier is whatever the segment control put in
    // view.granularity, so a zoom never re-cuts the structure — the zoom event has
    // exactly one job left, and it is dropping a peek that can no longer track the
    // camera it was anchored to.
    cy.on('zoom', hidePeek)
    // V22b hover peek: dwell 250ms on ANY node (member, card, zone) → the one
    // reusable card. pan/zoom/click/leave close it instantly.
    cy.on('pan', hidePeek)
    cy.on('dblclick', 'node', hidePeek)
    cy.on('mouseover', 'node', function (evt) {
      var target = evt.target
      clearTimeout(peekTimer)
      peekTimer = setTimeout(function () { showPeek(target) }, PEEK_DEBOUNCE_MS)
    })
    cy.on('mouseout', 'node', hidePeek)
    // double-click zone shell → toggle zone collapse. Zone data.name IS the raw
    // category id (contract); the label is the localized title (V5-M-5).
    // cytoscape bubbles child events to ancestor-matched handlers with the front
    // element kept in evt.target — only act when the FRONT element is the zone.
    // V22b: a live path owns the view — collapsedCats would only bite AFTER the
    // exit (a surprise layout change), so zone dbl-click is inert inside a path.
    cy.on('dbltap', 'node.zone', function (evt) {
      if (!evt.target.hasClass('zone')) return
      if (state.focus) return
      var cid = evt.target.data('name')
      state.view.collapsedCats.has(cid) ? state.view.collapsedCats.delete(cid) : state.view.collapsedCats.add(cid)
      paint()
    })
    // double-click group card → toggle that group. collapsedGroups defaults to
    // null = ALL collapsed, so materialize the full set on the first flip.
    // V2.3: the toggle is back where it means something — the 组级 tier. At 包级 the
    // model expands EVERY group by definition (collapsedGroups is ignored there),
    // so a collapse the next repaint contradicts is a lie: dbl-click stays the
    // documented no-op. V2.4b keeps the V2.2b inertness for PACKAGE paths — but
    // the ROOT CARD of a live GROUP focus keeps its toggle: the documented
    // tap-then-dbltap gesture enters the group focus on the first tap and opens
    // the group on the gesture, and toggleGroup re-derives the focus shape.
    // A non-root card inside a group focus stays inert (no surprise re-cut).
    cy.on('dbltap', 'node.group', function (evt) {
      if (!evt.target.hasClass('group')) return
      if (state.view.granularity !== 'groups') return
      if (state.focus && !(isGroupRootId(state.focus.rootId) && state.focus.rootId === String(evt.target.data('id')))) return
      toggleGroup(String(evt.target.data('id')).replace(/^g:/, ''))
    })
    // single click → selection + details panel (V6 Step 4); V22b adds the path-
    // mode walk/entry/exit flow and closes any peek (a click means the reader
    // moved on — and the click's repaint would destroy the peeked element).
    cy.on('tap', 'node, edge', function (evt) { hidePeek(); selectNode(evt.target.id()) })
    cy.on('tap', function (evt) { if (evt.target === cy) { hidePeek(); selectNode(null) } })
  }
  function toggleGroup(gid) {
    if (!state.view.collapsedGroups) state.view.collapsedGroups = new Set(state.groupIds)
    state.view.collapsedGroups.has(gid) ? state.view.collapsedGroups.delete(gid) : state.view.collapsedGroups.add(gid)
    // V2.4b: a group focus rooted ON this card follows the expansion — its
    // packages flag is defined as "this group is expanded" (or 包级 tier), so
    // the focus re-derives instead of contradicting the layout it renders in.
    if (state.focus && isGroupRootId(state.focus.rootId) && state.focus.rootId === 'g:' + gid) {
      state.focus = focusForId('g:' + gid)
    }
    paint()
  }
  // R35: a PACKAGE node is a legal focus root; V2.4b (R42) adds GROUP cards
  // ('g:' ids). isFocusRoot() also owns the rescan guard: a package that
  // vanished/changed kind, or a gid outside the rebuilt state.groupIds, can no
  // longer anchor a focus — for EITHER root kind.
  function isFocusRoot(id) {
    var s = String(id == null ? '' : id)
    if (isGroupRootId(s)) return !!(state.groupIds && state.groupIds.has(s.slice(2)))
    var n = id == null ? null : state.byId.get(s)
    return !!(n && n.kind === 'package')
  }
  // Selecting anything that is neither (broken/profile node, zone shell, or a
  // blank tap) clears the focus; tapping an EDGE leaves it alone (an edge is not
  // a root, and selecting one must not drop the path being read).
  function focusForId(id) {
    var s = String(id == null ? '' : id)
    if (!s) return null
    if (isGroupRootId(s)) {
      if (!isFocusRoot(s)) return null // an unknown gid anchors nothing
      // V2.4b: the GROUP focus is FIXED at 1 hop (depth is inert in the model).
      // packages = member shape iff the 包级 tier is on, or (组级 tier) this very
      // group is expanded — collapsedGroups === null means ALL collapsed.
      return {
        rootId: s, depth: 1,
        packages: state.view.granularity === 'packages' ||
          !!(state.view.collapsedGroups && !state.view.collapsedGroups.has(s.slice(2))),
      }
    }
    if (!state.byId.has(s)) {
      if (s.indexOf('agg:') === 0 || s.indexOf('e:') === 0) return state.focus
      return null
    }
    return isFocusRoot(s) ? { rootId: s, depth: depthOfCtl() } : null
  }
  // V22b path mode — the ENTRY/WALK/EXIT decision for one selection. Every
  // path-structure mutation flows through here (tap handlers) so the semantics
  // stay in one place:
  //   entry (plain → package): snapshot the live viewport ONCE, stack resets.
  //   walk  (package → other package): the PREVIOUS root goes onto the back
  //         stack (pushPathStack dedupes consecutive repeats, caps at 20).
  //   exit  (package → blank/non-package): exitFocus() clears focus + stack and
  //         arms the viewport restore; the CALLER paints(false) then
  //         restoreViewport() animates the snapshot back.
  // Returns {entered, walked, exited} so the caller can pick the animation.
  function focusFlowAction(id) {
    var prev = state.focus
    state.selected = id
    state.focus = focusForId(id)
    var next = state.focus
    if (prev && next) {
      if (next.rootId !== prev.rootId) state.pathStack = pushPathStack(state.pathStack, prev.rootId)
      return { entered: false, walked: next.rootId !== prev.rootId, exited: false }
    }
    if (next) {
      state.pathStack = []
      snapshotViewport()
      return { entered: true, walked: false, exited: false }
    }
    if (prev) {
      exitFocus()
      return { entered: false, walked: false, exited: true }
    }
    return { entered: false, walked: false, exited: false }
  }
  // Exit half, shared by blank-tap, the Esc key and the 退出路径 button: focus
  // gone, stack gone, and IF an entry snapshot exists it is left in place, armed
  // for exactly one animate-back — the surviving snapshot IS the armed marker,
  // there is no separate flag.
  // The SNAPSHOT ITSELF STAYS PUT — restoreViewport() is the only thing allowed
  // to spend it (nulling it here made that guard bail every time, i.e. the
  // documented 镜头滑回 never ran).
  // Every exit call site runs the sequence exitFocus() → paint(false) →
  // restoreViewport() in exactly that order, and the order is load-bearing: the
  // repaint sees focus === null (the whole graph is back on screen, viewport
  // kept because refit === false), and only THEN does the camera glide — gliding
  // first would have the structural repaint land mid-flight.
  function exitFocus() {
    state.focus = null
    state.pathStack = []
  }
  function selectNode(id) {
    var act = focusFlowAction(id)
    renderDetails(id)
    syncFocusCtl()
    paint(false) // selection/focus-only repaint: keep the viewport
    // V22b: entering/walking glides the camera onto the new path (cy.animate —
    // the only viewport-animation API this app uses); exiting glides back.
    if (act.entered || act.walked) animateFitPath()
    else if (act.exited) restoreViewport()
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
    var was = !!state.focus
    expandPath(n)
    state.selected = n.id
    state.focus = focusForId(n.id) // search reveal selects → R35 focus follows
    // V22b: a REVEAL re-roots authoritatively (search/deep-link), it is not a
    // walk — the back stack restarts; the viewport snapshot is only taken when
    // this reveal is itself the entry into path mode.
    if (state.focus) {
      state.pathStack = []
      if (!was) snapshotViewport()
    } else if (was) {
      exitFocus()
      // The full refit below IS the exit for a reveal: no glide on top of it, so
      // the (now stale) snapshot goes with it — dropping it IS the disarm. The
      // reveal has already re-planted the camera on a different node.
      state.viewport = null
    }
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
  // depth slider, the breadcrumb 返回 button and the #node= deep link; a plain
  // tap focuses through selectNode()/focusFlowAction() without expanding anything
  // (the tapped node is visible already). focusNode is an AUTHORITATIVE re-root:
  // it never touches pathStack (the depth slider re-cuts IN PLACE, keeping the
  // walk history), and it snapshots the viewport only when it IS the entry.
  function focusNode(rootId, depth, selectId) {
    var d = normalizeDepth(depth)
    if (!state.focus) snapshotViewport()
    // V2.4b: a g: re-root keeps the GROUP focus shape (fixed 1 hop + derived
    // packages flag) — the breadcrumb back button and the #node=g: deep link
    // both land here, and a stale {rootId, depth} shape would contradict the
    // model's parseFocus contract for g: roots.
    if (isGroupRootId(rootId)) state.focus = focusForId(String(rootId))
    else state.focus = { rootId: rootId, depth: d }
    var rn = state.byId.get(String(rootId))
    if (isGroupRootId(rootId)) {
      // The group focus view renders cards/members from the model REGARDLESS of
      // collapse state (collapsedCats/collapsedGroups are base-path dimensions)
      // — there is nothing to expand, and expanding would fight the focus.
    } else {
      var sets = AtlasModel.pathSets(state.graph, rootId, d)
      if (rn) expandPath(rn)
      sets.down.forEach(function (id) { var n = state.byId.get(id); if (n) expandPath(n) })
      sets.up.forEach(function (id) { var n = state.byId.get(id); if (n) expandPath(n) })
    }
    if (selectId) state.selected = selectId
    paint() // focus-active refit inside paint: fits the path members (no ctx padding)
    syncFocusCtl()
    if (selectId) renderDetails(selectId)
    if (selectId) flashReveal(selectId)
  }
  // ---------- V22b viewport snapshots + path fit (cy.animate ONLY) ----------
  // cytoscape's pan() hands back a LIVE object — the snapshot deep-copies.
  function snapshotViewport() {
    var cy = state.cy
    if (!cy) { state.viewport = null; return }
    var pan = cy.pan()
    state.viewport = { zoom: cy.zoom(), pan: { x: pan.x, y: pan.y } }
  }
  function restoreViewport() {
    var cy = state.cy
    // A non-null state.viewport IS the armed marker (no separate flag): this is
    // its only reader, and every path out of here spends the snapshot — so the
    // restore is one-shot by construction (armed by exitFocus, spent here once).
    if (!cy || !state.viewport || state.tableMode) { state.viewport = null; return }
    cy.animate({ zoom: state.viewport.zoom, pan: state.viewport.pan, duration: 250 })
    state.viewport = null
  }
  // The path-fit selection: ONLY package/profile members take part in the fit
  // bbox. ctx is exactly the zone/group shape (model rule), so kind ∈ {pkg,
  // profile} excludes every context frame — the members fill the screen with
  // sane padding instead of shrinking inside their zone outlines.
  function pathFitEles(cy) {
    return cy.nodes().filter(function (n) {
      var k = n.data('kind')
      return k === 'pkg' || k === 'profile'
    })
  }
  function animateFitPath() {
    var cy = state.cy
    if (!cy || state.tableMode || !state.focus) return
    var eles = pathFitEles(cy)
    // V2.4b: a groups-mode GROUP focus has no pkg/profile members — the cards
    // and their ctx frames ARE the neighborhood, so fit them instead of gliding
    // nowhere.
    if (!eles.length) eles = cy.nodes()
    if (!eles.length) return
    // The frozen 3.34.1 animate reads `fit.padding` (getFitViewport(v.eles,
    // v.padding)); `padded` is core.fit() vocabulary and is NOT an animate option
    // here — passing it silently means padding 0. 40 matches the structural
    // focus refit in paint(), so entry glide and refit agree on the inset.
    cy.animate({ fit: { eles: eles, padding: 40 }, duration: 250 })
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
    if (sel) {
      // V2.4b: the GROUP focus is fixed at 1 hop (depth is inert in the model) —
      // the select goes disabled with a bilingual hint; every exit/walk-to-
      // package path re-enables it through this same function.
      var gf = !!(state.focus && isGroupRootId(state.focus.rootId))
      sel.disabled = !!gf
      sel.title = gf ? t('groupFocusDepth') : ''
    }
    if (state.focus && sel) sel.value = String(state.focus.depth == null ? 0 : state.focus.depth)
    // V22b breadcrumb: 「← 返回 (a → b → 当前)」 rides the pathStack; hidden
    // with 0 history (nowhere to go back to). Truncation is pathChainText's.
    var back = document.getElementById('path-back')
    if (back) {
      if (state.focus && state.pathStack && state.pathStack.length) {
        back.hidden = false
        escText(back, '← ' + t('backLabel') + ' (' +
          pathChainText(state.pathStack.map(idToLabel).concat(idToLabel(state.focus.rootId))) + ')')
      } else back.hidden = true
    }
  }
  // V2.3 two-state granularity segment: mark the tier that IS in effect. There is
  // no separate mode to track — view.granularity is the one source of truth, so
  // the lit segment can never disagree with what is on screen.
  function syncLodCtl() {
    document.querySelectorAll('#lod-ctl button[data-seg]').forEach(function (b) {
      b.classList.toggle('on', b.getAttribute('data-seg') === state.view.granularity)
    })
  }

  // ---------- V22b global Esc (order per brief) ----------
  // 1. open search results → close ONLY those (also from inside the input — the
  //    one Esc semantics an input keeps). 2. typing anywhere else → hands-off.
  // 3. live path → exit through the SAME exitFocus path as the button.
  // 4. else no-op.
  function onGlobalKey(e) {
    if (!e || e.key !== 'Escape') return
    var box = document.getElementById('search-results')
    if (box && !box.hidden) { box.hidden = true; return }
    var tg = e.target
    var tag = tg && tg.tagName ? String(tg.tagName).toLowerCase() : ''
    if (tag === 'input' || tag === 'textarea' || tag === 'select' || (tg && tg.isContentEditable === true)) return
    if (state.focus) {
      exitFocus()
      renderDetails(state.selected)
      syncFocusCtl()
      paint(false)
      restoreViewport()
    }
  }

  // ---------- V22b hover peek card ----------
  // ONE reusable div inside #graph (created on first hover, never rebuilt per
  // hover), absolutely positioned from the element's RENDERED bbox (zoom/pan
  // already baked in) with edge flips, pointer-events:none (style.css) so the
  // card cannot generate its own mouseout/mouseover flicker loop. All text goes
  // through escText — peek content is attacker-influenced (third-party names,
  // descriptions, even zone labels).
  function hidePeek() {
    var card = document.getElementById('peek-card')
    if (card) card.hidden = true
  }
  function peekCard() {
    var card = document.getElementById('peek-card')
    if (!card) {
      var cont = document.getElementById('graph')
      if (!cont) return null
      card = document.createElement('div')
      card.id = 'peek-card'
      card.hidden = true
      cont.appendChild(card)
    }
    return card
  }
  function showPeek(el) {
    if (!el || !state.graph || state.tableMode) return
    if (el.removed && el.removed()) return // the debounced fire raced a repaint
    var card = peekCard()
    if (!card) return
    var p = buildPeekCard({
      id: el.id(), kind: el.data('kind'), name: el.data('name'), count: el.data('count'),
    }, state.graph, state.byId, state.lang)
    renderPeek(card, p)
    positionPeek(card, el)
  }
  function positionPeek(card, el) {
    var cont = document.getElementById('graph')
    card.hidden = false
    if (!cont) return
    var cw = cont.clientWidth || 0, chh = cont.clientHeight || 0
    var bb = null
    try { bb = el.renderedBoundingBox({ includeLabels: true, includeOverlays: false }) } catch (e) { bb = null }
    if (!bb || !isFinite(bb.x1) || !isFinite(bb.y1)) return
    var w = card.offsetWidth || 220, h = card.offsetHeight || 64
    var x = bb.x2 + 10, y = bb.y2 + 10
    if (x + w > cw) x = bb.x1 - w - 10 // flip left of the node
    if (x < 2) x = 2
    if (y + h > chh) y = bb.y1 - h - 10 // flip above the node
    if (y < 2) y = 2
    card.style.left = x + 'px'
    card.style.top = y + 'px'
  }
  // renderPeek LAST on purpose: the XSS guard slices showPeek→positionPeek and
  // asserts NO DOM creation happens there (the card is reused; row divs are
  // (re)written here, every string via escText).
  function renderPeek(card, p) {
    card.textContent = ''
    var t1 = document.createElement('div'); t1.className = 'pk-title'
    escText(t1, p.title + (p.version && p.version !== '-' ? '@' + p.version : ''))
    card.appendChild(t1)
    var subBits = []
    if (p.zone) subBits.push(p.zone)
    if (p.group) subBits.push(p.group)
    var sub = document.createElement('div'); sub.className = 'pk-sub'
    escText(sub, subBits.join(' · '))
    card.appendChild(sub)
    if (p.desc) {
      var d = document.createElement('div'); d.className = 'pk-desc'
      escText(d, p.desc + (p.descCut ? '…' : ''))
      card.appendChild(d)
    }
    if (p.deps != null || p.dependents != null) {
      var c = document.createElement('div'); c.className = 'pk-counts'
      escText(c, t('peekDeps') + ' ' + p.deps + ' · ' + t('peekDependents') + ' ' + p.dependents)
      card.appendChild(c)
    }
    if (p.members != null) {
      var m = document.createElement('div'); m.className = 'pk-counts'
      escText(m, t('membersLabel') + ' ' + p.members)
      card.appendChild(m)
    }
    if (p.unsat) {
      var u = document.createElement('div'); u.className = 'pk-flags'
      escText(u, '⚠ ' + t('peekUnsat'))
      card.appendChild(u)
    }
    if (p.broken) {
      var b = document.createElement('div'); b.className = 'pk-flags'
      escText(b, t('peekBroken'))
      card.appendChild(b)
    }
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

  // ---------- V2.3 container member lists ----------
  // One row = `name@version · [kind] [third-party] · ⚠断链 · ⚠未满足`. The click is
  // the SAME authoritative reveal a search hit / the retired group jump buttons
  // used — revealNode(graph node): un-collapse the node's zone AND group, re-root
  // the path, center + flash it (and the repaint closes any live peek). Rows reuse
  // .jump/.badge/.unsat, so there is no new CSS surface; `name`/`version`/`scope`
  // are attacker-influenced third-party data and leave through escText only.
  function memberRow(box, row, onClick) {
    var b = document.createElement('button'); b.className = 'jump'
    var nm = document.createElement('span')
    escText(nm, String(row.name) + (row.version && row.version !== '-' ? '@' + row.version : ''))
    b.appendChild(nm)
    if (row.kind && row.kind !== 'package') {
      var k = document.createElement('span'); k.className = 'badge'
      escText(k, row.kind)
      b.appendChild(document.createTextNode(' ')); b.appendChild(k)
    }
    if (row.scope === 'third-party') {
      var s = document.createElement('span'); s.className = 'badge'
      escText(s, row.scope)
      b.appendChild(document.createTextNode(' ')); b.appendChild(s)
    }
    if (row.broken) {
      var br = document.createElement('span'); br.className = 'brk'
      escText(br, ' ⚠ ' + t('brokenLabel'))
      b.appendChild(br)
    }
    if (row.unsat) {
      var u = document.createElement('span'); u.className = 'unsat'
      escText(u, ' ⚠ ' + t('unsatLabel'))
      b.appendChild(u)
    }
    b.addEventListener('click', onClick)
    box.appendChild(b)
  }
  // The section both container details share: the header count is the TRUE total
  // (buildGroupMembers caps the ROWS, never the count), and the tail says what the
  // cap hid.
  function memberSection(box, sel) {
    var res = buildGroupMembers(sel, state.graph)
    secTitle(box, t('memberPkgsLabel').replace('{n}', res.total))
    res.rows.forEach(function (r) {
      memberRow(box, r, function () {
        var n = state.byId.get(String(r.id))
        if (n) revealNode(n)
      })
    })
    if (res.capped) kvRow(box, '', t('moreLabel').replace('{n}', res.total - res.rows.length))
  }

  function detailsZone(box, cid) {
    head(box, zoneTitle(cid))
    var groups = []
    state.groupIds.forEach(function (gid) { if (state.groupZone.get(gid) === cid) groups.push(gid) })
    groups.sort()
    // V2.3: the package COUNT row is gone — the 成员包（N） header below IS that
    // count, sourced from the same rows the panel is about to paint.
    kvRow(box, t('groupsLabel'), groups.length)
    memberSection(box, { kind: 'zone', id: cid })
  }

  function detailsGroup(box, gid) {
    var zone = state.groupZone.get(gid)
    var crumbs = document.createElement('div'); crumbs.className = 'crumbs'
    if (zone) crumbs.appendChild(crumbButton(box, zoneTitle(zone), function () { selectNode('cat:' + zone) }))
    box.appendChild(crumbs)
    head(box, gid)
    // V2.3: the retired hand-rolled member loop (name-only rows, 100-cap, no
    // scope/kind/unsat/broken signal) is now the shared memberSection — the same
    // rows a zone shows, filtered to this group.
    memberSection(box, { kind: 'group', id: gid })
    // V2.4b: the 相关组/相关包 section belongs to the CURRENT GROUP FOCUS ROOT
    // only — a neighbor card's details show its own members, and walking there
    // makes ITS neighborhood the one the canvas highlights and this panel lists.
    if (state.focus && String(state.focus.rootId) === 'g:' + gid) relatedSection(box, 'g:' + gid)
  }

  // ---------- V2.4b group-focus related-neighborhood rows ----------
  // One row = `dir-arrow name ×count · kind badges · ⚠broken-zone`; all text is
  // data-derived (group ids / attacker-influenced package names) and rides
  // escText only, reusing .jump/.badge/.brk — no new CSS surface.
  function relatedRow(box, row, onClick) {
    var b = document.createElement('button'); b.className = 'jump'
    var arrow = row.dir === 'both' ? '\u2195' : row.dir === 'up' ? '\u2191' : '\u2193'
    var nm = document.createElement('span')
    escText(nm, arrow + ' ' + String(row.name) + ' \u00d7' + row.count)
    b.appendChild(nm)
    ;(row.kinds || []).forEach(function (k) {
      var s = document.createElement('span'); s.className = 'badge'
      escText(s, k)
      b.appendChild(document.createTextNode(' '))
      b.appendChild(s)
    })
    if (row.brokenZone) {
      var z = document.createElement('span'); z.className = 'brk'
      escText(z, ' \u26a0 ' + t('brokenLabel'))
      b.appendChild(z)
    }
    b.addEventListener('click', onClick)
    box.appendChild(b)
  }
  // The details half of the group focus. Row click: a GROUP row walks the focus
  // to that group (selectNode('g:…') → focusFlowAction, stack grows); a PACKAGE
  // row re-roots path mode there — both through the one selection funnel.
  function relatedSection(box, rootCardId) {
    var gid = String(rootCardId == null ? '' : rootCardId).slice(2)
    var pkgs = !!(state.focus && state.focus.packages)
    var sets = AtlasModel.groupFocusSets(state.graph, gid)
    var rows = buildRelatedGroups(sets, state.graph, state.groupZone, pkgs ? 'packages' : 'groups')
    var title = pkgs ? t('relatedPkgsLabel') : t('relatedGroupsLabel')
    secTitle(box, title.replace('{n}', rows.length))
    rows.forEach(function (r) {
      relatedRow(box, r, function () { selectNode(pkgs ? r.gid : 'g:' + r.gid) })
    })
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
    var lists = buildPathLists(AtlasModel.pathSets(state.graph, n.id, null), state.graph, state.byId)
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
  // V22b: the rows are TIERED by BFS layer — d1 (direct hits) ships open, every
  // deeper tier starts collapsed behind a 「d2 (N)」 header. The PATH_ROW_CAP now
  // applies PER TIER (was global): a long d1 can no longer hide all of d2.
  function pathListSection(box, title, rows) {
    if (!rows.length) { secTitle(box, title + ' · ' + t('pathNoneLabel')); return }
    var deepest = 0
    rows.forEach(function (r) { if (r.dist > deepest) deepest = r.dist })
    secTitle(box, title + ' · ' + t('pathCountLabel').replace('{n}', rows.length).replace('{d}', deepest))
    groupRowsByDist(rows).forEach(function (tier, ix) { tierBlock(box, tier, ix === 0) })
  }
  function tierBlock(box, tier, open) {
    var head = document.createElement('button'); head.className = 'tier'
    var holder = document.createElement('div'); holder.className = 'tier-body'
    holder.hidden = !open
    var label = t('pathDistLabel').replace('{n}', tier.dist) + ' (' + tier.rows.length + ')'
    function headLabel() { escText(head, (holder.hidden ? '▸ ' : '▾ ') + label) }
    headLabel()
    head.addEventListener('click', function () { holder.hidden = !holder.hidden; headLabel() })
    box.appendChild(head)
    box.appendChild(holder)
    tier.rows.slice(0, PATH_ROW_CAP).forEach(function (r) {
      pathRow(holder, r, function () { selectNode(r.id) })
    })
    if (tier.rows.length > PATH_ROW_CAP) kvRow(holder, '', t('moreLabel').replace('{n}', tier.rows.length - PATH_ROW_CAP))
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
      // V22b chip SOLO (dblclick): hide every OTHER category; the two clicks that
      // co-fire before dblclick toggle this chip off-then-on, so the net state is
      // deterministic: exactly this zone visible. Same chip again restores all.
      // The bar rebuild re-derives every chip's .off state from filterCats.
      b.addEventListener('dblclick', function () {
        state.view.filterCats = soloToggleFor(cats, state.view.filterCats, id)
        buildZoneChips()
        paint()
      })
      box.appendChild(b)
    })
    // V22b row-tail buttons: bulk visibility without twelve lonely clicks.
    var showAll = document.createElement('button'); showAll.className = 'chip chip-all'
    escText(showAll, t('chipShowAll'))
    showAll.addEventListener('click', function () {
      state.view.filterCats = showAllCats()
      buildZoneChips()
      paint()
    })
    box.appendChild(showAll)
    var hideAll = document.createElement('button'); hideAll.className = 'chip chip-all'
    escText(hideAll, t('chipHideAll'))
    hideAll.addEventListener('click', function () {
      state.view.filterCats = hideAllCats(cats)
      buildZoneChips()
      paint()
    })
    box.appendChild(hideAll)
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
      exitFocus() // V22b: also clears the back-stack and arms the viewport restore
      syncFocusCtl()
      paint(false) // class-only change: no structural repaint, keep the viewport
      restoreViewport() // …then glide back to the entry snapshot
    })
    // V22b breadcrumb: 返回 walks back to the previous root (skipping entries
    // that died in a rescan), staying AT the current depth.
    var pathBack = document.getElementById('path-back')
    if (pathBack) pathBack.addEventListener('click', function () {
      if (!state.focus) return
      var stack = state.pathStack
      var prev = null
      while (stack.length) {
        var cand = stack[stack.length - 1]
        stack = stack.slice(0, -1)
        if (isFocusRoot(cand)) { prev = cand; break }
      }
      state.pathStack = stack
      if (!prev) { syncFocusCtl(); return }
      focusNode(prev, state.focus.depth, prev)
    })
    // V2.3 granularity segment (组级 | 包级): the segment value IS view.granularity.
    // Two states, no zoom math, no third 「自动」 tier — and a junk data-seg cannot
    // reach the model at all. Re-clicking the lit segment changes nothing (no
    // pointless full rebuild). A tier switch is a STRUCTURAL change, so it repaints
    // and refits like every other structural control: viewport-keeping belonged to
    // the zoom-driven auto-LOD, which no longer exists.
    document.querySelectorAll('#lod-ctl button[data-seg]').forEach(function (b) {
      b.addEventListener('click', function () {
        var seg = b.getAttribute('data-seg')
        if (seg !== 'groups' && seg !== 'packages') return
        if (seg === state.view.granularity) return
        state.view.granularity = seg
        // V2.4b: a live GROUP focus re-derives its packages flag from the tier
        // (focusForId is the single source of that rule) — the focus shape never
        // lags the granularity the user just picked.
        if (state.focus && isGroupRootId(state.focus.rootId)) state.focus = focusForId(state.focus.rootId)
        syncLodCtl()
        paint()
      })
    })
    syncLodCtl()
    // V22b Esc: window-level, ordered (search results → path exit → no-op).
    try { window.addEventListener('keydown', onGlobalKey) } catch (e) { /* non-browser */ }
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
      granularity: 'groups', focus: null,
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
      // V22b: with the focus gone the walk history is dead weight; the viewport
      // snapshot too (the graph under it just changed shape).
      if (!state.focus) { state.pathStack = []; state.viewport = null }
    } else {
      state.view = freshView()
      state.focus = null
      state.selected = null
      // V2.3: a fresh load re-defaults the tier to 组级 — freshView() IS that reset
      // (view.granularity is the tier, so there is no second mode to re-arm).
      state.pathStack = []
      state.viewport = null
    }
    rebuildFilterControls()
    buildZoneChips()
    buildLegend()
    renderMetaAndWarnings()
    syncFocusCtl()
    syncLodCtl()
    if (!keepView) {
      var hash = ''
      try { hash = decodeURIComponent(location.hash) } catch (e) { hash = location.hash }
      var m = /node=(.+)$/.exec(hash)
      if (m) {
        // V2.4b: a g: anchor is a GROUP focus deep link — isFocusRoot is the
        // single gate (same one a card tap uses), and focusNode installs the
        // group shape (fixed 1 hop + derived packages flag) authoritatively.
        if (isGroupRootId(m[1])) {
          if (isFocusRoot(m[1])) { focusNode(m[1], null, m[1]); return }
        } else {
        var n = state.byId.get(m[1])
        // R35 gate: a deep link anchors a focus only when it names a PACKAGE.
        // Anything else (profile:, broken, a zone id) just reveals the node —
        // focusForId() declines it, exactly as a tap on the same node would.
        if (n && isFocusRoot(n.id)) { focusNode(n.id, null, n.id); return } // R35: a deep link focuses at UNLIMITED depth
        if (n) { revealNode(n); return }
        }
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
