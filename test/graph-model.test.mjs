/**
 * Task V4 — web/graph-model.js (AtlasModel) unit tests.
 *
 * R28: graph-model.js is a CLASSIC SCRIPT (no import/export). We load it via
 * fs.readFileSync + vm.runInNewContext with a BARE `{}` sandbox — that is the
 * purity proof: no DOM, no cytoscape, no Date.now, no Math.random available.
 *
 * Every semantic rule from the brief (1-8) is pinned here, with the
 * coordinate-constancy test (R26) as the centerpiece: collapsed vs expanded
 * builds must agree on x/y for every shared element id.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const HERE = dirname(fileURLToPath(import.meta.url))
const MODEL_PATH = join(HERE, '..', 'web', 'graph-model.js')

function loadModel() {
  const code = readFileSync(MODEL_PATH, 'utf8')
  const sandbox = {}
  vm.runInNewContext(code, sandbox)
  assert.ok(sandbox.AtlasModel, 'classic script must set globalThis.AtlasModel')
  return sandbox.AtlasModel
}

// ---------- fixture (hand-built mini publicGraph, shapes per graph-shape.json) ----------
const A1 = '@deepseek-ai/core@1.0.0'
const U1 = '@deepseek-ai/util@1.0.0'
const P1 = '@llm@1.0.0'
const P2 = '@llm2@1.0.0'
const A2 = '@fs@1.0.0'
const B1 = 'broken:@pkg-broken'
const WB = 'profile:web'
const X1 = 'plugin-x@1.0.0'

function node(id, name, kind, scope, group, category, mountedBy) {
  return {
    id, kind, name, version: kind === 'package' ? '1.0.0' : '-', scope, group, category,
    path: '$DSH_HOME\\x', description: null, servicesRequired: [], externalDeps: [],
    mountedBy: mountedBy || [], flags: { unreadable: false },
  }
}

function fixture() {
  return {
    schema: 1,
    generatedAt: '2026-09-17T00:00:00.000Z',
    dshHome: '$DSH_HOME',
    warnings: [],
    categories: [
      { id: 'kernel', zh: '内核与装配', en: 'Kernel & Assembly' },
      { id: 'tools', zh: '工具与执行', en: 'Tools & Execution' },
      { id: 'llm', zh: '模型调用', en: 'Model Calling' },
      { id: 'plugin', zh: '第三方插件', en: 'Plugins' },
      { id: 'profiles', zh: 'Profile 挂载面', en: 'Profiles' },
      { id: 'broken', zh: '断链', en: 'Broken' },
    ],
    profiles: [{ name: 'web', dependencies: {}, bundles: [] }],
    groups: [
      { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 1 },
      { id: 'util', kind: 'official', category: 'kernel', packageCount: 1 },
      { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
      { id: 'tools', kind: 'official', category: 'tools', packageCount: 1 },
      { id: 'llm', kind: 'official', category: 'llm', packageCount: 2 },
      { id: 'plugin', kind: 'plugin', category: 'plugin', packageCount: 1 },
      { id: 'profiles', kind: 'profile', category: 'profiles', packageCount: 1 },
      { id: 'broken', kind: 'broken', category: 'broken', packageCount: 1 },
      { id: 'ghost', kind: 'official', category: 'kernel', packageCount: 0 },
    ],
    nodes: [
      node(A1, '@deepseek-ai/core', 'package', 'official', 'bundle', 'kernel', ['web']),
      node(P1, '@llm', 'package', 'official', 'llm', 'llm', ['web']),
      node(P2, '@llm2', 'package', 'official', 'llm', 'llm', []),
      node(U1, '@deepseek-ai/util', 'package', 'official', 'util', 'kernel', ['web']),
      node(A2, '@fs', 'package', 'official', 'tools', 'tools', ['web']),
      node(B1, 'pkg-broken', 'broken', 'official', 'broken', 'broken', []),
      node(WB, 'web', 'profile', 'meta', 'profiles', 'profiles', []),
      node(X1, 'plugin-x', 'package', 'third-party', 'plugin', 'plugin', ['web']),
    ],
    edges: [
      { from: A1, to: P1, kind: 'dep' },            // 1
      { from: U1, to: P1, kind: 'dep' },            // 2
      { from: A2, to: A1, kind: 'dep' },            // 3
      { from: P1, to: P1, kind: 'dep' },            // 4 self-loop
      { from: WB, to: A1, kind: 'mount' },          // 5
      { from: X1, to: P1, kind: 'dep' },            // 6
      { from: X1, to: U1, kind: 'dep' },            // 7
      { from: A1, to: WB, kind: 'mount' },          // 8
      { from: A1, to: P2, kind: 'peer' },           // 9
      { from: A2, to: P2, kind: 'peer-optional' },  // 10
      { from: B1, to: A1, kind: 'peer-optional' },  // 11
      { from: X1, to: 'ghost:missing@9.9.9', kind: 'dep' }, // 12 dangling
      { from: A2, to: U1, kind: 'dep' },            // 13
      { from: A1, to: P1, kind: 'mount' },          // 14 parallel to e1
      { from: A1, to: P2, kind: 'mount' },          // 15
      { from: A2, to: P2, kind: 'peer' },           // 16 parallel to e10
    ],
  }
}

const EXPANDED = () => ({
  collapsedCats: new Set(), collapsedGroups: new Set(), filterCats: null,
  filterScope: 'all', edgeKinds: null, filterProfile: null, showRealCross: false,
})

// ---------- assertion helpers ----------
// Model output lives in the VM realm; deepStrictEqual checks prototypes, so
// every comparison against host literals goes through a JSON round-trip.
function plain(x) { return JSON.parse(JSON.stringify(x)) }
function els(res) { return res.elements }
function elMap(res) {
  const m = new Map()
  for (const e of els(res)) m.set(e.data.id, e)
  return m
}
function ids(res) { return plain(els(res).map((e) => e.data.id)) }
function nodeEls(res) { return els(res).filter((e) => e.group === 'nodes') }
function edgeEls(res) { return els(res).filter((e) => e.group === 'edges') }
function kindIds(res, kind) {
  return plain(nodeEls(res).filter((e) => e.data.kind === kind).map((e) => e.data.id))
}
function assertFiniteAll(res, label) {
  for (const e of els(res)) {
    for (const k of ['x', 'y', 'w', 'h']) {
      if (e.data[k] !== undefined) {
        assert.ok(Number.isFinite(e.data[k]), `${label}: ${e.data.id}.${k} must be finite, got ${e.data[k]}`)
      }
    }
  }
}
// R26/rule 5 for a SINGLE filter axis: build unfiltered (EXPANDED) and filtered,
// then prove every still-present element id keeps identical x/y. The `checked`
// floor guards against a vacuous pass when the filter prunes everything.
function assertFilterNeverMovesCoordinates(M, graph, overrides, label) {
  const full = elMap(M.buildView(graph, EXPANDED()))
  const filtered = M.buildView(graph, Object.assign(EXPANDED(), overrides))
  let checked = 0
  for (const e of els(filtered)) {
    assert.ok(full.has(e.data.id), `${label}: ${e.data.id} present under filter but absent unfiltered`)
    if (e.group !== 'nodes') continue // edges carry no coordinates
    assert.equal(full.get(e.data.id).data.x, e.data.x, `${label}: ${e.data.id}.x moved under filter`)
    assert.equal(full.get(e.data.id).data.y, e.data.y, `${label}: ${e.data.id}.y moved under filter`)
    checked++
  }
  assert.ok(checked > 0, `${label}: no shared positioned elements to compare (vacuous)`)
}

// =========================================================================
// Rule 0 — contract: classic script in a bare sandbox + ZONE_LAYOUT
// =========================================================================
test('V4-00 script contract: bare-sandbox globalThis.AtlasModel + ZONE_LAYOUT constants', () => {
  const code = readFileSync(MODEL_PATH, 'utf8')
  assert.ok(!/^\s*(import|export)\b/m.test(code), 'must be a classic script: no import/export statements')
  const Model = loadModel()
  assert.equal(typeof Model.buildView, 'function')
  const L = Model.ZONE_LAYOUT
  assert.equal(L.CELL, 46)
  assert.equal(L.CARD_W, 132)
  assert.equal(L.CARD_H, 36)
  assert.equal(L.ZONE_PAD, 28)
  assert.equal(L.ZONE_LABEL_H, 30)
  assert.ok(Number.isFinite(L.GAP) && L.GAP > 0, 'GAP must be a positive constant')
  assert.ok(Number.isFinite(L.FLOW_W) && L.FLOW_W > 0, 'FLOW_W (group-row flow width) must be positive')
  assert.ok(Number.isFinite(L.ZONE_GAP) && L.ZONE_GAP > 0, 'ZONE_GAP must be positive')
  assert.equal(L.ZONE_COLS, 4, 'brief rule 2: zones flow on a 4-column grid')
})

// =========================================================================
// Rules 1/3/8 + meta — default view: everything collapsed to group cards
// =========================================================================
test('V4-01 default view = all groups collapsed: zones+cards only, ordered per rule 8', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})

  // zones render in graph.categories order (kernel, tools, llm, plugin, profiles, broken)
  assert.deepEqual(kindIds(res, 'zone'), ['cat:kernel', 'cat:tools', 'cat:llm', 'cat:plugin', 'cat:profiles', 'cat:broken'])
  // groups: zone order, name order within zone; NO packages (all groups collapsed by default)
  assert.deepEqual(kindIds(res, 'group'), ['g:bundle', 'g:util', 'g:tools', 'g:llm', 'g:plugin', 'g:profiles', 'g:broken'])
  assert.deepEqual(kindIds(res, 'pkg'), [])
  assert.deepEqual(kindIds(res, 'profile'), [])
  // no order bands violated: zones < groups < pkgs < edges
  const idx = (id) => ids(res).indexOf(id)
  assert.ok(idx('cat:broken') < idx('g:bundle'), 'zones precede groups')
  assert.ok(idx('g:broken') < idx(edgeEls(res)[0].data.id), 'groups precede edges')

  const m = elMap(res)
  // rule 1: pkg→group = node.group, group→zone = groups[].category → parents
  assert.equal(m.get('g:bundle').data.parent, 'cat:kernel')
  assert.equal(m.get('g:tools').data.parent, 'cat:tools')
  assert.equal(m.get('g:llm').data.parent, 'cat:llm')
  assert.equal(m.get('g:profiles').data.parent, 'cat:profiles')

  // counts + card geometry for collapsed groups
  assert.equal(m.get('g:bundle').data.count, 1)
  assert.equal(m.get('g:llm').data.count, 2)
  assert.equal(m.get('g:bundle').data.w, M.ZONE_LAYOUT.CARD_W)
  assert.equal(m.get('g:bundle').data.h, M.ZONE_LAYOUT.CARD_H)
  assert.ok(m.get('g:bundle').classes.includes('collapsed'))

  // zone shells carry member totals + w/h for the app layer
  assert.equal(m.get('cat:kernel').data.count, 2)
  assert.equal(m.get('cat:llm').data.count, 2)
  for (const z of kindIds(res, 'zone')) {
    assert.ok(m.get(z).data.w > 0 && m.get(z).data.h > 0)
    assert.ok(!('parent' in m.get(z).data), 'zone is top-level')
    assert.ok(m.get(z).classes.includes('cat-' + z.slice(4)))
  }
  assertFiniteAll(res, 'default view')
  assert.deepEqual(plain(res.meta), { zones: 6, groups: 7, pkgs: 0, profiles: 0, realEdges: 0, aggEdges: 10, edges: 10 })
})

test('V4-02 defensive: packageCount=0 group (ghost) renders nowhere', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), EXPANDED())
  assert.ok(!ids(res).includes('g:ghost'))
})

// =========================================================================
// Rules 1/6/7 — expanded view: members render with parents
// =========================================================================
test('V4-03 expanded view: pkgs/profile render inside groups; kinds and classes per schema', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), EXPANDED())
  const m = elMap(res)

  // rule 8: pkgs in graph.nodes order (profile node included)
  assert.deepEqual(
    plain(els(res).filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile').map((e) => e.data.id)),
    [A1, P1, P2, U1, A2, B1, WB, X1],
  )
  assert.equal(m.get(A1).data.parent, 'g:bundle')
  assert.equal(m.get(A1).data.kind, 'pkg')
  assert.deepEqual(plain(m.get(A1).classes), ['pkg', 'sk-package', 'sc-official'])
  // rule 6: profile node lives in the profiles zone, pkg-slot level
  assert.equal(m.get(WB).data.parent, 'g:profiles')
  assert.equal(m.get(WB).data.kind, 'profile')
  assert.equal(m.get('cat:profiles').data.count, 1)
  // rule 7: broken node stays in broken zone
  assert.equal(m.get(B1).data.parent, 'g:broken')
  assert.ok(m.get(B1).classes.includes('sk-broken'))
  assert.equal(m.get(B1).data.kind, 'pkg')
  // packages carry x/y only (no w/h); groups/zones carry w/h
  assert.ok(!('w' in m.get(A1).data), 'pkg data must not carry w')
  assert.ok(Number.isFinite(m.get(A1).data.x) && Number.isFinite(m.get(A1).data.y))
  assertFiniteAll(res, 'expanded view')

  // single-member group: slot = card width floor; the lone cell sits at the group center
  assert.equal(m.get('g:bundle').data.w, 132)
  assert.equal(m.get(A1).data.x, m.get('g:bundle').data.x)
  assert.equal(m.get(A1).data.y, m.get('g:bundle').data.y)
  // 2-member group: ceil(sqrt(2))=2 cols × 1 row → gridH=46 (>CARD_H), slotW stays CARD_W floor
  assert.equal(m.get('g:llm').data.w, 132)
  assert.equal(m.get('g:llm').data.h, 46)
})

// =========================================================================
// R26 — COORDINATE CONSTANCY (the heart of this task)
// =========================================================================
test('V4-04 R26 coordinate constancy: collapsed vs expanded builds — same ids share x/y', () => {
  const M = loadModel()
  const graph = fixture()
  const collapsed = M.buildView(graph, {})               // all groups collapsed
  const expanded = M.buildView(graph, EXPANDED())        // nothing collapsed
  const ce = elMap(collapsed)
  const ee = elMap(expanded)
  for (const e of els(collapsed)) {
    if (e.group !== 'nodes') continue // edges legitimately differ across collapse states
    assert.ok(ee.has(e.data.id), `collapsed element ${e.data.id} must exist in expanded build`)
    assert.equal(ee.get(e.data.id).data.x, e.data.x, `${e.data.id}.x must not move on expand`)
    assert.equal(ee.get(e.data.id).data.y, e.data.y, `${e.data.id}.y must not move on expand`)
  }
  // every expanded-side node id that exists when collapsed must be checked (superset OK)
  for (const e of els(expanded)) {
    if (e.group !== 'nodes' || !ce.has(e.data.id)) continue
    assert.equal(ce.get(e.data.id).data.x, e.data.x)
    assert.equal(ce.get(e.data.id).data.y, e.data.y)
  }
  // zone shells: geometry is a pure function of the graph, identical across views
  for (const id of kindIds(collapsed, 'zone')) {
    assert.deepEqual(
      { w: ce.get(id).data.w, h: ce.get(id).data.h, x: ce.get(id).data.x, y: ce.get(id).data.y },
      { w: ee.get(id).data.w, h: ee.get(id).data.h, x: ee.get(id).data.x, y: ee.get(id).data.y },
      `zone ${id} slot must be invariant`,
    )
  }
})

test('V4-04b R26 filterCats never moves coordinates of surviving elements (rule 5)', () => {
  const M = loadModel()
  assertFilterNeverMovesCoordinates(M, fixture(), { filterCats: ['llm'] }, 'filterCats=llm')
})

test('V4-04c R26 filterScope never moves coordinates of surviving elements (rule 5)', () => {
  const M = loadModel()
  assertFilterNeverMovesCoordinates(M, fixture(), { filterScope: 'official' }, 'filterScope=official')
})

test('V4-04d R26 edgeKinds subset never moves coordinates of surviving elements (rule 5)', () => {
  const M = loadModel()
  assertFilterNeverMovesCoordinates(M, fixture(), { edgeKinds: new Set(['dep', 'mount']) }, 'edgeKinds=dep+mount')
})

test('V4-04e R26 filterProfile never moves coordinates of surviving elements (rule 5)', () => {
  const M = loadModel()
  assertFilterNeverMovesCoordinates(M, fixture(), { filterProfile: 'web' }, 'filterProfile=web')
})

// =========================================================================
// Rule 4 — endpoint resolution, aggregation, dominance, ties, self-loops
// =========================================================================
test('V4-05 rule 4: collapsed endpoints resolve to group cards; self-loops dropped', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  for (const e of edgeEls(res)) {
    assert.notEqual(e.data.source, e.data.target, `${e.data.id} self-loop must be dropped`)
    assert.ok(/^(g:|cat:)/.test(e.data.source), `collapsed build resolves source to container, got ${e.data.source}`)
    assert.ok(/^(g:|cat:)/.test(e.data.target))
    assert.ok(e.data.id.startsWith('agg:'), `default build edges are aggregated, got ${e.data.id}`)
  }
  const m = elMap(res)
  // e4 (llm→llm) and e5 collapsed (profiles→profiles) vanish as self-loops
  assert.ok(!edgeEls(res).some((e) => e.data.id === 'agg:g:llm|g:llm'))
  assert.ok(!edgeEls(res).some((e) => e.data.id === 'agg:g:profiles|g:profiles'))
  assert.ok(m.has('agg:g:util|g:llm'), 'simple cross-group aggregate present')
  // e12 dangling endpoint (node not in graph) is dropped — nothing references ghost node id
  assert.ok(!edgeEls(res).some((e) => String(e.data.target).includes('ghost:missing')))
})

test('V4-06 rule 4: aggregate count = member-pair total; dominant kind by count; ties dep>mount>peer>peer-optional', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  const m = elMap(res)
  // agg g:bundle→g:llm: e1 dep, e9 peer, e14 mount, e15 mount → count 4, mount 2 dominates
  const b2l = m.get('agg:g:bundle|g:llm')
  assert.equal(b2l.data.count, 4)
  assert.equal(b2l.data.kind, 'mount')
  assert.deepEqual(plain(b2l.classes), ['e-agg', 'e-mount'])
  // agg g:tools→g:llm: peer-optional 1 + peer 1 → tie → peer wins (fixed order)
  const t2l = m.get('agg:g:tools|g:llm')
  assert.equal(t2l.data.count, 2)
  assert.equal(t2l.data.kind, 'peer')
  assert.deepEqual(plain(t2l.classes), ['e-agg', 'e-peer'])
  // agg g:broken→g:bundle: single peer-optional
  assert.equal(m.get('agg:g:broken|g:bundle').data.kind, 'peer-optional')
})

test('V4-07 rule 4: zone-collapse resolves endpoints to the zone shell', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), { collapsedCats: new Set(['llm']), collapsedGroups: new Set() })
  const m = elMap(res)
  // zone shell kept with total member count; group cards hidden
  assert.equal(m.get('cat:llm').data.count, 2)
  assert.ok(!m.has('g:llm'))
  assert.ok(!m.has(P1), 'members of a collapsed zone are hidden')
  // edges into collapsed llm resolve to cat:llm; sources are the EXPANDED bundle pkgs
  assert.ok(m.has('agg:' + A1 + '|cat:llm'), 'bundle pkgs (expanded) now aggregate into the zone shell')
  assert.equal(m.get('agg:' + A1 + '|cat:llm').data.count, 4) // e1 dep, e9 peer, e14 mount, e15 mount
  assert.equal(m.get('agg:' + A1 + '|cat:llm').data.kind, 'mount')
  assert.ok(m.has('agg:' + U1 + '|cat:llm')) // e2
  assert.ok(!m.has('agg:g:bundle|g:llm'), 'group-level bucket must not exist when target zone collapsed')
})

test('V4-08 rule 4 + showRealCross: expanded pkg↔pkg endpoints switch agg→real', () => {
  const M = loadModel()
  const graph = fixture()
  const withReal = M.buildView(graph, Object.assign(EXPANDED(), { showRealCross: true }))
  const re = edgeEls(withReal)
  // 16 edges − e4 (self) − e12 (dangling) = 14 real edges, zero aggregates
  assert.equal(re.length, 14)
  assert.ok(re.every((e) => e.classes.includes('cross')), 'real edges carry the cross marker')
  assert.ok(re.every((e) => !e.data.id.startsWith('agg:')))
  assert.ok(elMap(withReal).has('e:' + A1 + '|' + P1 + '|dep'), 'real edge id = from|to|kind unique key')
  // e5 profile→pkg is a normal real edge when both endpoints render
  assert.ok(re.some((e) => e.data.source === WB && e.data.target === A1))
  assert.deepEqual(plain(withReal.meta), { zones: 6, groups: 7, pkgs: 7, profiles: 1, realEdges: 14, aggEdges: 0, edges: 14 })

  const noReal = M.buildView(graph, Object.assign(EXPANDED(), { showRealCross: false }))
  const ne = edgeEls(noReal)
  // 16 − e4 self − e12 dangling − 3 parallel-pair merges (e1+e14, e9+e15, e10+e16) = 11
  assert.equal(ne.length, 11)
  assert.ok(ne.every((e) => e.data.id.startsWith('agg:')), 'without showRealCross pkg pairs still aggregate')
  assert.ok(elMap(noReal).has('agg:' + A2 + '|' + A1))
  assert.equal(elMap(noReal).get('agg:' + A1 + '|' + P1).data.count, 2, 'mixed kinds → ONE aggregate')
})

// =========================================================================
// Rule 5 — filters: prune BEFORE aggregation, coordinates untouched
// =========================================================================
test('V4-09 filterCats prunes whole zones incl. edges touching them; agg recomputed after', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {
    collapsedCats: new Set(), collapsedGroups: new Set(), filterCats: ['llm'],
    filterScope: 'all', edgeKinds: null, filterProfile: null, showRealCross: true,
  })
  const idset = new Set(ids(res))
  // OUT-of-scope (filterCats = EXCLUDE list): the pruned zone must be gone…
  assert.ok(!idset.has('cat:llm') && !idset.has('g:llm') && !idset.has(P1) && !idset.has(P2))
  // …and IN-scope must be POSITIVELY present, not merely "not the pruned ids".
  // An absence-only suite passes on a polarity-inverted filter that empties the
  // whole view; these survivor asserts pin the keep side of the same filter.
  assert.ok(idset.has('cat:kernel'), 'in-scope zone cat:kernel must survive an llm exclusion')
  assert.ok(idset.has(A1), 'a member package of the in-scope zone must survive')
  assert.ok(edgeEls(res).length > 0, 'at least one edge among survivors must survive')
  for (const e of edgeEls(res)) {
    assert.ok(idset.has(e.data.source) && idset.has(e.data.target),
      `surviving edge ${e.data.id} must reference rendered endpoints only`)
  }
  for (const e of edgeEls(res)) {
    assert.ok(!String(e.data.source).includes('llm') || e.data.source.startsWith('cat:'))
    assert.ok(!['llm', P1, P2].some((x) => e.data.source === 'g:' + x || e.data.target === 'g:' + x || e.data.source === x || e.data.target === x),
      `edge ${e.data.id} touches a pruned element`)
  }
})

test('V4-10 edgeKinds prunes real edges BEFORE aggregation (counts reflect visible kinds)', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {
    collapsedCats: new Set(), collapsedGroups: new Set(['bundle', 'llm', 'profiles']),
    filterCats: null, filterScope: 'all', edgeKinds: new Set(['mount']), filterProfile: null, showRealCross: false,
  })
  const m = elMap(res)
  // mount edges only: e5(profiles→bundle), e8(bundle→profiles), e14+e15(bundle→llm)
  assert.deepEqual(plain(edgeEls(res).map((e) => e.data.id)).sort(), ['agg:g:bundle|g:llm', 'agg:g:bundle|g:profiles', 'agg:g:profiles|g:bundle'])
  assert.equal(m.get('agg:g:bundle|g:llm').data.count, 2, 'count = only visible kinds')
  assert.equal(m.get('agg:g:bundle|g:llm').data.kind, 'mount')
})

test('V4-11 filterProfile keeps profile node + mountedBy survivors; empty zones/groups vanish', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {
    collapsedCats: new Set(), collapsedGroups: new Set(), filterCats: null,
    filterScope: 'all', edgeKinds: null, filterProfile: 'web', showRealCross: false,
  })
  const m = elMap(res)
  // survivors: a1,a2,p1,u1,x1 (+ profile node web); p2 (mountedBy []) and b1 dropped
  const pk = plain(els(res).filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile').map((e) => e.data.id))
  assert.deepEqual(pk, [A1, P1, U1, A2, WB, X1])
  assert.ok(!m.has('cat:broken') && !m.has('g:broken'), 'zone with zero survivors does not render')
  // this view renders EXPANDED groups → pkg-level buckets; e10/e16 died with p2 → bucket gone, not stale
  assert.ok(!m.has('agg:' + A2 + '|' + P2))
  // survivors-only recount with recomputed dominance: e1 dep + e14 mount → tie → dep
  assert.equal(m.get('agg:' + A1 + '|' + P1).data.count, 2)
  assert.equal(m.get('agg:' + A1 + '|' + P1).data.kind, 'dep')
  assert.equal(m.get('cat:profiles').data.count, 1)
  assertFiniteAll(res, 'profile filter')
})

test('V4-11b filterScope official/third-party pruning; profiles are scope-immune', () => {
  const M = loadModel()
  const third = M.buildView(fixture(), Object.assign(EXPANDED(), { filterScope: 'third-party' }))
  const pk = plain(els(third).filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile').map((e) => e.data.id))
  assert.deepEqual(pk, [WB, X1])
  assert.deepEqual(kindIds(third, 'zone'), ['cat:plugin', 'cat:profiles'])
  assert.equal(edgeEls(third).length, 0, 'no edges survive between x1 and web')

  const off = M.buildView(fixture(), Object.assign(EXPANDED(), { filterScope: 'official' }))
  const pm = elMap(off)
  assert.ok(!pm.has(X1) && !pm.has('cat:plugin'), 'third-party + its zone pruned')
  assert.ok(pm.has(B1), 'broken node is scope official → stays')
  assert.equal(pm.get('agg:' + A1 + '|' + P1).data.count, 2, 'e1+e14 only (x1 edges pruned with x1)')
  assert.ok(!pm.has('agg:' + X1 + '|' + P1) && !pm.has('agg:' + X1 + '|' + U1))

  const offCollapsed = M.buildView(fixture(), { filterScope: 'official' })
  assert.equal(elMap(offCollapsed).get('agg:g:bundle|g:llm').data.count, 4, 'group-level recount official-only')
})

// =========================================================================
// Rule 8 — output order
// =========================================================================
test('V4-12 rule 8: edges ordered agg(s,d) first, then real edges in graph.edges order', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  const pairs = plain(edgeEls(res).map((e) => [e.data.source, e.data.target]))
  const sorted = [...pairs].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
  assert.deepEqual(pairs, sorted, 'aggregates sorted by (source, target)')
  assert.equal(pairs.length, 10)

  const mixed = M.buildView(fixture(), Object.assign(EXPANDED(), { showRealCross: true }))
  const expectedRealOrder = ['dep', 'dep', 'dep', 'mount', 'dep', 'dep', 'mount', 'peer', 'peer-optional', 'peer-optional', 'dep', 'mount', 'mount', 'peer']
    // graph order minus e4 (self) and e12 (dangling)
  const gotReal = edgeEls(mixed).filter((e) => !e.data.id.startsWith('agg:'))
  assert.deepEqual(plain(gotReal.map((e) => e.data.kind)), expectedRealOrder)
})

// =========================================================================
// Edge cases + determinism
// =========================================================================
test('V4-13 empty graph edge case: empty elements, zero meta, no throw', () => {
  const M = loadModel()
  const res = M.buildView({ schema: 1, categories: [], profiles: [], groups: [], nodes: [], edges: [] }, {})
  assert.deepEqual(plain(res.elements), [])
  assert.equal(res.meta.zones, 0)
  assert.equal(res.meta.groups, 0)
  assert.equal(res.meta.edges, 0)
})

test('V4-14 determinism: double build deep-equal; model never mutates graph/view', () => {
  const M = loadModel()
  const view = () => ({
    collapsedCats: new Set(['broken']), collapsedGroups: new Set(['bundle', 'llm']),
    filterCats: null, filterScope: 'all', edgeKinds: new Set(['dep', 'peer', 'peer-optional']),
    filterProfile: null, showRealCross: true,
  })
  const g1 = fixture()
  const g2 = fixture()
  // Deep structural snapshot BEFORE any build: comparing g1 vs g2 only after
  // both builds is vacuous (identical corruption on both sides passes it).
  const g1Before = JSON.stringify(g1)
  const g2Before = JSON.stringify(g2)
  const s1 = JSON.stringify(M.buildView(g1, view()))
  const s2 = JSON.stringify(M.buildView(g2, view()))
  assert.equal(s1, s2, 'two builds over equal inputs must be deep-equal')
  assert.equal(JSON.stringify(g1), g1Before, 'graph g1 after build must byte-match its pre-build snapshot')
  assert.equal(JSON.stringify(g2), g2Before, 'graph g2 after build must byte-match its pre-build snapshot')
  const v = view()
  M.buildView(g1, v)
  assert.deepEqual([...v.collapsedGroups], ['bundle', 'llm'], 'view sets must not be mutated')
})

test('V4-15 zone collapse hides all members but keeps zone shell with total count', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), { collapsedCats: new Set(['kernel']), collapsedGroups: new Set() })
  const m = elMap(res)
  assert.ok(m.has('cat:kernel'), 'zone shell retained')
  assert.equal(m.get('cat:kernel').data.count, 2, 'total (visible) member count')
  assert.ok(!m.has('g:bundle') && !m.has('g:util'), 'group cards hidden')
  assert.ok(!m.has(A1) && !m.has(U1), 'members hidden')
  assertFiniteAll(res, 'zone collapse')
})

// =========================================================================
// I-5 — zone group-flow: every card owns its slot. A single `row.x` per row
// made EVERY card in the row read the same x, so they stacked on one another
// (measured on HEAD: g:bundle and g:util both at (226,81), 132x36 overlap).
// These tests are the ones that would have caught it.
// =========================================================================
/** One zone with 6 single-member groups → 3 cards per row (132*3 + 2*12 = 420
 *  ≤ FLOW_W 480, a 4th would need 564) → two rows; plus a 2-card zone. */
