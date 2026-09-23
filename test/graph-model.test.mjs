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
  // V2.9a R58: the 4-column grid constant is replaced by the band width cap.
  assert.ok(Number.isFinite(L.BAND_W) && L.BAND_W > 0, 'BAND_W (zone-band flow width) must be positive')
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
  // no order bands violated: zones < groups (R43: the default build carries no
  // edges anymore — "edges last" is pinned by the focus and real-cross builds)
  const idx = (id) => ids(res).indexOf(id)
  assert.ok(idx('cat:broken') < idx('g:bundle'), 'zones precede groups')

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
  // R43 (V2.4a, user ruling): the group-level base view emits ZERO edges — the
  // aggregate emission this test used to pin (aggEdges 10) is retired on purpose;
  // the agg element shape + dominance live on in the g: focus branch (V24-05).
  assert.deepEqual(plain(res.meta), { zones: 6, groups: 7, pkgs: 0, profiles: 0, realEdges: 0, aggEdges: 0, edges: 0 })
  assert.deepEqual(plain(edgeEls(res)), [], 'no edges at all in the overview (R43)')
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
test('V4-05 rule 4 (R43-updated): collapsed endpoints — the base path now emits no edges at all', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  // R43 retired the group-level aggregate emission (user ruling). The endpoint
  // resolution the agg buckets used to make visible stays exercised by the g:
  // focus aggregates (V24-05: same bucketing/dominance code path, restricted
  // set) and by showRealCross real edges (V4-08). Here: zero edges, no agg: ids.
  assert.deepEqual(plain(edgeEls(res)), [], 'default build emits no edges (R43)')
  assert.equal(res.meta.aggEdges, 0)
  assert.equal(res.meta.edges, 0)
  // dangling endpoint still cannot leak anywhere near the render set
  assert.ok(!ids(res).some((id) => String(id).includes('ghost:missing')))
})

test('V4-06 rule 4 (R43-updated): base aggregate counts/dominance gone from the base path', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  // R43: the buckets this test enumerated (g:bundle→g:llm count 4 / mount-
  // dominance, g:tools→g:llm peer tie, g:broken→g:bundle) no longer emit in the
  // BASE path. The bucketing + dominantKind code they pinned is exercised, with
  // EQUAL strength (exact deepEqual shape incl. a dep>peer tie and a mount
  // up-side), by the g: focus agg comparison in V24-05 — intentional product
  // decision (user ruling R43), not a dropped invariant.
  assert.deepEqual(plain(edgeEls(res)), [], 'base emits no aggregates (R43)')
  const focused = M.buildView(fixture(), Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle' } }))
  const fm = elMap(focused)
  assert.ok(fm.has('agg:g:bundle|g:llm'), 'the same bucketing still runs inside the g: focus branch')
})

test('V4-07 rule 4 (R43-updated): zone-collapse keeps the shell; the pkg→zone-shell aggregates are retired', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), { collapsedCats: new Set(['llm']), collapsedGroups: new Set() })
  const m = elMap(res)
  // node-side behavior unchanged: zone shell with total member count, no cards, no members
  assert.equal(m.get('cat:llm').data.count, 2)
  assert.ok(!m.has('g:llm'))
  assert.ok(!m.has(P1), 'members of a collapsed zone are hidden')
  // R43: what used to resolve INTO the shell (agg:A1|cat:llm count 4 mount-
  // dominant, agg:U1|cat:llm) no longer emits — the base path drops every edge
  // that is not a packages-tier real cross edge. Intentional product decision.
  assert.deepEqual(plain(edgeEls(res)), [], 'no pkg→zone aggregates in the base path (R43)')
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
  // R43: the 11 pkg-level aggregate buckets this half pinned (e.g. agg:A1|P1
  // 'mixed kinds → ONE aggregate') are retired from the base path — without
  // showRealCross the base view simply has no edges. The REAL half above
  // (14 cross edges, exact meta) is UNTOUCHED by R43 and still pinned.
  assert.deepEqual(plain(ne.map((e) => e.data.id)), [], 'without showRealCross the base path emits nothing (R43)')
  assert.equal(noReal.meta.aggEdges, 0)
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

test('V4-10 edgeKinds prunes real edges BEFORE aggregation (R43: base path = prune then nothing to aggregate)', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {
    collapsedCats: new Set(), collapsedGroups: new Set(['bundle', 'llm', 'profiles']),
    filterCats: null, filterScope: 'all', edgeKinds: new Set(['mount']), filterProfile: null, showRealCross: false,
  })
  // R43: the mount-only agg buckets ('agg:g:bundle|g:llm' count 2 …) are gone —
  // the pruned edges now fall to nothing instead of to a bucket. The prune
  // itself is still enforced, which the packages-tier REAL half below pins.
  assert.deepEqual(plain(edgeEls(res)), [], 'edgeKinds mount-only ⇒ the mount aggregates are retired with the rest (R43)')
  const real = M.buildView(fixture(), Object.assign(EXPANDED(), { edgeKinds: new Set(['mount']), showRealCross: true }))
  assert.deepEqual(plain(edgeEls(real).map((e) => e.data.id)), [
    'e:' + WB + '|' + A1 + '|mount', 'e:' + A1 + '|' + WB + '|mount',
    'e:' + A1 + '|' + P1 + '|mount', 'e:' + A1 + '|' + P2 + '|mount',
  ], 'packages-tier REAL edges still honor the kind filter (e5/e8/e14/e15) — prune stays in front')
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
  // R43: the survivors-only AGGREGATE recount this pinned (agg:A1|P1 count 2,
  // dep-beats-mount tie after e10/e16 died with p2) has no base-path emission
  // anymore. The survivor rule itself stays pinned by the REAL build below:
  // every surviving edge references survivors; p2/b1-touched edges are gone.
  assert.deepEqual(plain(edgeEls(res)), [], 'no aggregates in the filtered base view (R43)')
  const real = M.buildView(fixture(), {
    collapsedCats: new Set(), collapsedGroups: new Set(), filterCats: null,
    filterScope: 'all', edgeKinds: null, filterProfile: 'web', showRealCross: true,
  })
  assert.deepEqual(plain(edgeEls(real).map((e) => e.data.kind)),
    ['dep', 'dep', 'dep', 'mount', 'dep', 'dep', 'mount', 'dep', 'mount'],
    'e1,e2,e3,e5,e6,e7,e8,e13,e14 — e9/e10/e15↔P2 and e11↔B1 edges died with their endpoints')
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
  // R43: the official-only aggregate recount (agg:A1|P1 count 2 — e1+e14 after
  // x1's edges pruned with x1) has no base emission. The scope prune itself is
  // pinned via the REAL build: x1-touched edges are gone, all others stay.
  const offReal = M.buildView(fixture(), Object.assign(EXPANDED(), { filterScope: 'official', showRealCross: true }))
  assert.deepEqual(plain(edgeEls(offReal).map((e) => e.data.id)), [
    'e:' + A1 + '|' + P1 + '|dep', 'e:' + U1 + '|' + P1 + '|dep', 'e:' + A2 + '|' + A1 + '|dep',
    'e:' + WB + '|' + A1 + '|mount', 'e:' + A1 + '|' + WB + '|mount', 'e:' + A1 + '|' + P2 + '|peer',
    'e:' + A2 + '|' + P2 + '|peer-optional', 'e:' + B1 + '|' + A1 + '|peer-optional', 'e:' + A2 + '|' + U1 + '|dep',
    'e:' + A1 + '|' + P1 + '|mount', 'e:' + A1 + '|' + P2 + '|mount', 'e:' + A2 + '|' + P2 + '|peer',
  ], '12 real edges (14 minus x1\'s e6/e7) — no agg:X1|* to begin with (R43)')

  const offCollapsed = M.buildView(fixture(), { filterScope: 'official' })
  assert.deepEqual(plain(edgeEls(offCollapsed)), [], 'the group-level official recount is retired with all base aggregates (R43)')
})

