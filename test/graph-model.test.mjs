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