function wideGraph() {
  const nodes = []
  const groups = []
  for (let i = 0; i < 6; i++) {
    groups.push({ id: 'wg' + i, kind: 'official', category: 'kernel', packageCount: 1 })
    nodes.push(node('w' + i + '@1.0.0', 'pkg-w' + i, 'package', 'official', 'wg' + i, 'kernel', ['web']))
  }
  groups.push({ id: 'u2a', kind: 'official', category: 'tools', packageCount: 1 })
  groups.push({ id: 'u2b', kind: 'official', category: 'tools', packageCount: 1 })
  nodes.push(node('t1@1.0.0', 'pkg-t1', 'package', 'official', 'u2a', 'tools', ['web']))
  nodes.push(node('t2@1.0.0', 'pkg-t2', 'package', 'official', 'u2b', 'tools', ['web']))
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: 'k', en: 'k' }, { id: 'tools', zh: 't', en: 't' }],
    profiles: [], groups, nodes, edges: [{ from: 'w0@1.0.0', to: 'w1@1.0.0', kind: 'dep' }],
  }
}

/** Rows = cards sharing a y (the flow engine tops-aligns inside a row). */
function rowsOf(cards) {
  const byZone = new Map()
  for (const c of cards) {
    const key = c.data.parent
    if (!byZone.has(key)) byZone.set(key, new Map())
    const byY = byZone.get(key)
    const bk = String(c.data.y)
    if (!byY.has(bk)) byY.set(bk, [])
    byY.get(bk).push(c.data)
  }
  return byZone
}