// =========================================================================
// Rule 8 — output order
// =========================================================================
test('V4-12 rule 8 (R43-updated): base edges are REAL-only in graph.edges order; agg ordering lives in g: focus', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), {})
  // R43: the default build carries no edges, so the 'aggregates sorted by
  // (source,target)' half of this rule moved — the identical sort now orders
  // the g: focus aggregates and is pinned there (V24-05 exact id order).
  assert.deepEqual(plain(edgeEls(res)), [], 'no edges in the default base build (R43)')

  const mixed = M.buildView(fixture(), Object.assign(EXPANDED(), { showRealCross: true }))
  const expectedRealOrder = ['dep', 'dep', 'dep', 'mount', 'dep', 'dep', 'mount', 'peer', 'peer-optional', 'peer-optional', 'dep', 'mount', 'mount', 'peer']
    // graph order minus e4 (self) and e12 (dangling)
  const gotReal = edgeEls(mixed).filter((e) => !e.data.id.startsWith('agg:'))
  assert.deepEqual(plain(gotReal.map((e) => e.data.kind)), expectedRealOrder)
  assert.equal(gotReal.length, edgeEls(mixed).length, 'base path emits real edges only (R43)')
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
// Task V2.9a (R58) — FLOWING ZONE BANDS. The ZONE_COLS equal-column grid is
// retired: zones now flow left→right in CATEGORY_ORDER packed by their ACTUAL
// w/h, wrapping at ZONE_LAYOUT.BAND_W, one band tall as the tallest zone in it.
// Every assertion here reads the zone rectangles the model REPORTS (data.w/h)
// and states the algebra the flow must satisfy — never a hardcoded coordinate
// table, so the pins survive any honest retune of the constants and die the
// moment the packing stops being tight.
// =========================================================================

/**
 * bandGraph(3) → three zones, two collapsed cards each, categories z0/z1/z2 in
 * that declared order (the model's zone order IS graph.categories order).
 * `cards`/`members` are per group, so widths and heights move independently:
 * cards drive the zone WIDTH, member counts drive its HEIGHT.
 */
function bandGraph(nZones, cards, members) {
  const categories = []
  const groups = []
  const nodes = []
  for (let z = 0; z < nZones; z++) {
    categories.push({ id: 'z' + z, zh: 'Z' + z, en: 'Z' + z })
    for (let c = 0; c < (Array.isArray(cards) ? cards[z] : cards); c++) {
      const gid = 'g' + z + '_' + c
      const m = Array.isArray(members) ? members[z] : members
      groups.push({ id: gid, kind: 'official', category: 'z' + z, packageCount: m })
      for (let k = 0; k < m; k++) nodes.push(node(`${gid}#${k}@1.0.0`, `${gid}p${k}`, 'package', 'official', gid, 'z' + z, ['web']))
    }
  }
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories, profiles: [], groups, nodes, edges: [],
  }
}

/** The rendered zone rectangles, in build order (CATEGORY_ORDER). */
function zoneRects(res) {
  return plain(nodeEls(res).filter((e) => e.data.kind === 'zone').map((e) => e.data))
}
/** Top-aligned flow ⇒ every zone of one band shares its top edge. */
const bandTopOf = (z) => z.y - z.h / 2
/** Zones grouped into bands by that shared top edge, top band first. */
function bandsOf(zones) {
  const byTop = new Map()
  for (const z of zones) {
    const k = String(bandTopOf(z))
    if (!byTop.has(k)) byTop.set(k, [])
    byTop.get(k).push(z)
  }
  return [...byTop.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, zs]) => zs.slice().sort((p, q) => p.x - q.x))
}

test('V29-00 R58 band flow: zones pack tight — next left edge = previous right edge + ZONE_GAP', () => {
  const M = loadModel()
  const L = M.ZONE_LAYOUT
  const zones = zoneRects(M.buildView(fixture(), {}))
  assert.ok(zones.length >= 4, 'the rich fixture must exercise several zones')
  const bands = bandsOf(zones)
  for (const band of bands) {
    assert.ok(band.length >= 2, 'this matrix needs a band with ≥2 zones to test adjacency')
    for (let i = 1; i < band.length; i++) {
      const prev = band[i - 1], cur = band[i]
      const gap = (cur.x - cur.w / 2) - (prev.x + prev.w / 2)
      assert.equal(gap, L.ZONE_GAP, `${cur.id} sits ${gap} after ${prev.id}, not ZONE_GAP=${L.ZONE_GAP} (a hole = the retired column grid)`)
    }
    const span = band[band.length - 1].x + band[band.length - 1].w / 2 - (band[0].x - band[0].w / 2)
    assert.ok(span <= L.BAND_W + 1e-9, `band span ${span} exceeds BAND_W ${L.BAND_W}`)
  }
})

