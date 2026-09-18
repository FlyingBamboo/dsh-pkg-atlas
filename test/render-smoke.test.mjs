/**
 * Task V5 — headless render smoke.
 *
 * app.js cannot run here (no DOM), so this test pins the two layers V5 depends on:
 *  1. AtlasModel output contract (the exact fields app.js binds in paint()/STYLE):
 *     every returned node carries finite numeric x/y, ids are unique, every child's
 *     parent exists IN THE ELEMENT SET (and precedes the child — cytoscape requires
 *     the parent compound to exist before a child is added), edge endpoints resolve.
 *     Also V5-M-6: zones/groups carry w/h, packages carry NEITHER (the app style
 *     maps compound sizes from data(w)/data(h) with min-* floors).
 *  2. Static contract guards on web/app.js / web/index.html: the style selectors
 *     must match AtlasModel's emitted classes, sizing must come from data(w)/data(h)
 *     with min-width/min-height floors, no cytoscape layout call, XSS discipline,
 *     and the served assets must include /graph-model.js ordered before app.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { loadAssets } from '../lib/http.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', 'web')

function loadModel() {
  const code = readFileSync(join(WEB, 'graph-model.js'), 'utf8')
  const sandbox = {}
  vm.runInNewContext(code, sandbox)
  assert.ok(sandbox.AtlasModel, 'classic script must set globalThis.AtlasModel')
  return sandbox.AtlasModel
}

// ---------- fixture (hand-built mini publicGraph per graph-shape.json) ----------
const A1 = '@deepseek-ai/core@1.0.0'
const U1 = '@deepseek-ai/util@1.0.0'
const F1 = '@fs@1.0.0'
const X1 = 'plugin-x@1.0.0'
const L1 = 'loose-lib@1.0.0'
const B1 = 'broken:@pkg-broken'
const WB = 'profile:web'

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
      { id: 'plugin', zh: '第三方插件', en: 'Plugins' },
      { id: 'profiles', zh: 'Profile 挂载面', en: 'Profiles' },
      { id: 'broken', zh: '断链', en: 'Broken' },
      { id: 'ungrouped', zh: '未归类', en: 'Uncategorized' },
    ],
    profiles: [{ name: 'web', dependencies: {}, bundles: [] }],
    groups: [
      { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 1 },
      { id: 'util', kind: 'official', category: 'kernel', packageCount: 1 },
      { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
      { id: 'plugin', kind: 'plugin', category: 'plugin', packageCount: 1 },
      { id: 'profiles', kind: 'profile', category: 'profiles', packageCount: 1 },
      { id: 'broken', kind: 'broken', category: 'broken', packageCount: 1 },
      { id: 'ungrouped', kind: 'ungrouped', category: 'ungrouped', packageCount: 1 },
      { id: 'ghost', kind: 'official', category: 'kernel', packageCount: 0 }, // renders nowhere
    ],
    nodes: [
      node(A1, '@deepseek-ai/core', 'package', 'official', 'bundle', 'kernel', ['web']),
      node(U1, '@deepseek-ai/util', 'package', 'official', 'util', 'kernel', ['web']),
      node(F1, '@fs', 'package', 'official', 'fs', 'tools', ['web']),
      node(X1, 'plugin-x', 'package', 'third-party', 'plugin', 'plugin', ['web']),
      node(L1, 'loose-lib', 'package', 'third-party', null, 'ungrouped', []),
      node(B1, 'pkg-broken', 'broken', 'official', 'broken', 'broken', []),
      node(WB, 'web', 'profile', 'meta', 'profiles', 'profiles', []),
    ],
    edges: [
      { from: A1, to: U1, kind: 'dep' },
      { from: A1, to: F1, kind: 'mount' },
      { from: X1, to: U1, kind: 'dep' },
      { from: X1, to: A1, kind: 'peer-optional' },
      { from: B1, to: A1, kind: 'dep' },
      { from: WB, to: A1, kind: 'mount' },
    ],
  }
}

// ---------- element-set invariants every paint() consumes ----------
function assertElementSet(elements, label) {
  const ids = new Set()
  const nodeIds = new Set()
  for (const el of elements) {
    assert.equal(typeof el.data.id, 'string', `${label}: string ids`)
    assert.ok(el.data.id.length > 0, `${label}: non-empty id`)
    assert.ok(!ids.has(el.data.id), `${label}: id ${el.data.id} unique`)
    ids.add(el.data.id)
    assert.ok(Array.isArray(el.classes) && el.classes.length > 0, `${label}: classes array on ${el.data.id}`)
    if (el.group === 'nodes') nodeIds.add(el.data.id)
  }
  // positions: every NODE (zone/group/pkg) arrives pre-positioned (R26 — no layout)
  for (const el of elements.filter((e) => e.group === 'nodes')) {
    assert.ok(Number.isFinite(el.data.x), `${label}: finite x on ${el.data.id}`)
    assert.ok(Number.isFinite(el.data.y), `${label}: finite y on ${el.data.id}`)
    assert.ok(!Number.isNaN(el.data.x) && !Number.isNaN(el.data.y), `${label}: no NaN x/y`)
  }
  // parent refs: must exist in the element set AND precede the child (cytoscape
  // add() requires the compound parent to already exist)
  const seen = new Set()
  for (const el of elements) {
    if (el.group === 'nodes' && el.data.parent != null) {
      assert.ok(ids.has(el.data.parent), `${label}: parent ${el.data.parent} of ${el.data.id} is in the set`)
      assert.ok(nodeIds.has(el.data.parent), `${label}: parent ${el.data.parent} is a node`)
      assert.ok(seen.has(el.data.parent), `${label}: parent ${el.data.parent} precedes child ${el.data.id}`)
    }
    if (el.group === 'edges') {
      assert.ok(ids.has(el.data.source), `${label}: edge source ${el.data.source} exists`)
      assert.ok(ids.has(el.data.target), `${label}: edge target ${el.data.target} exists`)
      assert.notEqual(el.data.source, el.data.target, `${label}: no self-loops after resolution`)
    }
    seen.add(el.data.id)
  }
}

test('AtlasModel: default view (all-collapsed) emits a well-formed, parent-safe element set', () => {
  const { buildView } = loadModel()
  const { elements, meta } = buildView(fixture(), {})
  assert.ok(elements.length > 0, 'default view renders')
  assertElementSet(elements, 'default')
  const zones = elements.filter((e) => e.data.kind === 'zone')
  const groups = elements.filter((e) => e.data.kind === 'group')
  assert.equal(zones.length, meta.zones)
  assert.equal(groups.length, meta.groups)
  assert.ok(zones.length >= 5, 'zones for kernel/tools/plugin/profiles/broken/ungrouped')
  // zone & group cards carry w/h (V5-M-6); zones carry raw category ids as name
  for (const z of zones) {
    assert.ok(Number.isFinite(z.data.w) && z.data.w > 0, `zone w on ${z.data.id}`)
    assert.ok(Number.isFinite(z.data.h) && z.data.h > 0, `zone h on ${z.data.id}`)
    assert.ok(z.data.name === z.data.id.slice(4), 'zone data.name is the RAW category id (V5-M-5 contract)')
    assert.ok(z.classes.includes('zone') && z.classes.includes('cat-' + z.data.name), 'zone classes')
  }
  for (const g of groups) {
    assert.ok(Number.isFinite(g.data.w) && g.data.w > 0, `group w on ${g.data.id}`)
    assert.ok(Number.isFinite(g.data.h) && g.data.h > 0, `group h on ${g.data.id}`)
    assert.ok(g.classes.includes('group') && g.classes.includes('collapsed'), 'default groups are cards')
    assert.ok(g.classes.some((c) => /^gk-/.test(c)), 'group kind class')
    assert.ok(String(g.data.id).startsWith('g:') && String(g.data.parent).startsWith('cat:'), 'id/parent prefixes')
  }
  // aggregated edges exist (groups resolved) and carry count + dominant kind
  const agg = elements.filter((e) => e.group === 'edges')
  assert.ok(agg.length > 0)
  for (const e of agg) {
    assert.ok(String(e.data.id).startsWith('agg:'), 'aggregate id prefix')
    assert.ok(Number.isFinite(e.data.count) && e.data.count > 0, 'agg count')
    assert.ok(e.classes.includes('e-agg') && e.classes.some((c) => /^e-(dep|mount|peer|peer-optional)$/.test(c)), 'edge classes')
  }
})

test('AtlasModel: fully expanded view keeps every invariants and the same coordinates', () => {
  const { buildView } = loadModel()
  const g = fixture()
  const collapsed = buildView(g, {})
  const expanded = buildView(g, { collapsedGroups: new Set() })
  assertElementSet(expanded.elements, 'expanded')
  const pkgs = expanded.elements.filter((e) => e.data.kind === 'pkg' || e.data.kind === 'profile')
  assert.equal(pkgs.length, g.nodes.length, 'every node renders when all groups expand')
  for (const p of pkgs) {
    assert.ok(p.classes.includes('pkg'), 'pkg class')
    assert.ok(p.classes.some((c) => /^sk-/.test(c)) && p.classes.some((c) => /^sc-/.test(c)), 'sk-/sc- classes')
    assert.equal(p.data.w, undefined, 'packages carry NO w/h (V5-M-6: only zones/groups are sized)')
    assert.equal(p.data.h, undefined, 'packages carry NO w/h (V5-M-6)')
    assert.ok(String(p.data.parent).startsWith('g:'), 'pkg parent is a group')
  }
  // R26 re-pin: coordinates never move between collapse states
  const posOf = (els) => new Map(els.map((e) => [e.data.id, [e.data.x, e.data.y]]))
  const pc = posOf(collapsed.elements)
  for (const el of expanded.elements) {
    if (!pc.has(el.data.id)) continue
    assert.deepEqual(pc.get(el.data.id), [el.data.x, el.data.y], `stable coords for ${el.data.id}`)
  }
})

test('AtlasModel: collapsed zone (collapsedCats) is a shell — zone node stays, children vanish', () => {
  const { buildView } = loadModel()
  const { elements } = buildView(fixture(), { collapsedGroups: new Set(), collapsedCats: new Set(['plugin']) })
  assertElementSet(elements, 'zone-collapsed')
  const zone = elements.find((e) => e.data.id === 'cat:plugin')
  assert.ok(zone, 'collapsed zone shell still renders (survivors > 0)')
  assert.equal(elements.find((e) => e.data.id === 'g:plugin'), undefined, 'no group cards inside a collapsed zone')
  assert.equal(elements.find((e) => e.data.id === X1), undefined, 'no packages inside a collapsed zone')
})

// ---------- static contract guards on the browser layer ----------
test('app.js: binds the AtlasModel contract exactly (selectors/sizing/shapes/no-layout)', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  // sizing from data, with the compound floor mechanics documented in the header
  assert.match(src, /width:\s*'data\(w\)'/, 'width bound to data(w)')
  assert.match(src, /height:\s*'data\(h\)'/, 'height bound to data(h)')
  assert.match(src, /'min-width':\s*'data\(w\)'/, 'min-width floor from data(w)')
  assert.match(src, /'min-height':\s*'data\(h\)'/, 'min-height floor from data(h)')
  // dist-verified enums ONLY: compound-sizing-wrt-labels ∈ {include,exclude},
  // text-valign ∈ {top,top-inside,center,bottom,bottom-inside} (3.34.1 dist)
  assert.match(src, /'compound-sizing-wrt-labels':\s*'exclude'/, 'child labels cannot inflate compound boxes')
  assert.doesNotMatch(src, /'compound-sizing-wrt-labels':\s*'ignore'/, 'ignore is NOT a valid enum in 3.34.1')
  assert.match(src, /'text-valign':\s*'top-inside'/, 'zone/group labels inside-top (dist enum: top-inside)')
  assert.doesNotMatch(src, /inside-top/, 'inside-top is NOT a valid enum in 3.34.1')
  // cytoscape keeps position outside data (dist-verified) — paint must map x/y in
  assert.match(src, /position:\s*\{\s*x:\s*el\.data\.x,\s*y:\s*el\.data\.y\s*\}/, 'data.x/y mapped to element position on add')
  // style selectors MUST use the model's emitted classes
  assert.match(src, /node\.zone\.cat-/, 'per-zone class selector (model emits zone + cat-<id>)')
  assert.match(src, /node\.group\.gk-/, 'group kind selector (model emits gk-<kind>)')
  assert.match(src, /node\.pkg\.sk-profile/, 'profile shape selector')
  assert.match(src, /node\.pkg\.sk-broken/, 'broken shape selector')
  assert.match(src, /node\.pkg\.sc-third-party/, 'third-party scope selector')
  assert.match(src, /edge\.e-agg|'e-agg'/, 'aggregate edge styling')
  assert.match(src, /e-peer-optional/, 'peer-optional edge styling')
  assert.match(src, /\.cross|'cross'/, 'cross edge styling')
  assert.match(src, /\.selected|'selected'/, 'selected class styling')
  // R29 shapes via builtin mapping
  assert.match(src, /hexagon/, 'third-party hexagon')
  assert.match(src, /diamond/, 'broken diamond')
  assert.match(src, /rectangle/, 'profile rectangle')
  // interactions + paint-only mutation
  assert.match(src, /dbltap/, 'double-click collapse wiring')
  assert.doesNotMatch(src, /\.layout\(/, 'NO cytoscape layout in V5 (R26)')
  // V5-M-5: zone titles come from graph.categories, raw id must not be the label
  assert.match(src, /zoneTitle/, 'bilingual zone title lookup exists')
  assert.match(src, /\.zh/, 'zh label used')
  assert.match(src, /\.en/, 'en label used')
  // 13-zone × two-theme palette (unquoted keys: light + dark + fallback order ≥ 3 hits)
  for (const id of ['kernel', 'session', 'llm', 'tools', 'orchestration', 'integration', 'ui',
    'platform', 'infra', 'plugin', 'profiles', 'broken', 'ungrouped']) {
    const hits = (src.match(new RegExp('\\b' + id + '\\b', 'g')) || []).length
    assert.ok(hits >= 3, `zone ${id} appears in both palettes + fallback order`)
  }
})

test('app.js + index.html: XSS discipline and asset order', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  assert.doesNotMatch(src, /\.innerHTML|insertAdjacentHTML|document\.write/, 'XSS discipline')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const gi = html.indexOf('graph-model.js')
  const ai = html.indexOf('app.js')
  assert.ok(gi >= 0 && ai >= 0 && gi < ai, 'graph-model.js loads BEFORE app.js')
  // V6 containers exist and are empty (must not error: app.js never touches them
  // except hiding #legend in the table-fallback path)
  for (const idOfIt of ['id="legend"', 'id="zone-chips"', 'id="progress-bar"']) {
    assert.ok(html.includes(idOfIt), `container ${idOfIt} present`)
  }
})

test('http: /graph-model.js is served as a first-class asset', () => {
  const assets = loadAssets(WEB)
  assert.ok(assets.has('/graph-model.js'), '/graph-model.js route exists')
  const a = assets.get('/graph-model.js')
  assert.match(a.type, /text\/javascript/, 'js mime')
  assert.ok(a.body.length > 1000, 'non-trivial body')
  assert.ok(assets.has('/app.js') && assets.has('/index.html'), 'existing routes intact')
})