function assertSlotGeometry(M, graph, overrides, label, { exactFill }) {
  const L = M.ZONE_LAYOUT
  const res = M.buildView(graph, overrides)
  const zones = nodeEls(res).filter((e) => e.data.kind === 'zone')
  const cards = nodeEls(res).filter((e) => e.data.kind === 'group')
  assert.ok(zones.length >= 2 && cards.length >= 6, `${label}: geometry probe needs zones+cards (${zones.length}/${cards.length})`)

  // 1) pairwise-distinct (x,y) — stacked cards share BOTH coordinates
  const at = new Map()
  for (const c of cards) {
    const k = c.data.x + '|' + c.data.y
    assert.ok(!at.has(k), `${label}: ${c.data.id} stacks on ${at.get(k)} at (${k})`)
    at.set(k, c.data.id)
  }

  // 2) slot rectangles never overlap (center ± w/2, ± h/2)
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      const a = cards[i].data, b = cards[j].data
      const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
      const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2)
      assert.ok(ox <= 1e-9 || oy <= 1e-9, `${label}: ${a.id} overlaps ${b.id} by ${ox.toFixed(1)}x${oy.toFixed(1)}`)
    }
  }
  // …and neither do the zone rectangles themselves
  for (let i = 0; i < zones.length; i++) {
    for (let j = i + 1; j < zones.length; j++) {
      const a = zones[i].data, b = zones[j].data
      const ox = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2)
      const oy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2)
      assert.ok(ox <= 1e-9 || oy <= 1e-9, `${label}: zone ${a.id} overlaps ${b.id}`)
    }
  }

  // 3) per zone, the cards fill the ROW they were flowed into (this is the
  //    stacking detector: with one shared row.x the extent is a single card).
  const byZone = rowsOf(cards)
  let multiCardRows = 0, multiRowZones = 0
  for (const [zid, byY] of byZone) {
    const zone = zones.find((z) => z.data.id === zid)
    assert.ok(zone, `${label}: cards of ${zid} have a rendered zone`)
    if (byY.size > 1) multiRowZones++
    const contentW = zone.data.w - 2 * L.ZONE_PAD
    const left = zone.data.x - zone.data.w / 2, right = zone.data.x + zone.data.w / 2
    let widest = 0
    for (const [, row] of byY) {
      row.sort((a, b) => a.x - b.x)
      if (row.length > 1) multiCardRows++
      const lo = Math.min(...row.map((d) => d.x - d.w / 2))
      const hi = Math.max(...row.map((d) => d.x + d.w / 2))
      widest = Math.max(widest, hi - lo)
      assert.ok(lo >= left + L.ZONE_PAD - 1e-9 && hi <= right - L.ZONE_PAD + 1e-9,
        `${label}: row of ${row.length} in ${zid} escapes the zone content box`)
      for (let k = 1; k < row.length; k++) {
        const gap = (row[k].x - row[k].w / 2) - (row[k - 1].x + row[k - 1].w / 2)
        assert.ok(gap >= L.GAP - 1e-9,
          `${label}: ${zid} cards ${row[k - 1].id}/${row[k].id} are ${gap.toFixed(1)} apart (< GAP ${L.GAP})`)
      }
    }
    const eps = 1e-9
    if (exactFill) {
      assert.ok(Math.abs(widest - contentW) <= 1e-6,
        `${label}: ${zid} widest row spans ${widest.toFixed(1)} but the zone content width is ${contentW.toFixed(1)}`)
    } else {
      assert.ok(widest <= contentW + eps, `${label}: ${zid} row spans ${widest} > content width ${contentW}`)
      // every card sits in its own slot: a stacked row spans exactly one card
      assert.ok(widest >= (contentW + L.CARD_W) / 2,
        `${label}: ${zid} row spans only ${widest} of ${contentW} → cards are stacking`)
    }
  }
  assert.ok(multiCardRows >= 1, `${label}: fixture must produce a row with >1 card (vacuous otherwise)`)
  return { cards: cards.length, multiCardRows, multiRowZones }
}