test('V29-01 R58 band flow wraps at BAND_W — and each band is MAXIMAL (the wrapped zone could not have fit)', () => {
  const M = loadModel()
  const L = M.ZONE_LAYOUT
  // 10 equal zones (two cards each): wide enough that BAND_W forces a wrap,
  // narrow enough that the wrap lands away from any knife-edge multiple.
  const zones = zoneRects(M.buildView(bandGraph(10, 2, 1), {}))
  const bands = bandsOf(zones)
  assert.ok(bands.length >= 2, `BAND_W=${L.BAND_W} must wrap 10 two-card zones (got ${bands.length} band)`)
  assert.equal(bands.reduce((n, b) => n + b.length, 0), zones.length, 'every zone lands in exactly one band')
  for (let i = 0; i < bands.length; i++) {
    const band = bands[i]
    const span = band[band.length - 1].x + band[band.length - 1].w / 2 - (band[0].x - band[0].w / 2)
    const solo = band.length === 1 && band[0].w > L.BAND_W
    if (!solo) assert.ok(span <= L.BAND_W + 1e-9, `band ${i} spans ${span} > BAND_W ${L.BAND_W}`)
    const nxt = bands[i + 1] && bands[i + 1][0]
    if (!nxt) continue
    assert.ok(span + L.ZONE_GAP + nxt.w > L.BAND_W,
      `band ${i} stopped early: ${nxt.id} (w=${nxt.w}) still had room (span ${span}, BAND_W ${L.BAND_W}) — greedy flow must take it`)
  }
})

test('V29-02 R58 band height = tallest zone: next band top = band top + tallest + ZONE_GAP (top-aligned)', () => {
  const M = loadModel()
  const L = M.ZONE_LAYOUT
  // Mixed heights: zone 2 — NOT first in its band — grows tall through a
  // 9-member group, so the band advance must key on the tallest zone.
  const g = bandGraph(12, 2, 1)
  g.groups[4].packageCount = 9
  for (let k = 0; k < 9; k++) g.nodes.push(node('g2_0#big' + k + '@1.0.0', 'big' + k, 'package', 'official', 'g2_0', 'z2', ['web']))
  const zones = zoneRects(M.buildView(g, {}))
  const bands = bandsOf(zones)
  assert.ok(bands.length >= 2, 'fixture must wrap to test the band advance')
  const tallBand = bands.find((b) => b.some((z) => z.id === 'cat:z2'))
  assert.ok(tallBand.length > 1 && tallBand[0].id !== 'cat:z2',
    'the tall zone sits mid-band (first position would let the leading height pass by accident)')
  for (let i = 0; i < bands.length; i++) {
    const tops = new Set(bands[i].map((z) => bandTopOf(z)))
    assert.equal(tops.size, 1, `band ${i} zones share ONE top edge (got ${[...tops]}) — the flow tops-aligns, it never centers`)
    const tall = Math.max(...bands[i].map((z) => z.h))
    for (const z of bands[i]) assert.ok(z.h <= tall + 1e-9 && z.h > 0, `${z.id} height inside the band`)
    const next = bands[i + 1]
    if (!next) continue
    assert.equal(bandTopOf(next[0]) - bandTopOf(bands[i][0]), tall + L.ZONE_GAP,
      `band ${i + 1} must start one ZONE_GAP below band ${i}'s TALLEST zone (the tallest is ${tall}, not the first zone's ${bands[i][0].h})`)
  }
})

test('V29-03 R58 band boundaries: empty graph renders no zone; a single zone sits at (w/2, h/2)', () => {
  const M = loadModel()
  const empty = M.buildView({ schema: 1, categories: [], profiles: [], groups: [], nodes: [], edges: [] }, {})
  assert.deepEqual(plain(empty.elements), [], 'no zones, no flow, no crash')
  const one = zoneRects(M.buildView(bandGraph(1, 2, 1), {}))
  assert.equal(one.length, 1)
  assert.equal(one[0].x, one[0].w / 2, 'the flow starts at x=0 ⇒ the only zone centers at w/2')
  assert.equal(one[0].y, one[0].h / 2, 'and at y=0 ⇒ h/2 (the canvas origin is the flow origin)')
})

test('V29-04 R58 a zone wider than BAND_W still lands (first in its band) — never dropped, never loops', () => {
  const M = loadModel()
  const L = M.ZONE_LAYOUT
  const g = bandGraph(3, 2, 1)
  // 1100 members ⇒ ceil(sqrt)=34 cols ⇒ gridW 34*46+33*12 = 1960 ⇒ zone w 2016 > BAND_W
  g.groups[0].packageCount = 1100
  for (let k = 0; k < 1100; k++) g.nodes.push(node('wide' + k + '@1.0.0', 'w' + k, 'package', 'official', 'g0_0', 'z0', ['web']))
  const zones = zoneRects(M.buildView(g, {}))
  assert.equal(zones.length, 3, 'the oversized zone renders like any other')
  const wide = zones.find((z) => z.id === 'cat:z0')
  assert.ok(wide.w > L.BAND_W, `fixture must produce a zone wider than BAND_W (got ${wide.w})`)
  assert.equal(wide.x, wide.w / 2, 'it takes the head of its band at x=0 (greedy flow never leaves it unplaced)')
  const bands = bandsOf(zones)
  assert.equal(bands[0].length, 1, 'nothing squeezes in beside it — the rest start a fresh band')
  assertFiniteAll(M.buildView(g, {}), 'oversized zone')
})

test('V29-05 R58 the band flow is deterministic and view-independent (double build byte-equal)', () => {
  const M = loadModel()
  const g1 = bandGraph(7, 2, 1)
  const g2 = bandGraph(7, 2, 1)
  const a = JSON.stringify(M.buildView(g1, {}))
  const b = JSON.stringify(M.buildView(g2, {}))
  assert.equal(a, b, 'two builds over equal inputs must be byte-identical')
  assert.deepEqual(zoneRects(M.buildView(g1, EXPANDED())), zoneRects(M.buildView(g1, {})),
    'the band flow reads EXPANDED slot dims only — expanding groups changes WHICH elements render, never a zone rect')
  const c = zoneRects(M.buildView(g1, {}))
  const d = zoneRects(M.buildView(g1, { filterCats: ['z3'] }))
  const dm = new Map(d.map((z) => [z.id, z]))
  for (const z of c) {
    if (!dm.has(z.id)) continue
    assert.deepEqual(dm.get(z.id), z, `${z.id} zone rect moved when a NEIGHBOURING zone was filtered out (the flow must not re-pack on filters)`)
  }
})