test('V5-16 I-5 slot flow: cards are distinct, non-overlapping and fill their row (rich fixture)', () => {
  const M = loadModel()
  const collapsed = assertSlotGeometry(M, fixture(), {}, 'all-collapsed', { exactFill: false })
  const expanded = assertSlotGeometry(M, fixture(), EXPANDED(), 'all-expanded', { exactFill: false })
  assert.ok(collapsed.multiCardRows >= 1 && expanded.multiCardRows >= 1)
})

test('V5-16b I-5 slot flow: multi-row zone — widest row equals the zone content width', () => {
  const M = loadModel()
  const L = M.ZONE_LAYOUT
  const stats = assertSlotGeometry(M, wideGraph(), {}, 'wide all-collapsed', { exactFill: true })
  assert.equal(stats.multiRowZones, 1, 'the 6-group zone flowed into two rows')
  assert.equal(stats.multiCardRows, 3, 'two rows × (3 cards… one has the pair zone) rows of >1 card')
  assertSlotGeometry(M, wideGraph(), { collapsedGroups: new Set() }, 'wide all-expanded', { exactFill: true })
  // 3 cards fit a 480 row: 3*132 + 2*12 = 420, a 4th would need 564
  const { elements } = M.buildView(wideGraph(), {})
  const kernel = elements.find((e) => e.data.id === 'cat:kernel').data
  assert.equal(kernel.w, 3 * L.CARD_W + 2 * L.GAP + 2 * L.ZONE_PAD, 'zone width = widest row + padding')
  // …and the two rows are stacked, not printed on top of each other
  const ys = [...new Set(elements.filter((e) => e.data.kind === 'group' && e.data.parent === 'cat:kernel').map((e) => e.data.y))]
  assert.equal(ys.length, 2, 'kernel has two card rows at distinct y')
})

test('V5-16c I-5 slot flow is collapse-independent (V4 coordinate constancy re-pinned)', () => {
  const M = loadModel()
  for (const graph of [fixture(), wideGraph()]) {
    const c = elMap(M.buildView(graph, {}))
    const e = elMap(M.buildView(graph, EXPANDED()))
    for (const id of [...c.keys()]) {
      if (!e.has(id) || c.get(id).group !== 'nodes') continue
      assert.deepEqual(
        { x: c.get(id).data.x, y: c.get(id).data.y },
        { x: e.get(id).data.x, y: e.get(id).data.y },
        `${id} moved between collapse states`,
      )
    }
  }
})

// =========================================================================
// Task V2.2a — view.granularity + view.focus subgraph + canonical pathSets.
// The pathSets cases are the app-side V21 semantics (render-smoke) re-run INSIDE
// the model sandbox. V22b deleted the app.js copy, so the former cross-copy
// parity of V22-00 was MIGRATED (not dropped): its consumption half became a
// grep guard and its semantics half a direct BFS expectation (see V22-00 below).
// =========================================================================

/** A pathSets result is only comparable across realms through its Sets. */
function serSets(s) {
  return JSON.stringify({
    rootId: s.rootId,
    down: [...s.down], up: [...s.up], both: [...s.both],
    downEdges: [...s.downEdges], upEdges: [...s.upEdges],
  })
}

function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const k of Object.keys(x)) deepFreeze(x[k])
  }
  return x
}

// Bare path-graph fixtures for the pathSets surface (ids only — pathSets needs
// nothing else). Ports of render-smoke's dirFixture/focusFixture.
function dirGraph() {
  return {
    nodes: ['r', 'd1', 'd2', 'd3', 'u1', 'u2', 'prof', 'bundle', 'member',
      'side', 'cx', 'cy', 'iso'].map((id) => ({ id })),
    edges: [
      { from: 'r', to: 'd1', kind: 'dep' },
      { from: 'd1', to: 'd2', kind: 'peer' },
      { from: 'd2', to: 'd3', kind: 'peer-optional' },
      { from: 'd1', to: 'd3', kind: 'mount' },          // wrong kind for DOWN
      { from: 'u1', to: 'r', kind: 'dep' },
      { from: 'u2', to: 'u1', kind: 'peer' },
      { from: 'bundle', to: 'member', kind: 'mount' },
      { from: 'prof', to: 'bundle', kind: 'mount' },
      { from: 'side', to: 'iso', kind: 'dep' },
      { from: 'cx', to: 'cy', kind: 'peer' },
      { from: 'cy', to: 'cx', kind: 'peer' },
    ],
  }
}
function chainGraph() {
  return {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'iso' }],
    edges: [
      { from: 'a', to: 'b', kind: 'dep' },
      { from: 'b', to: 'c', kind: 'mount', unsatisfied: true },
      { from: 'c', to: 'd', kind: 'peer-optional' },
    ],
  }
}
const sortedIds = (s) => [...s].slice().sort()

// ---------- canonical pathSets: exported surface + V22b consumption guard ----------