test('V29-06 R58 no ZONE_COLS consumer survives anywhere in the shipped code or the suite', () => {
  const L = loadModel().ZONE_LAYOUT
  assert.ok(!('ZONE_COLS' in L), 'ZONE_COLS is retired from ZONE_LAYOUT (the column grid is gone, not merely unused)')
  for (const rel of ['../web/graph-model.js', '../web/app.js', '../web/index.html', '../web/style.css', '../lib/scan.js', '../lib/index.js', '../lib/http.js']) {
    assert.ok(!/ZONE_COLS/.test(readFileSync(join(HERE, rel), 'utf8')), `${rel} still mentions ZONE_COLS`)
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
    // V2.4a adds rootKind to meta.focus (brief §2) — the only intended shape change on the pkg path.
    focus: { rootKind: 'package', rootId: A1, depth: null, members: 6, edges: 6 },
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
  assert.deepEqual(plain(one.meta.focus), { rootKind: 'package', rootId: P1, depth: 1, members: 4, edges: 5 })

  const two = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: P1, depth: 2 } }))
  assert.deepEqual(plain(two.meta.focus), { rootKind: 'package', rootId: P1, depth: 2, members: 7, edges: 10 },
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
  assert.deepEqual(plain(res.meta.focus), { rootKind: 'package', rootId: A1, depth: null, members: 5, edges: 5 })
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

// =========================================================================
// Task V2.4a — R42 group focus (groupFocusSets + focus g: root) and R43
// base aggregate-edge retirement.
// =========================================================================

/** A groupFocusSets container is only comparable across realms through its Sets. */
function serGSets(s) {
  return JSON.stringify({
    rootGid: s.rootGid,
    down: [...s.down], up: [...s.up], both: [...s.both],
    pkgsDown: [...s.pkgsDown], pkgsUp: [...s.pkgsUp], pkgsBoth: [...s.pkgsBoth],
    downEdges: [...s.downEdges], upEdges: [...s.upEdges], rootPkgs: [...s.rootPkgs],
  })
}

/** One zone, groups gA (root members r1,r2), gB (x), gC (y), gD (z). R42 matrix fixture. */
function bothGraph() {
  const n = (id, group) => node(id + '@1.0.0', id, 'package', 'official', group, 'kernel', ['web'])
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: 'k', en: 'k' }], profiles: [],
    groups: ['gA', 'gB', 'gC', 'gD'].map((id) => ({ id, kind: 'official', category: 'kernel', packageCount: 1 })),
    nodes: [n('r1', 'gA'), n('r2', 'gA'), n('x', 'gB'), n('y', 'gC'), n('z', 'gD')],
    edges: [
      { from: 'r1@1.0.0', to: 'x@1.0.0', kind: 'dep' },            // DOWN: x∈gB lit down
      { from: 'x@1.0.0', to: 'r1@1.0.0', kind: 'dep' },            // UP:   x also up → x and gB land in both
      { from: 'r2@1.0.0', to: 'y@1.0.0', kind: 'peer-optional' },  // DOWN: y∈gC
      { from: 'z@1.0.0', to: 'r1@1.0.0', kind: 'mount' },          // UP:   mount climbs (gD)
      { from: 'r1@1.0.0', to: 'r2@1.0.0', kind: 'dep' },           // internal — excluded from the neighborhood
      { from: 'r2@1.0.0', to: 'r1@1.0.0', kind: 'dep' },           // internal, reverse
      { from: 'r2@1.0.0', to: 'r2@1.0.0', kind: 'dep' },           // internal self-loop
      { from: 'r2@1.0.0', to: 'x@1.0.0', kind: 'mount' },          // mount-OUT of the root: R37-style, never DOWN
      { from: 'r1@1.0.0', to: 'ghost@9.9.9', kind: 'dep' },        // dangling endpoint: skipped
    ],
  }
}

test('V24-00 export surface: groupFocusSets joins the frozen AtlasModel surface', () => {
  const M = loadModel()
  assert.equal(typeof M.groupFocusSets, 'function', 'AtlasModel.groupFocusSets must be exported')
  assert.deepEqual(Object.keys(M).sort(), ['ZONE_LAYOUT', 'buildView', 'groupFocusSets', 'pathSets'],
    'the frozen surface is exactly {buildView, pathSets, groupFocusSets, ZONE_LAYOUT}')
  const s = M.groupFocusSets(fixture(), 'bundle')
  assert.deepEqual(Object.keys(s).sort(),
    ['both', 'down', 'downEdges', 'pkgsBoth', 'pkgsDown', 'pkgsUp', 'rootGid', 'rootPkgs', 'up', 'upEdges'],
    'container field names (applyClasses reuse contract)')
})

test('V24-01 groupFocusSets directions: OUT dep/peer/peer-opt vs IN +mount; mount-OUT stays out; keys as pathSets', () => {
  const M = loadModel()
  const s = M.groupFocusSets(fixture(), 'bundle') // rootPkgs = {A1}
  assert.equal(s.rootGid, 'bundle')
  assert.deepEqual([...s.rootPkgs], [A1], 'one member, group bundle')
  // DOWN (OUT, dep/peer/peer-opt): e1 A1→P1 dep, e9 A1→P2 peer. Mount-outs e8 (A1→WB),
  // e14 (A1→P1), e15 (A1→P2) are NOT down kinds (R37 lineage) — WB is not a down neighbor at all.
  assert.deepEqual([...s.down], ['llm'])
  assert.deepEqual([...s.pkgsDown], [P1, P2])
  assert.deepEqual([...s.downEdges], ['e:' + A1 + '|' + P1 + '|dep', 'e:' + A1 + '|' + P2 + '|peer'],
    'insertion order = graph.edges order; key = e:from|to|kind, the pathSets key form')
  // UP (IN, +mount): e3 A2→A1 dep, e5 WB→A1 mount (the profile climb), e11 B1→A1 peer-optional.
  assert.deepEqual([...s.up], ['tools', 'profiles', 'broken'], 'group tier updated by the same edge batch')
  assert.deepEqual([...s.pkgsUp], [A2, WB, B1])
  assert.deepEqual([...s.upEdges], ['e:' + A2 + '|' + A1 + '|dep', 'e:' + WB + '|' + A1 + '|mount', 'e:' + B1 + '|' + A1 + '|peer-optional'])
  assert.equal(s.down.has('bundle') || s.up.has('bundle') || s.pkgsDown.has(A1), false, 'the root group is never its own neighbor')
  assert.equal(s.down.has('plugin') || s.pkgsUp.has(X1), false, 'edges not touching a root member stay out entirely')
})