test('V22-00 (V22b migrated) AtlasModel.pathSets is canonical: app consumed it, copy deleted, BFS semantics stand', () => {
  const M = loadModel()
  assert.equal(typeof M.pathSets, 'function', 'AtlasModel must export pathSets (canonical)')
  // Consumption half of the old cross-copy parity: the app now READS the export.
  const src = readFileSync(join(HERE, '..', 'web', 'app.js'), 'utf8')
  assert.match(src, /AtlasModel\.pathSets\(/, 'app.js consumes AtlasModel.pathSets')
  assert.doesNotMatch(src, /function pathSets\s*\(/, 'the V2.2a-era duplicate copy in app.js is gone')
  // Semantics half: the BFS the app relies on, expected explicitly against the model.
  const g = dirGraph()
  const s = M.pathSets(g, 'u2', null)
  assert.deepEqual(sortedIds(s.down), ['d1', 'd2', 'd3', 'r', 'u1'],
    'u2 →(peer) u1 →(dep) r →(dep) d1 →(peer) d2 →(peer-opt) d3, the d1→d3 mount stays a non-down kind')
  assert.deepEqual(sortedIds(s.downEdges),
    ['e:d1|d2|peer', 'e:d2|d3|peer-optional', 'e:r|d1|dep', 'e:u1|r|dep', 'e:u2|u1|peer'].sort(),
    'induced down edges = every traversed hop; the wrong-kind d1→d3 mount is NOT induced')
  assert.deepEqual(sortedIds(s.up), [], 'nothing points into u2')
  assert.deepEqual(sortedIds(s.upEdges), [], 'no up universe, no up edges')
  const d1 = M.pathSets(g, 'u2', 1)
  assert.deepEqual(sortedIds(d1.down), ['u1'], 'depth 1 cuts the walk…')
  assert.deepEqual(sortedIds(d1.downEdges), ['e:u2|u1|peer'], '…and the induced set with it')
})

test('V22-01 pathSets: down follows OUT dep/peer/peer-opt only; up climbs IN edges incl. mount; root in neither', () => {
  const M = loadModel()
  const s = M.pathSets(dirGraph(), 'r', null)
  assert.deepEqual(sortedIds(s.down), ['d1', 'd2', 'd3'], 'd3 over peer-optional; the d1→d3 mount edge never qualifies')
  assert.deepEqual(sortedIds(s.up), ['u1', 'u2'], 'up = reverse dep + reverse peer')
  assert.deepEqual(sortedIds(s.both), [], 'the two universes are disjoint here')
  assert.equal(s.down.has('r') || s.up.has('r'), false, 'the root is never a member of its own path')
  assert.equal(s.down.has('prof') || s.up.has('member'), false, 'a disconnected chain stays out entirely')
})

test('V22-02 pathSets: mount reverse climb + depth clamps (null unlimited, >3→3) cut nodes AND induced edges', () => {
  const M = loadModel()
  const g = dirGraph()
  const s = M.pathSets(g, 'member', null)
  assert.deepEqual(sortedIds(s.up), ['bundle', 'prof'], 'the mount chain auto-climbs to the profile')
  assert.deepEqual(sortedIds(s.down), [], 'mount points the other way: nothing hangs below a member')
  assert.deepEqual(sortedIds(s.upEdges), ['e:bundle|member|mount', 'e:prof|bundle|mount'], 'both mount hops induced')
  assert.deepEqual(sortedIds(M.pathSets(g, 'member', 1).up), ['bundle'], 'depth 1 stops at the bundle')
  assert.deepEqual(sortedIds(M.pathSets(g, 'r', 1).down), ['d1'])
  assert.deepEqual(sortedIds(M.pathSets(g, 'r', 2).downEdges), ['e:d1|d2|peer', 'e:r|d1|dep'], 'depth cuts the edge set too')
  assert.deepEqual(serSets(M.pathSets(g, 'r', 99)), serSets(M.pathSets(g, 'r', 3)), '99 clamps to 3')
})

test('V22-03 pathSets: cycles terminate (visited set) and land in both; unsatisfied edges are traversed', () => {
  const M = loadModel()
  const cyc = {
    nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    edges: [
      { from: 'A', to: 'B', kind: 'peer' }, { from: 'B', to: 'A', kind: 'peer' },
      { from: 'B', to: 'C', kind: 'dep' }, { from: 'C', to: 'A', kind: 'dep' },
    ],
  }
  const s = M.pathSets(cyc, 'A', null)
  assert.deepEqual(sortedIds(s.down), ['B', 'C'])
  assert.deepEqual(sortedIds(s.up), ['B', 'C'])
  assert.deepEqual(sortedIds(s.both), ['B', 'C'], 'every cycle member is both')
  assert.deepEqual(sortedIds(s.downEdges), sortedIds(s.upEdges), 'induced over both ∪ {root}')
  const ch = M.pathSets(chainGraph(), 'd', null)
  assert.deepEqual(sortedIds(ch.up), ['a', 'b', 'c'], 'the UNSATISFIED b→c mount flag is a note, not an absent edge')
  assert.deepEqual(sortedIds(ch.upEdges), ['e:a|b|dep', 'e:b|c|mount', 'e:c|d|peer-optional'])
})

test('V22-04 pathSets induced-edge rule: wrong-kind and leaving-set edges stay dark', () => {
  const M = loadModel()
  const g = {
    nodes: [{ id: 'r' }, { id: 'a' }, { id: 'b' }, { id: 'far' }],
    edges: [
      { from: 'r', to: 'a', kind: 'dep' },
      { from: 'r', to: 'b', kind: 'dep' },
      { from: 'a', to: 'b', kind: 'mount' },   // both endpoints down, WRONG kind
      { from: 'b', to: 'far', kind: 'dep' },   // far leaves the set at depth 1
      { from: 'far', to: 'r', kind: 'mount' }, // points INTO the root: an up edge
    ],
  }
  const s = M.pathSets(g, 'r', 1)
  assert.deepEqual(sortedIds(s.downEdges), ['e:r|a|dep', 'e:r|b|dep'])
  assert.deepEqual(sortedIds(s.upEdges), ['e:far|r|mount'], 'mount is an UP kind: far mounts r')
  assert.deepEqual(sortedIds(M.pathSets(g, 'r', 2).downEdges), ['e:b|far|dep', 'e:r|a|dep', 'e:r|b|dep'],
    'at depth 2 b→far joins; still no a→b mount edge')
})

test('V22-05 pathSets: defensive junk → empty sets, never a throw; zero mutation; deterministic insertion order', () => {
  const M = loadModel()
  for (const [label, g, root] of [
    ['no graph', null, 'x'], ['no edges', {}, 'x'],
    ['malformed edges', { edges: [null, {}, { from: 'x' }, { to: 'y' }] }, 'x'],
    ['unknown root', dirGraph(), 'nope'],
  ]) {
    const s = M.pathSets(g, root, null)
    for (const key of ['down', 'up', 'both', 'downEdges', 'upEdges']) {
      assert.deepEqual([...s[key]], [], `${label}: ${key} empty`)
    }
  }
  const frozen = deepFreeze(dirGraph())
  const a = M.pathSets(frozen, 'r', null)
  const b = M.pathSets(frozen, 'r', null)
  assert.equal(serSets(a), serSets(b), 'two calls serialize equal')
  assert.deepEqual([...a.down], [...b.down], 'Set ITERATION ORDER is insertion order, not hash order')
  const live = dirGraph()
  const before = JSON.stringify(live)
  M.pathSets(live, 'r', 2)
  assert.equal(JSON.stringify(live), before, 'a live (unfrozen) graph comes back byte-identical')
})

// ---------- view.granularity ----------

test('V22-06 granularity default/junk/absent is byte-identical to BASE across view combinations', () => {
  const M = loadModel()
  const graph = fixture()
  const combos = [
    {},
    EXPANDED(),
    { collapsedGroups: new Set(['bundle', 'llm']) },
    Object.assign(EXPANDED(), { collapsedCats: new Set(['llm']), showRealCross: true }),
    Object.assign(EXPANDED(), { filterCats: ['plugin'], filterProfile: 'web' }),
  ]
  for (const base of combos) {
    const s0 = JSON.stringify(M.buildView(graph, base))
    assert.equal(JSON.stringify(M.buildView(graph, Object.assign({}, base, { granularity: 'groups' }))), s0,
      'explicit groups === absent')
    assert.equal(JSON.stringify(M.buildView(graph, Object.assign({}, base, { granularity: 'nonsense' }))), s0,
      'junk granularity falls back to groups')
    assert.equal(JSON.stringify(M.buildView(graph, Object.assign({}, base, { granularity: 'groups', focus: null }))), s0,
      'focus:null === focus absent (meta carries NO focus key when focus was not requested)')
  }
})

test('V22-07 granularity packages overrides collapsedGroups byte-for-byte (the all-expanded build)', () => {
  const M = loadModel()
  const graph = fixture()
  const pk = M.buildView(graph, {
    collapsedCats: new Set(), filterCats: null, filterScope: 'all', edgeKinds: null,
    filterProfile: null, showRealCross: false, granularity: 'packages',
    collapsedGroups: new Set(['bundle', 'llm', 'profiles', 'nonexistent']), // ignored
  })
  const full = M.buildView(graph, EXPANDED())
  assert.equal(JSON.stringify(pk), JSON.stringify(full), 'packages view IS the all-expanded view, meta included')
  for (const e of nodeEls(pk).filter((x) => x.data.kind === 'group')) {
    assert.ok(!e.classes.includes('collapsed'), `${e.data.id} renders as container`)
  }
})

test('V22-08 collapsedCats (zone collapse) still bites at packages granularity', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), { collapsedCats: new Set(['llm']), collapsedGroups: new Set(), granularity: 'packages' })
  const m = elMap(res)
  assert.ok(m.has('cat:llm'), 'zone shell stays')
  assert.ok(!m.has('g:llm') && !m.has(P1) && !m.has(P2), 'collapsed zone renders no cards/members at any granularity')
  assert.ok(m.has(A1), 'a kernel member still renders')
})