test('V24-02 groupFocusSets root members are ANY kind; both = intersection, subtracted from both tiers', () => {
  const M = loadModel()
  const anyKind = M.groupFocusSets(fixture(), 'profiles') // rootPkgs = the profile node WB
  assert.deepEqual([...anyKind.rootPkgs], [WB], 'a profile-kind group still has root members (any kind, R42)')
  assert.deepEqual([...anyKind.up], ['bundle'], 'e8 A1→WB mount is an IN mount')
  assert.deepEqual([...anyKind.down], [], 'WB→A1 mount is mount-OUT: not a DOWN kind')

  const s = M.groupFocusSets(bothGraph(), 'gA')
  assert.deepEqual([...s.rootPkgs], ['r1@1.0.0', 'r2@1.0.0'])
  assert.deepEqual([...s.pkgsBoth], ['x@1.0.0'], 'x dep-out AND dep-in → both')
  assert.deepEqual([...s.pkgsDown], ['y@1.0.0'], 'subtracted from pkgsDown')
  assert.deepEqual([...s.pkgsUp], ['z@1.0.0'], 'subtracted from pkgsUp')
  assert.deepEqual([...s.both], ['gB'], 'group tier: gB is both')
  assert.deepEqual([...s.down], ['gC'], 'gB subtracted from down (parallel tier)')
  assert.deepEqual([...s.up], ['gD'], 'gB subtracted from up')
  // the edge sets keep BOTH sides of a mutual pair (kind/direction is a per-edge fact)
  assert.deepEqual([...s.downEdges], ['e:r1@1.0.0|x@1.0.0|dep', 'e:r2@1.0.0|y@1.0.0|peer-optional'])
  assert.deepEqual([...s.upEdges], ['e:x@1.0.0|r1@1.0.0|dep', 'e:z@1.0.0|r1@1.0.0|mount'])
})

test('V24-03 groupFocusSets same-group exclusion + defensive junk + zero mutation', () => {
  const M = loadModel()
  const s = M.groupFocusSets(bothGraph(), 'gA')
  for (const set of [s.downEdges, s.upEdges]) {
    assert.equal([...set].some((k) => /\|r[12]@1\.0\.0\|/.test(k) && /^e:r[12]@1\.0\.0\|/.test(k)), false,
      'r1↔r2 internal edges (both endpoints in gA) never enter the neighborhood, in either direction')
  }
  assert.equal([...s.rootPkgs].every((p) => p.startsWith('r')), true, 'root members still collected')
  assert.equal([...s.pkgsDown].includes('ghost@9.9.9') || [...s.downEdges].some((k) => k.includes('ghost')), false,
    'a dangling endpoint has no group — the edge is skipped, container stays internally consistent')
  for (const [label, g, gid, wantRoot] of [
    ['no graph', null, 'x', []], ['no nodes', {}, 'x', []],
    ['malformed edges', { nodes: [{ id: 'p', group: 'g' }], edges: [null, {}, { from: 'p' }, { to: 'p' }] }, 'g', ['p']],
    ['unknown gid', fixture(), 'nope', []], ['empty gid', fixture(), '', []],
  ]) {
    const j = M.groupFocusSets(g, gid)
    assert.equal(j.rootGid, String(gid), `${label}: rootGid is still set`)
    assert.deepEqual([...j.rootPkgs], wantRoot, `${label}: rootPkgs (the member node survives every malformed edge line)`)
    for (const key of ['down', 'up', 'both', 'pkgsDown', 'pkgsUp', 'pkgsBoth', 'downEdges', 'upEdges']) {
      assert.deepEqual([...j[key]], [], `${label}: ${key} empty`)
    }
  }
  const frozen = deepFreeze(bothGraph())
  const a = M.groupFocusSets(frozen, 'gA')
  const b = M.groupFocusSets(frozen, 'gA')
  assert.equal(serGSets(a), serGSets(b), 'two calls over a deep-frozen graph serialize equal')
  const live = bothGraph()
  const before = JSON.stringify(live)
  M.groupFocusSets(live, 'gA')
  assert.equal(JSON.stringify(live), before, 'a live graph comes back byte-identical')
})

test('V24-04 groupFocusSets determinism: Set insertion order + shuffled graph, same membership', () => {
  const M = loadModel()
  const g = fixture()
  const base = M.groupFocusSets(g, 'bundle')
  const again = M.groupFocusSets(g, 'bundle')
  assert.deepEqual([...base.downEdges], [...again.downEdges], 'repeat call: identical iteration order')
  const shuffled = { nodes: g.nodes.slice().reverse(), edges: g.edges.slice().reverse() }
  const sh = M.groupFocusSets(shuffled, 'bundle')
  for (const key of ['down', 'up', 'both', 'pkgsDown', 'pkgsUp', 'pkgsBoth', 'downEdges', 'upEdges', 'rootPkgs']) {
    assert.deepEqual([...sh[key]].sort(), [...base[key]].sort(), `${key}: membership is order-free`)
  }
})