// ---------- view.focus subgraph ----------

/** Focus subgraph invariant helper: well-formed + parent-safe + no aggregates. */
function assertFocusSet(res, label) {
  const ids = new Set()
  const seen = new Set()
  const nodeIdSet = new Set()
  for (const e of els(res)) {
    assert.ok(!ids.has(e.data.id), `${label}: duplicate id ${e.data.id}`)
    ids.add(e.data.id)
    assert.ok(e.classes.length > 0, `${label}: classes on ${e.data.id}`)
    if (e.group === 'nodes') nodeIdSet.add(e.data.id)
    assert.ok(!String(e.data.id).startsWith('agg:'), `${label}: focus view must never emit aggregates (${e.data.id})`)
  }
  for (const e of els(res)) {
    if (e.group === 'nodes') {
      assert.ok(Number.isFinite(e.data.x) && Number.isFinite(e.data.y), `${label}: finite x/y on ${e.data.id}`)
      if (e.data.parent != null) {
        assert.ok(ids.has(e.data.parent) && nodeIdSet.has(e.data.parent), `${label}: parent ${e.data.parent} of ${e.data.id} renders`)
        assert.ok(seen.has(e.data.parent), `${label}: parent ${e.data.parent} precedes ${e.data.id}`)
      }
    } else {
      assert.ok(ids.has(e.data.source) && ids.has(e.data.target), `${label}: edge ${e.data.id} endpoints render`)
      assert.notEqual(e.data.source, e.data.target, `${label}: no self-loop edges in focus view`)
    }
    seen.add(e.data.id)
  }
}

test('V22-09 focus root A1: member packages + ancestor containers (ctx) + induced real edges, aggregates never', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), Object.assign(EXPANDED(), { focus: { rootId: A1, depth: null } }))
  assertFocusSet(res, 'focus A1')
  const m = elMap(res)
  const member = A1 + '|' + P1 + '|' + P2 + '|' + A2 + '|' + B1 + '|' + WB

  // M = down{P1,P2} ∪ up{A2,WB,B1} ∪ {A1}; X1/U1/g:util/cat:plugin are NOT members
  assert.deepEqual(kindIds(res, 'zone'), ['cat:kernel', 'cat:tools', 'cat:llm', 'cat:profiles', 'cat:broken'],
    'zones in category order, member-free zones absent')
  assert.deepEqual(kindIds(res, 'group'), ['g:bundle', 'g:tools', 'g:llm', 'g:profiles', 'g:broken'])
  assert.deepEqual(
    plain(els(res).filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile').map((e) => e.data.id)),
    [A1, P1, P2, A2, B1, WB], 'members in graph.nodes order')
  assert.ok(!m.has(X1) && !m.has(U1) && !m.has('g:util') && !m.has('cat:plugin'),
    'non-members never render (nor do member-free zones)')

  // ctx rides ON TOP of the existing classes — zones AND group containers only
  for (const z of kindIds(res, 'zone')) {
    assert.deepEqual(plain(m.get(z).classes), ['zone', 'cat-' + z.slice(4), 'ctx'], `${z}: ctx appended`)
    assert.equal(m.get(z).data.kind, 'zone')
  }
  for (const g of kindIds(res, 'group')) {
    const base = m.get(g).classes
    assert.equal(base[0], 'group'); assert.ok(String(base[1]).startsWith('gk-'), 'existing classes kept')
    assert.deepEqual(plain(base.slice(2)), ['ctx'], `${g}: ctx appended after the existing classes`)
    assert.ok(!base.includes('collapsed'), 'containers render expanded')
    assert.equal(m.get(g).data.parent, 'cat:' + { 'g:bundle': 'kernel', 'g:tools': 'tools', 'g:llm': 'llm', 'g:profiles': 'profiles', 'g:broken': 'broken' }[g])
  }
  assert.ok(!m.get(A1).classes.includes('ctx'), 'packages do NOT carry ctx')
  assert.equal(m.get(A1).data.parent, 'g:bundle')
  assert.equal(m.get(WB).data.kind, 'profile', 'a profile member keeps its profile shape')

  // induced edges ONLY — over sets.downEdges∪upEdges ∩ survivors, graph.edges order:
  // e1 dep, e3 dep, e5 mount, e8 mount, e9 peer, e11 peer-optional.
  // e4 (P1 self-loop) is induced but dropped; e14/e15 mount between down members
  // and e10/e16 A2↔P2 sit in NEITHER set → dark (R37 semantics hold).
  assert.deepEqual(plain(edgeEls(res).map((e) => e.data.id)), [
    'e:' + A1 + '|' + P1 + '|dep', 'e:' + A2 + '|' + A1 + '|dep', 'e:' + WB + '|' + A1 + '|mount',
    'e:' + A1 + '|' + WB + '|mount', 'e:' + A1 + '|' + P2 + '|peer', 'e:' + B1 + '|' + A1 + '|peer-optional',
  ])
  for (const e of edgeEls(res)) {
    assert.deepEqual(plain(e.classes), ['e-' + e.data.kind, 'cross'], 'same shape as today\'s real cross edges')
  }
  assert.deepEqual(plain(res.meta), {
    zones: 5, groups: 5, pkgs: 5, profiles: 1, realEdges: 6, aggEdges: 0, edges: 6,
    focus: { rootId: A1, depth: null, members: 6, edges: 6 },
  })
  assert.ok(member, 'pin of the member set (documentation only)')
})

test('V22-10 focus depth re-cuts M and the induced set (root P1: depth 1 vs unlimited)', () => {
  const M = loadModel()
  const g = fixture()
  const one = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: P1, depth: 1 } }))
  const m1 = elMap(one)
  // up layer 1 = {A1,U1,X1}; down = {} (only the self dep); M = {P1,A1,U1,X1}
  assert.deepEqual(plain(els(one).filter((e) => e.data.kind === 'pkg').map((e) => e.data.id)), [A1, P1, U1, X1])
  assert.deepEqual(kindIds(one, 'group'), ['g:bundle', 'g:util', 'g:llm', 'g:plugin'])
  // e14 (A1→P1 mount) IS an up-kind edge with both endpoints in up∪{root} at depth 1;
  // e7 (X1→U1) too — induced edges span the whole lit side, not just root hops.
  assert.deepEqual(plain(edgeEls(one).map((e) => e.data.id)), [
    'e:' + A1 + '|' + P1 + '|dep', 'e:' + U1 + '|' + P1 + '|dep',
    'e:' + X1 + '|' + P1 + '|dep', 'e:' + X1 + '|' + U1 + '|dep', 'e:' + A1 + '|' + P1 + '|mount',
  ], 'the P1→P1 dep self-loop is induced but never rendered as an edge')
  assert.deepEqual(plain(one.meta.focus), { rootId: P1, depth: 1, members: 4, edges: 5 })

  const two = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: P1, depth: 2 } }))
  assert.deepEqual(plain(two.meta.focus), { rootId: P1, depth: 2, members: 7, edges: 10 },
    'depth 2 adds A2/WB/B1 via layer-2 up edges (e14 parallel edge counts once per key)')
})

test('V22-11 R39 filter applies to focus members: excluded-zone members drop out of M, induced edges re-cut', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), Object.assign(EXPANDED(), {
    filterCats: ['broken'], focus: { rootId: A1, depth: null },
  }))
  const m = elMap(res)
  assert.ok(!m.has(B1) && !m.has('g:broken') && !m.has('cat:broken'), 'B1 was a member — the zone exclusion evicts it')
  assert.ok(!edgeEls(res).some((e) => String(e.data.id).includes(B1)), 'e11 died with its endpoint')
  assert.ok(m.has(A1) && m.has(P1) && m.has(WB), 'surviving members stay rendered')
  assert.deepEqual(plain(res.meta.focus), { rootId: A1, depth: null, members: 5, edges: 5 })
})