/** g:-focus structural invariant (group mode MAY carry agg edges — unlike pkg focus). */
function assertGroupFocus(res, label) {
  const ids = new Set()
  const seen = new Set()
  for (const e of els(res)) {
    assert.ok(!ids.has(e.data.id), `${label}: duplicate id ${e.data.id}`)
    ids.add(e.data.id)
    assert.ok(e.classes.length > 0, `${label}: classes on ${e.data.id}`)
  }
  for (const e of els(res)) {
    if (e.group === 'nodes') {
      assert.ok(Number.isFinite(e.data.x) && Number.isFinite(e.data.y), `${label}: finite x/y on ${e.data.id}`)
      if (e.data.parent != null) {
        assert.ok(ids.has(e.data.parent), `${label}: parent ${e.data.parent} of ${e.data.id} renders`)
        assert.ok(seen.has(e.data.parent), `${label}: parent ${e.data.parent} precedes ${e.data.id}`)
      }
    } else {
      assert.ok(ids.has(e.data.source) && ids.has(e.data.target), `${label}: edge ${e.data.id} endpoints render`)
      assert.notEqual(e.data.source, e.data.target, `${label}: no self-loop edges`)
      assert.ok(String(e.data.source).slice(2) === 'bundle' || String(e.data.target).slice(2) === 'bundle',
        `${label}: ${e.data.id} is not root-incident`)
    }
    seen.add(e.data.id)
  }
}

test('V24-05 focus g:bundle groups mode: root + neighbor cards (no ctx), ctx zones, ONLY root-incident agg edges', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle' } }))
  assertGroupFocus(res, 'g:bundle groups')
  const m = elMap(res)

  assert.deepEqual(kindIds(res, 'zone'), ['cat:kernel', 'cat:tools', 'cat:llm', 'cat:profiles', 'cat:broken'],
    'zones in category order; member-free zones absent')
  assert.deepEqual(kindIds(res, 'group'), ['g:bundle', 'g:tools', 'g:llm', 'g:profiles', 'g:broken'])
  assert.deepEqual(kindIds(res, 'pkg'), [], 'groups mode renders cards only, never members')

  // ctx rides on ZONES only: the focus card is the subject, neighbor cards carry no ctx (brief §2)
  for (const z of kindIds(res, 'zone')) {
    assert.deepEqual(plain(m.get(z).classes), ['zone', 'cat-' + z.slice(4), 'ctx'], `${z}: ctx appended`)
  }
  assert.equal(m.get('cat:kernel').data.count, 1, 'zone count = survivors of its rendered groups')
  for (const gid of ['bundle', 'tools', 'llm', 'profiles', 'broken']) {
    assert.ok(!m.get('g:' + gid).classes.includes('ctx'), `g:${gid}: no ctx in groups mode`)
    assert.ok(m.get('g:' + gid).classes.includes('collapsed'), `g:${gid}: group card`)
    assert.equal(m.get('g:' + gid).data.w, M.ZONE_LAYOUT.CARD_W)
    assert.equal(m.get('g:' + gid).data.h, M.ZONE_LAYOUT.CARD_H)
  }
  assert.equal(m.get('g:llm').data.count, 2, 'card count = the whole group\'s surviving members')
  assert.equal(m.get('g:bundle').data.parent, 'cat:kernel')

  // Agg edges — root-incident pairs only, sorted (s,d), and the OLD base agg shape verbatim:
  // down side agg:G|H, up side agg:H|G. e1+e9 bucket onto g:bundle→g:llm (count 2, dep>peer tie).
  assert.deepEqual(plain(edgeEls(res).map((e) => e.data.id)), [
    'agg:g:broken|g:bundle', 'agg:g:bundle|g:llm', 'agg:g:profiles|g:bundle', 'agg:g:tools|g:bundle',
  ])
  assert.deepEqual(plain(m.get('agg:g:bundle|g:llm')), {
    group: 'edges',
    data: { id: 'agg:g:bundle|g:llm', source: 'g:bundle', target: 'g:llm', count: 2, kind: 'dep' },
    classes: ['e-agg', 'e-dep'],
  }, 'aggregate shape compared to base pre-R43 emission (id/source/target/count/kind + e-agg/e-kind, NO cross)')
  assert.equal(m.get('agg:g:profiles|g:bundle').data.kind, 'mount', 'mount is an UP kind: profiles→bundle lights')
  assert.ok(!m.has('agg:g:bundle|g:profiles'), 'mount-OUT (e8 A1→WB) never produces a down-side agg (R37 lineage)')
  assert.ok(!m.has('agg:g:tools|g:llm'), 'neighbor↔neighbor pairs are NEVER aggregated here (e2 lives in no set)')

  assert.deepEqual(plain(res.meta), {
    zones: 5, groups: 5, pkgs: 0, profiles: 0, realEdges: 0, aggEdges: 4, edges: 4,
    focus: { rootKind: 'group', rootId: 'g:bundle', depth: 1, members: 5, edges: 4 },
  }, 'meta.focus group-mode shape: depth is FIXED 1, members = rendered group cards')
})

test('V24-06 focus g:bundle packages mode: members in place, G frame no-ctx, neighbor frames ctx, root-incident real edges only', () => {
  const M = loadModel()
  const res = M.buildView(fixture(), Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle', packages: true } }))
  assertFocusSet(res, 'g:bundle packages') // no agg: allowed here — real induced edges only
  const m = elMap(res)

  assert.deepEqual(kindIds(res, 'zone'), ['cat:kernel', 'cat:tools', 'cat:llm', 'cat:profiles', 'cat:broken'])
  assert.deepEqual(kindIds(res, 'group'), ['g:bundle', 'g:tools', 'g:llm', 'g:profiles', 'g:broken'])
  assert.deepEqual(
    plain(els(res).filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile').map((e) => e.data.id)),
    [A1, P1, P2, A2, B1, WB], 'rootPkgs ∪ pkgsDown ∪ pkgsUp ∪ pkgsBoth in graph.nodes order')

  assert.deepEqual(plain(m.get('g:bundle').classes), ['group', 'gk-official'], 'the root frame never carries ctx')
  assert.ok(!m.get('g:bundle').classes.includes('collapsed'), 'frames render at expanded slot size')
  for (const gid of ['tools', 'llm', 'profiles', 'broken']) {
    assert.deepEqual(plain(m.get('g:' + gid).classes.slice(-1)), ['ctx'], `neighbor frame g:${gid} carries ctx`)
  }
  for (const z of kindIds(res, 'zone')) {
    assert.deepEqual(plain(m.get(z).classes), ['zone', 'cat-' + z.slice(4), 'ctx'])
  }
  assert.equal(m.get('g:llm').data.h, 46, 'expanded slot dims (never the 36 card) — slot layout reused')

  // downEdges ∪ upEdges ∩ both-endpoints-alive, AND (from∈rootPkgs ∨ to∈rootPkgs):
  // e1, e3, e5, e9, e11. e8 (mount-out) is in NO set; e14/e15 (mount A1→P1/P2) are in no set;
  // e10/e16 (A2↔P2) are member↔member but touch no root member → dark.
  assert.deepEqual(plain(edgeEls(res).map((e) => e.data.id)), [
    'e:' + A1 + '|' + P1 + '|dep', 'e:' + A2 + '|' + A1 + '|dep', 'e:' + WB + '|' + A1 + '|mount',
    'e:' + A1 + '|' + P2 + '|peer', 'e:' + B1 + '|' + A1 + '|peer-optional',
  ])
  for (const e of edgeEls(res)) {
    assert.deepEqual(plain(e.classes), ['e-' + e.data.kind, 'cross'], 'real cross shape, same as pkg focus')
  }
  assert.deepEqual(plain(res.meta), {
    zones: 5, groups: 5, pkgs: 5, profiles: 1, realEdges: 5, aggEdges: 0, edges: 5,
    focus: { rootKind: 'group', rootId: 'g:bundle', depth: 1, members: 6, edges: 5 },
  }, 'packages mode members = rendered member nodes (profiles included)')
})

test('V24-07 coordinate constancy under group focus (both modes) + frozen graph + depth ignored', () => {
  const M = loadModel()
  const g = fixture()
  const pk = elMap(M.buildView(g, Object.assign(EXPANDED(), { granularity: 'packages' })))
  for (const extra of [{}, { packages: true }]) {
    const focus = elMap(M.buildView(g, Object.assign(EXPANDED(), { focus: Object.assign({ rootId: 'g:bundle' }, extra) })))
    let checked = 0
    for (const e of focus.values()) {
      if (e.group !== 'nodes') continue
      assert.ok(pk.has(e.data.id), `focus element ${e.data.id} exists in the packages view`)
      assert.equal(pk.get(e.data.id).data.x, e.data.x, `${e.data.id}.x must be identical to the packages view`)
      assert.equal(pk.get(e.data.id).data.y, e.data.y, `${e.data.id}.y must be identical to the packages view`)
      checked++
    }
    assert.ok(checked >= 8, `${JSON.stringify(extra)}: positioned elements compared (${checked})`)
  }
  // depth is FIXED at 1 for group focus (R42): a depth request changes nothing, meta reports 1
  const deep = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle', depth: 3 } }))
  assert.equal(JSON.stringify(deep), JSON.stringify(M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle' } }))),
    'depth is inert for g: roots')
  assert.equal(deep.meta.focus.depth, 1)
  // frozen determinism battery, both modes (V22-17 lineage extended)
  const frozen = deepFreeze(fixture())
  for (const focus of [{ rootId: 'g:bundle' }, { rootId: 'g:bundle', packages: true }]) {
    const view = Object.assign(EXPANDED(), { focus })
    deepFreeze(view)
    const a = JSON.stringify(M.buildView(frozen, view))
    assert.equal(JSON.stringify(M.buildView(frozen, view)), a, 'frozen graph + ' + JSON.stringify(focus) + ' builds twice, identical')
  }
})

test('V24-08 group focus filters (R39): neighbor eviction + edge re-cut; root-zone exclusion falls back', () => {
  const M = loadModel()
  const g = fixture()

  const grp = M.buildView(g, Object.assign(EXPANDED(), { filterCats: ['llm'], focus: { rootId: 'g:bundle' } }))
  const gm = elMap(grp)
  assert.ok(!gm.has('g:llm') && !gm.has('agg:g:bundle|g:llm'), 'the all-dead neighbor group and its agg edge are gone')
  assert.ok(gm.has('g:tools') && gm.has('g:profiles'), 'unaffected neighbors stay')
  assert.deepEqual(plain(grp.meta.focus), { rootKind: 'group', rootId: 'g:bundle', depth: 1, members: 4, edges: 3 })

  const pkg = M.buildView(g, Object.assign(EXPANDED(), { filterCats: ['llm'], focus: { rootId: 'g:bundle', packages: true } }))
  const pm = elMap(pkg)
  assert.ok(!pm.has(P1) && !pm.has(P2) && !pm.has('g:llm'), 'dead members and their frame drop out')
  assert.ok(pm.has(A1) && pm.has(A2) && pm.has(WB) && pm.has(B1))
  assert.deepEqual(plain(edgeEls(pkg).map((e) => e.data.id)), [
    'e:' + A2 + '|' + A1 + '|dep', 'e:' + WB + '|' + A1 + '|mount', 'e:' + B1 + '|' + A1 + '|peer-optional',
  ], 'edges re-cut over survivors: e1/e9 died with their endpoints')
  assert.deepEqual(plain(pkg.meta.focus), { rootKind: 'group', rootId: 'g:bundle', depth: 1, members: 4, edges: 3 })

  // root group filtered out ⇒ fall back to base + meta.focus=null (three-state rule preserved)
  for (const overrides of [{ filterCats: ['kernel'] }, { filterScope: 'third-party' }]) {
    const starved = M.buildView(g, Object.assign(EXPANDED(), Object.assign({}, overrides, { focus: { rootId: 'g:bundle' } })))
    assert.equal(JSON.stringify(starved.elements),
      JSON.stringify(M.buildView(g, Object.assign(EXPANDED(), overrides)).elements),
      JSON.stringify(overrides) + ': root-group starvation renders the base view')
    assert.equal(starved.meta.focus, null, 'requested-but-not-applied focus records null')
  }
})

test('V24-09 g: fallback + three-state meta.focus: illegal gid ⇒ base byte-identical + null; absent ⇒ NO key', () => {
  const M = loadModel()
  const g = fixture()
  const base = M.buildView(g, EXPANDED())
  for (const bad of ['g:nope', 'g:', 'g:ghost']) {
    const res = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: bad } }))
    assert.equal(JSON.stringify(res.elements), JSON.stringify(base.elements), `${bad}: base path renders`)
    assert.equal(res.meta.focus, null, `${bad}: null records the request that did not apply`)
  }
  const noFocus = M.buildView(g, EXPANDED())
  assert.ok(!('focus' in plain(noFocus.meta)), 'no focus requested → no focus key at all')
})