test('V22-12 same-group members emit REAL induced edges — aggregates are never produced', () => {
  const M = loadModel()
  // one zone, one group: in any collapse state these pairs would only ever
  // appear as an aggregate (or a self-bucket); in focus mode they must be real.
  const nodes = ['r', 'd1', 'u1'].map((id) => node(id + '@1.0.0', id, 'package', 'official', 'g1', 'kernel', ['web']))
  const g = {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: 'k', en: 'k' }], profiles: [],
    groups: [{ id: 'g1', kind: 'official', category: 'kernel', packageCount: 3 }],
    nodes,
    edges: [
      { from: nodes[0].id, to: nodes[1].id, kind: 'dep' },
      { from: nodes[2].id, to: nodes[0].id, kind: 'mount' },
    ],
  }
  const res = M.buildView(g, { focus: { rootId: nodes[0].id, depth: null } }) // default-collapsed view
  assertFocusSet(res, 'same-group focus')
  const eids = plain(edgeEls(res).map((e) => e.data.id))
  assert.deepEqual(eids, [
    'e:' + nodes[0].id + '|' + nodes[1].id + '|dep',
    'e:' + nodes[2].id + '|' + nodes[0].id + '|mount',
  ], 'all three members share one group; both edges are real pathSets keys')
  assert.equal(edgeEls(res).every((e) => e.classes.includes('cross')), true)
  assert.deepEqual(plain(elMap(res).get('g:g1').classes), ['group', 'gk-official', 'ctx'])
})

test('V22-13 coordinate constancy under focus: member positions + w/h byte-equal the granularity:packages view', () => {
  const M = loadModel()
  const g = fixture()
  const focus = elMap(M.buildView(g, Object.assign(EXPANDED(), {
    collapsedCats: new Set(['llm']), collapsedGroups: new Set(['bundle']),
    focus: { rootId: A1, depth: null },
  })))
  const pk = elMap(M.buildView(g, Object.assign(EXPANDED(), { granularity: 'packages' })))
  let checked = 0
  for (const e of focus.values()) {
    if (e.group !== 'nodes') continue // edges carry no coordinates and legitimately differ
    assert.ok(pk.has(e.data.id), `focus element ${e.data.id} exists in the packages view (same layout universe)`)
    const q = pk.get(e.data.id)
    assert.deepEqual({ x: e.data.x, y: e.data.y, w: e.data.w, h: e.data.h },
      { x: q.data.x, y: q.data.y, w: q.data.w, h: q.data.h },
      `${e.data.id}: position/size must be byte-identical to the packages view`)
    checked++
  }
  assert.ok(checked >= 10, `focus view must have positioned elements (got ${checked})`)
})

test('V22-14 focus overrides collapsedGroups/collapsedCats for member containers (expanded slot sizes)', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {
    collapsedCats: new Set(['llm', 'kernel']),
    collapsedGroups: new Set(['bundle', 'llm', 'tools', 'profiles', 'broken']),
    focus: { rootId: A1, depth: null },
  })
  assertFocusSet(res, 'focus over collapse')
  const m = elMap(res)
  assert.ok(m.has(P1) && m.has(P2), 'members of a collapsed ZONE still render (focus overrides)')
  assert.equal(m.get('g:llm').data.w, 132)
  assert.equal(m.get('g:llm').data.h, 46, 'expanded slot size, never the 132×36 card')
  assert.ok(!m.get('g:llm').classes.includes('collapsed'))
  assert.ok(!m.get('cat:llm').classes.includes('collapsed'), 'zones never carried collapsed; membership wins over collapsedCats')
})

test('V22-15 focus fallback: unknown root / M emptied by filters ⇒ base-path view + meta.focus=null', () => {
  const M = loadModel()
  const g = fixture()
  const base = M.buildView(g, EXPANDED())
  const unknown = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'nope@9.9.9', depth: null } }))
  assert.equal(JSON.stringify(unknown.elements), JSON.stringify(base.elements), 'unknown root renders the base view')
  assert.deepEqual(plain(Object.assign({}, unknown.meta, { focus: undefined })),
    plain(Object.assign({}, base.meta, { focus: undefined })), 'every other meta field matches the base view')
  assert.equal(unknown.meta.focus, null, 'the requested-but-not-applied focus is recorded as null')

  const starved = M.buildView(g, Object.assign(EXPANDED(), {
    filterCats: ['kernel', 'tools', 'llm', 'profiles', 'broken'],
    focus: { rootId: A1, depth: null },
  }))
  assert.equal(JSON.stringify(starved.elements), JSON.stringify(M.buildView(g, Object.assign(EXPANDED(), {
    filterCats: ['kernel', 'tools', 'llm', 'profiles', 'broken'],
  })).elements), 'M empty after survival renders the base view of the same filter')
  assert.equal(starved.meta.focus, null)
})

test('V22-16 focus input defense: non-object / non-string rootId are treated as focus=null (byte-identical base)', () => {
  const M = loadModel()
  const g = fixture()
  const base = M.buildView(g, EXPANDED())
  const s0 = JSON.stringify(base)
  for (const junk of [42, 'a', true, [], { rootId: 42 }, { rootId: null }, {}, { rootId: {} }]) {
    const res = M.buildView(g, Object.assign(EXPANDED(), { focus: junk }))
    assert.equal(JSON.stringify(res), s0, `junk focus ${JSON.stringify(junk)} === base, byte-for-byte (no meta.focus key)`)
    assert.ok(!('focus' in plain(res.meta)), 'a focus that never parsed contributes no meta key at all')
  }
})

test('V22-17 focus mode ignores granularity/showRealCross; frozen graph+focus view builds twice, identical, unmoved', () => {
  const M = loadModel()
  const g1 = fixture()
  const g2 = deepFreeze(fixture())
  const view = (extra) => Object.assign({
    collapsedCats: new Set(['plugin']), collapsedGroups: new Set(['bundle']),
    filterCats: null, filterScope: 'all', edgeKinds: null, filterProfile: null,
    showRealCross: false, focus: { rootId: A1, depth: null },
  }, extra || {})
  const a = JSON.stringify(M.buildView(g1, view()))
  assert.equal(JSON.stringify(M.buildView(g1, view({ showRealCross: true }))), a, 'focus edges are unconditional real')
  assert.equal(JSON.stringify(M.buildView(g1, view({ granularity: 'packages' }))), a, 'granularity ignored in focus mode')
  const b = JSON.stringify(M.buildView(g2, view()))
  assert.equal(b, a, 'a deep-frozen graph + focus view builds identically (zero mutation, determinism)')
  const fv = { focus: { rootId: A1, depth: 2 } }
  deepFreeze(fv)
  const v2 = M.buildView(g2, Object.assign(EXPANDED(), fv))
  assert.equal(v2.meta.focus.members, 6, 'the frozen view object was readable, and nothing wrote back')
})

// V22b review handover: pin the induced-edge dedup (graph-model.js focus branch
// `fSeen` guard). Two BYTE-IDENTICAL (from,to,kind) lines must not produce the
// same element id twice — cytoscape's add() would otherwise drop/replace under
// undefined behaviour. (Test-file-only change; the model is untouched.)
test('V22-18 focus view dedupes fully-duplicate (from,to,kind) edge lines', () => {
  const M = loadModel()
  const R = 'r@1.0.0', D = 'd@1.0.0'
  const g = {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: 'k', en: 'k' }],
    profiles: [],
    groups: [{ id: 'g1', kind: 'official', category: 'kernel', packageCount: 2 }],
    nodes: [node(R, 'r', 'package', 'official', 'g1', 'kernel', []),
      node(D, 'd', 'package', 'official', 'g1', 'kernel', [])],
    edges: [
      { from: R, to: D, kind: 'dep' },
      { from: R, to: D, kind: 'dep' },   // byte-identical duplicate line
      { from: R, to: D, kind: 'peer' },  // same pair, different kind → a second, DISTINCT edge
    ],
  }
  const res = M.buildView(g, { focus: { rootId: R, depth: null } })
  assertFocusSet(res, 'duplicate edge lines') // already asserts id uniqueness
  assert.deepEqual(plain(edgeEls(res).map((e) => e.data.id)), [`e:${R}|${D}|dep`, `e:${R}|${D}|peer`],
    'exactly one element per DISTINCT (from,to,kind) — the dup collapses, the distinct kind survives')
  assert.equal(res.meta.focus.edges, 2, 'meta agrees with the emitted element count')
})