test('V24-10 meta.focus rootKind on the package path; packages flag is inert there', () => {
  const M = loadModel()
  const g = fixture()
  const plainFocus = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: A1, depth: null } }))
  assert.equal(plainFocus.meta.focus.rootKind, 'package', 'pkg root gains rootKind:"package" (the one intended meta.focus change)')
  const flagged = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: A1, depth: null, packages: true } }))
  assert.equal(JSON.stringify(flagged), JSON.stringify(plainFocus), 'packages is meaningful only for g: roots')
})

test('V24-11 R43 base aggregate edges retired: overview/expanded emit ZERO edges; real cross paths untouched; focus unaffected', () => {
  const M = loadModel()
  const g = fixture()
  for (const [label, view] of [
    ['default all-collapsed', {}],
    ['expanded (groups granularity)', EXPANDED()],
    ['zone-collapsed', { collapsedCats: new Set(['llm']), collapsedGroups: new Set() }],
    ['edgeKinds subset', Object.assign(EXPANDED(), { edgeKinds: new Set(['mount']) })],
    ['packages granularity, showRealCross off', Object.assign(EXPANDED(), { granularity: 'packages' })],
  ]) {
    const res = M.buildView(g, view)
    assert.deepEqual(plain(edgeEls(res)), [], `${label}: base emits no edges at all (R43)`)
    assert.equal(res.meta.aggEdges, 0, `${label}: meta.aggEdges is 0`)
    assert.equal(res.meta.edges, res.meta.realEdges, `${label}: edges = real only`)
  }
  const real = M.buildView(g, Object.assign(EXPANDED(), { showRealCross: true }))
  assert.equal(edgeEls(real).length, 14, 'packages-tier REAL/cross edges UNTOUCHED (e4 self + e12 dangling drop as before)')
  assert.ok(edgeEls(real).every((e) => !String(e.data.id).startsWith('agg:')))
  assert.equal(real.meta.edges, 14)
  const pkgFocus = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: A1 } }))
  assert.equal(edgeEls(pkgFocus).length, 6, 'package-root focus induction untouched by R43')
  const grpFocus = M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:bundle' } }))
  assert.ok(edgeEls(grpFocus).length > 0 && edgeEls(grpFocus).every((e) => String(e.data.id).startsWith('agg:')),
    'g: groups focus still emits its root-incident aggregates (R43 retires BASE emission only)')
})

test('V24-12 two-mode render sets are distinct by design (groups cards vs members in place)', () => {
  const M = loadModel()
  const g = fixture()
  const gm = new Set(ids(M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:llm' } }))))
  const pm = new Set(ids(M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:llm', packages: true } }))))
  assert.ok(gm.has('g:llm') && !gm.has(P1), 'groups mode: cards only')
  assert.ok(pm.has('g:llm') && pm.has(P1) && pm.has(P2), 'packages mode: the members render in place')
  assert.ok(gm.has('g:bundle') && pm.has(A1), 'both modes light the up-side neighbor (bundle) as card vs member')
  assert.ok(gm.has('g:plugin') && pm.has('g:plugin') && pm.has(X1), 'plugin neighbor lights in both modes')
  assert.ok(!gm.has('g:profiles') && !pm.has('g:profiles'), 'profiles never touched a llm edge — absent in both modes')
})

// ---------- V2.4b review hand-over (A): test hardening for the two silent-edit ----------
// ---------- seams the V2.4a battery left open. Model source untouched. ----------

test('V24-13 (hardened from review A) focus agg dominance is by COUNT, not first-inserted kind — pins graph-model.js:833', () => {
  const M = loadModel()
  const n = (id, group) => node(id + '@1.0.0', id, 'package', 'official', group, 'kernel', [])
  const g = {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: 'k', en: 'k' }], profiles: [],
    groups: [
      { id: 'gA', kind: 'official', category: 'kernel', packageCount: 2 },
      { id: 'gB', kind: 'official', category: 'kernel', packageCount: 2 },
    ],
    nodes: [n('r1', 'gA'), n('r2', 'gA'), n('x', 'gB'), n('w', 'gB')],
    edges: [
      { from: 'r1@1.0.0', to: 'x@1.0.0', kind: 'dep' },  // bucket kinds: dep ×1 (inserted FIRST)
      { from: 'r1@1.0.0', to: 'w@1.0.0', kind: 'peer' }, // …and peer ×2 — the COUNT MAJORITY
      { from: 'r2@1.0.0', to: 'w@1.0.0', kind: 'peer' },
    ],
  }
  const m = elMap(M.buildView(g, Object.assign(EXPANDED(), { focus: { rootId: 'g:gA' } })))
  assert.deepEqual(plain(m.get('agg:g:gA|g:gB')), {
    group: 'edges',
    data: { id: 'agg:g:gA|g:gB', source: 'g:gA', target: 'g:gB', count: 3, kind: 'peer' },
    classes: ['e-agg', 'e-peer'],
  }, 'dominantKind follows the unequal count ({dep:1, peer:2} → peer) — flipping the :833 comparator '
    + 'to `c > bestC + 1` (or any first-inserted/tie-order shortcut) lands this on dep and reddens here')
})

test('V24-14 (hardened from review A) packages-mode g: focus renders the pkgsBoth union — pins graph-model.js:493', () => {
  const M = loadModel()
  // bothGraph's x is in pkgsBoth (dep-OUT r1→x AND dep-IN x→r1); fixture()'s g:bundle focus
  // has an EMPTY pkgsBoth, which is why V24-06 alone never noticed the missing gAdd line.
  const res = M.buildView(bothGraph(), Object.assign(EXPANDED(), { focus: { rootId: 'g:gA', packages: true } }))
  const rendered = new Set(res.elements.map((e) => e.data.id))
  assert.ok(rendered.has('x@1.0.0'),
    'a BOTH-side neighbor member joins the rendered union (rootPkgs ∪ pkgsDown ∪ pkgsUp ∪ pkgsBoth) — '
    + 'deleting the `gSets.pkgsBoth.forEach(gAdd)` line at graph-model.js:493 drops x and reddens here')
  assert.deepEqual(plain(res.meta.focus),
    { rootKind: 'group', rootId: 'g:gA', depth: 1, members: 5, edges: 4 },
    'meta members count the both-side member too (5 = r1 r2 x y z, 4 = the four root-incident keys)')
})
