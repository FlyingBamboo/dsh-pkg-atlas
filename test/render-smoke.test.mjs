/**
 * Task V5 — headless render smoke (+ fix round 1: dist-validity guards)
 * + Task V6 — interaction layer: pure-helper unit tests, control→view
 *   mapping guards, i18n parity, CSS [hidden]/pointer-events guards, XSS re-sweep.
 *
 * app.js cannot run here (no DOM), so this test pins the layers V5 depends on:
 *  1. AtlasModel output contract (the exact fields app.js binds in paint()/STYLE):
 *     every returned node carries finite numeric x/y, ids are unique, every child's
 *     parent exists IN THE ELEMENT SET (and precedes the child — cytoscape requires
 *     the parent compound to exist before a child is added), edge endpoints resolve.
 *     Also V5-M-6: zones/groups carry w/h, packages carry NEITHER.
 *  2. Selector↔class agreement, DERIVED from both sides: the class tokens
 *     AtlasModel actually emits vs the selector tokens app.js's styleFor()
 *     actually produces. A rename on either side now fails here (the previous
 *     guard hard-coded app.js's selector list, so a model-side rename passed).
 *  3. DIST VALIDITY: styleFor()'s array is pushed through the frozen vendored
 *     cytoscape 3.34.1 with console.warn captured, and the computed style is read
 *     back off real elements. Property/selector typos are SILENT in a browser
 *     (cytoscape only warns + drops the rule) — this is the guard that pins
 *     `text-max-width` (not max-text-width), the CARD/CONTAINER `:parent` split
 *     (`:not()` does not exist in this dist), the `background-color` core option
 *     and the gk-<kind> palette entries actually landing on the cards.
 *  4. Static contract guards on web/app.js / web/index.html (sizing from data(w)/
 *     data(h) with min-* floors, dist enums only, no cytoscape layout call, XSS
 *     discipline, asset order) and the zone palette derived from lib/categories.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { loadAssets } from '../lib/http.js'
import { CATEGORY_ORDER, SPECIAL_ZONES } from '../lib/categories.js'

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
const V1 = 'some-vendor-lib@1.0.0' // lib/scan.js group kind `vendor` → infra zone

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
      { id: 'infra', zh: '基础设施', en: 'Infrastructure' },
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
      { id: 'vendor', kind: 'vendor', category: 'infra', packageCount: 1 },
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
      node(V1, 'some-vendor-lib', 'package', 'third-party', 'vendor', 'infra', ['web']),
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
      { from: A1, to: X1, kind: 'peer' },
      { from: B1, to: A1, kind: 'dep' },
      { from: WB, to: A1, kind: 'mount' },
      { from: V1, to: U1, kind: 'dep' },
    ],
  }
}

// ---------- app.js layer, loaded for real (no DOM needed for styleFor) ----------
/**
 * Balanced extraction of a top-level declaration from app.js source. The anchor
 * ends with the opening brace/bracket; strings, templates and comments are
 * skipped, so braces inside them cannot close the match.
 */
function extractBalanced(src, anchor) {
  const i = src.indexOf(anchor)
  assert.ok(i >= 0, `app.js must still declare \`${anchor}\` (extraction anchor)`)
  let j = i + anchor.length, depth = 1, inStr = null, inCom = null
  for (; j < src.length; j++) {
    const c = src[j], d = src[j + 1]
    if (inCom) {
      if (inCom === '//' && c === '\n') inCom = null
      else if (inCom === '/*' && c === '*' && d === '/') { j++; inCom = null }
      continue
    }
    if (inStr) {
      if (c === '\\') { j++; continue }
      if (c === inStr) inStr = null
      continue
    }
    if (c === '/' && d === '/') { j++; inCom = '//'; continue }
    if (c === '/' && d === '*') { j++; inCom = '/*'; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; continue }
    if (c === '{' || c === '[') { depth++; continue }
    if (c === '}' || c === ']') {
      depth--
      if (depth === 0) return src.slice(i, j + 1)
      continue
    }
  }
  assert.fail(`unbalanced text after \`${anchor}\``)
}

/**
 * styleFor() out of web/app.js, evaluated with only the globals it touches
 * (ZONE_COLORS, ZONE_IDS_FALLBACK, FOCUS_COLORS, state). styleFor() reads
 * state.graph for the per-zone selectors, so the caller hands it the SAME graph
 * the model rendered.
 */
function loadAppStyle(graph) {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    extractBalanced(src, 'var ZONE_COLORS = {') + '\n',
    extractBalanced(src, 'var ZONE_IDS_FALLBACK = [') + '\n',
    extractBalanced(src, 'var FOCUS_COLORS = {') + '\n',
    extractBalanced(src, 'function styleFor(theme) {') + '\n',
    'var state = { graph: null }\n',
    'return { setGraph: function (g) { state.graph = g },\n'
    + '  styleFor: function (theme) { return styleFor(theme) },\n'
    + '  ZONE_COLORS: ZONE_COLORS, ZONE_IDS: ZONE_IDS_FALLBACK, FOCUS_COLORS: FOCUS_COLORS }',
  ].join('')
  const mod = new Function(body)() // same realm as the vendored cytoscape below
  mod.setGraph(graph)
  return mod
}

/**
 * The frozen vendored bundle, evaluated in THIS realm via the UMD CommonJS
 * branch. A vm realm would be wrong here: cytoscape's option check is
 * `isPlainObject(options)` against its own realm's Object, so host-realm
 * elements/style arrays handed to a vm-realm cytoscape are silently rejected
 * (cytoscape() returns undefined) — verified against the dist.
 */
function loadVendoredCytoscape() {
  const src = readFileSync(join(WEB, 'vendor', 'cytoscape.min.js'), 'utf8')
  const mod = { exports: {} }
  new Function('module', 'exports', src)(mod, mod.exports)
  assert.equal(typeof mod.exports, 'function', 'web/vendor/cytoscape.min.js must export cytoscape')
  return mod.exports
}

/** paint()'s element mapping, replayed for the probe (data.x/y → position + label).
 *  Elements are rebuilt in THIS realm: model output lives in a vm realm and node's
 *  cross-realm prototype checks (and cytoscape's array tests) are brittle there. */
function paintElements(Model, graph, view) {
  const out = []
  for (const el of Model.buildView(graph, view).elements) {
    const data = Object.assign({}, JSON.parse(JSON.stringify(el.data)))
    const classes = [...el.classes]
    if (el.group !== 'nodes') { out.push({ group: 'edges', classes, data }); continue }
    data.label = data.name == null ? data.id : String(data.name)
    out.push({ group: 'nodes', classes, data, position: { x: data.x, y: data.y } })
  }
  return out
}

/** class tokens of a cytoscape selector (`.foo` / `.foo-bar`; pseudo-classes excluded). */
function selectorClassTokens(selector) {
  const out = []
  const re = /\.([A-Za-z_][\w-]*)/g
  let m
  while ((m = re.exec(selector))) out.push(m[1])
  return out
}

const pnum = (ele, prop) => { const v = ele.pstyle(prop); return v == null ? undefined : v.pfValue }
const pstr = (ele, prop) => {
  const v = ele.pstyle(prop)
  return v == null ? undefined : (v.strValue != null ? v.strValue : String(v.value))
}

function captureWarnings(fn) {
  const warns = []
  const orig = console.warn
  console.warn = (...a) => { warns.push(a.map(String).join(' ')) }
  try { fn() } finally { console.warn = orig }
  return warns
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
  assert.ok(zones.length >= 5, 'zones for kernel/tools/infra/plugin/profiles/broken/ungrouped')
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
  // the scanned group kinds must survive into classes: lib/scan.js emits kind
  // `vendor` (vendor/ dirs) and the app palette has to keep up with it.
  const gkinds = new Set(groups.flatMap((g) => g.classes.filter((c) => c.startsWith('gk-'))))
  for (const k of ['gk-official', 'gk-plugin', 'gk-profile', 'gk-broken', 'gk-vendor', 'gk-ungrouped']) {
    assert.ok(gkinds.has(k), `fixture must emit ${k} so the palette stays covered`)
  }
  // R43 (V2.4a, user ruling): the base group-level path emits ZERO edges — the
  // aggregate emission this section pinned is retired on purpose (see the model
  // suite V24-05/V24-11 for the new intended state and the retained agg shape,
  // now living in the g: focus branch).
  const edges = elements.filter((e) => e.group === 'edges')
  assert.equal(edges.length, 0, 'default view emits no edges (R43)')
  assert.equal(meta.aggEdges, 0)
  assert.equal(meta.edges, 0)
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

// =========================================================================
// V5 fix round 1 — selector↔class agreement, derived from BOTH real sources
// =========================================================================
test('STYLE↔MODEL: every class AtlasModel emits has an app.js selector (derived, not mirrored)', () => {
  const Model = loadModel()
  const graph = fixture()
  // the full emitted-class universe across the view states the app can reach
  const views = [
    {},                                            // default: all groups collapsed
    { collapsedGroups: new Set() },                // all expanded
    { collapsedCats: new Set(['tools']) },         // a collapsed zone shell
    { collapsedCats: new Set(['tools']), collapsedGroups: new Set() },
    { collapsedGroups: new Set(), showRealCross: true }, // real pkg↔pkg edges
    { filterScope: 'third-party' },
    { filterProfile: 'web' },
    // V22b: the focus subgraph emits the ctx class — its STYLE rule must exist
    { focus: { rootId: A1, depth: null } },
    // V24a/R43: base aggregates are gone, so the agg classes (e-agg, e-mount …)
    // now enter the emitted universe through the g: focus aggregates.
    { focus: { rootId: 'g:bundle' } },
  ]
  const emitted = new Set()
  let nodesSeen = 0
  for (const view of views) {
    const { elements } = Model.buildView(graph, view)
    for (const el of elements) {
      if (el.group === 'nodes') nodesSeen++
      for (const c of el.classes) emitted.add(c)
    }
  }
  assert.ok(nodesSeen > 40, `guard must actually render something (got ${nodesSeen} nodes)`)

  const mod = loadAppStyle(graph)
  const styled = new Set()
  const selectorsByTheme = {}
  for (const theme of ['light', 'dark']) {
    const rules = mod.styleFor(theme)
    selectorsByTheme[theme] = rules.map((r) => r.selector)
    for (const rule of rules) {
      assert.equal(typeof rule.selector, 'string', 'every style rule carries a selector')
      // forms this dist has no notion of (I-2): they parse to NOTHING or warn
      assert.doesNotMatch(rule.selector, /:not\b|:nonmatching|:has\b/,
        `unsupported selector form in app.js STYLE: ${rule.selector}`)
      for (const t of selectorClassTokens(rule.selector)) styled.add(t)
    }
    assert.ok(selectorsByTheme[theme].includes('node.group:parent'),
      'the expanded CONTAINER look must be keyed on :parent (node has children)')
    assert.ok(selectorsByTheme[theme].includes('node.group'),
      'the collapsed CARD look must be the node.group base rule')
  }
  // Classes the model emits that carry NO visual role of their own: the element
  // is already painted by a rule that is more general (base `edge` paints the
  // default dep line; base `node.pkg` + sk-profile/sc-* paint a package).
  // Exact-set on purpose: a NEW unstyled token fails, and so does an entry that
  // stops being needed — the list can never rot into a silent catch-all.
  const informational = new Set(['e-dep', 'sk-package', 'sc-meta'])
  const unstyled = [...emitted].filter((t) => !styled.has(t)).sort()
  assert.deepEqual(unstyled, [...informational].sort(),
    'AtlasModel classes with no app.js selector (a rename on either side lands here)')

  // Reverse direction: a selector whose class the model never emits is a rule
  // that matches nothing. Allowed only when app.js itself applies that class at
  // runtime — derived from its own addClass/removeClass literals, not a list.
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const appApplied = new Set()
  const re = /(?:addClass|removeClass)\(\s*'([^']*)'/g
  let m
  while ((m = re.exec(src))) m[1].split(/\s+/).filter(Boolean).forEach((c) => appApplied.add(c))
  assert.ok(appApplied.has('selected') && appApplied.has('dim') && appApplied.has('in-focus'),
    `app-applied classes must be derivable from addClass/removeClass (got ${[...appApplied]})`)
  const stale = [...styled].filter((t) => !emitted.has(t) && !appApplied.has(t)).sort()
  assert.deepEqual(stale, [], 'app.js selectors naming a class nothing emits')
})

test('STYLE↔MODEL: zone palette covers every category id lib/categories.js can emit', () => {
  const mod = loadAppStyle(null) // no graph → styleFor falls back to ZONE_IDS_FALLBACK
  const ids = [...CATEGORY_ORDER, ...SPECIAL_ZONES.map((z) => z.id)]
  assert.equal(ids.length, 13, 'the 9 main categories + 4 special zones')
  assert.deepEqual(mod.ZONE_IDS, ids, 'app.js fallback zone order == lib/categories.js order')
  for (const theme of ['light', 'dark']) {
    const table = mod.ZONE_COLORS[theme]
    assert.ok(table, `ZONE_COLORS.${theme} exists`)
    for (const id of ids) {
      assert.ok(table[id] && /^#[0-9a-f]{6}$/i.test(table[id].line), `${theme} palette entry for zone ${id}`)
    }
    const selectors = new Set(mod.styleFor(theme).map((r) => r.selector))
    for (const id of ids) assert.ok(selectors.has('node.zone.cat-' + id), `${theme}: node.zone.cat-${id} rule emitted`)
  }
})

// =========================================================================
// V5 fix round 1 — the frozen dist decides what is a valid style/selector
// =========================================================================
test('dist validity: cytoscape 3.34.1 accepts app.js STYLE with ZERO warnings (I-1/I-2/I-3/I-4)', () => {
  const Model = loadModel()
  const graph = fixture()
  const Cytoscape = loadVendoredCytoscape()
  const mod = loadAppStyle(graph)
  for (const theme of ['light', 'dark']) {
    const style = mod.styleFor(theme)
    for (const view of [{}, { collapsedGroups: new Set() }]) {
      const els = paintElements(Model, graph, view)
      let cy
      const warns = captureWarnings(() => {
        cy = Cytoscape({ headless: true, styleEnabled: true, elements: els })
        cy.style(style)
      })
      try {
        assert.deepEqual(warns.filter((w) => /is invalid|Halting/i.test(w)), [],
          `${theme}/${JSON.stringify(view)}: cytoscape rejected a property or selector:\n  ${warns.join('\n  ')}`)
        assert.deepEqual(warns, [], `${theme}/${JSON.stringify(view)}: unexpected cytoscape warnings:\n  ${warns.join('\n  ')}`)
        // parsed rules ≥ pushed rules: nothing got dropped on the floor
        assert.ok(cy.style().length >= style.length, 'every pushed rule survived parsing')
      } finally {
        if (cy) cy.destroy()
      }
    }
  }
})

const THEME = {
  light: { hex: '#f7f8fa', vendorBg: 'rgb(217,236,230)', vendorLine: 'rgb(15,125,100)' },
  dark: { hex: '#12161b', vendorBg: 'rgb(31,59,52)', vendorLine: 'rgb(79,194,160)' },
}
const hexToRgb = (h) => 'rgb(' + [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)).join(',') + ')'
const VENDOR = {
  light: [THEME.light.vendorBg, THEME.light.vendorLine],
  dark: [THEME.dark.vendorBg, THEME.dark.vendorLine],
}
const THEME_BG = { light: hexToRgb(THEME.light.hex), dark: hexToRgb(THEME.dark.hex) }

test('computed style: collapsed CARD vs expanded CONTAINER, vendor palette, themed canvas', () => {
  const Model = loadModel()
  const graph = fixture()
  const Cytoscape = loadVendoredCytoscape()
  const mod = loadAppStyle(graph)
  for (const theme of ['light', 'dark']) {
    const style = mod.styleFor(theme)
    for (const [view, expectOp] of [[{}, 0.9], [{ collapsedGroups: new Set() }, 0.14]]) {
      const els = paintElements(Model, graph, view)
      const groups = els.filter((e) => e.group === 'nodes' && e.classes.includes('group'))
      assert.ok(groups.length >= 6, 'the fixture renders several group cards/containers')
      let cy
      captureWarnings(() => {
        cy = Cytoscape({ headless: true, styleEnabled: true, elements: els })
        cy.style(style)
      })
      try {
        // CARD/CONTAINER split keyed on the SAME structural fact the style uses:
        // a card is childless, an expanded container has its members as children.
        for (const g of groups) {
          const ele = cy.getElementById(g.data.id)
          const collapsed = g.classes.includes('collapsed')
          assert.equal(ele.isParent(), !collapsed, `${g.data.id}: parent-ness must match the collapsed class`)
          assert.equal(pnum(ele, 'background-opacity'), collapsed ? 0.9 : 0.14,
            `${theme}/${g.data.id}: ${collapsed ? 'CARD' : 'CONTAINER'} background-opacity`)
          assert.equal(pnum(ele, 'text-max-width'), 120, `${theme}/${g.data.id}: group label cap applied`)
          assert.equal(pstr(ele, 'text-wrap'), 'ellipsis', `${theme}/${g.data.id}: ellipsis wrap`)
          assert.equal(pstr(ele, 'text-valign'), collapsed ? 'center' : 'top-inside',
            `${theme}/${g.data.id}: card label centers, container label rides the top strip`)
        }
        // the `vendor` kind must NOT fall through to the dist defaults
        const vendor = groups.find((g) => g.classes.includes('gk-vendor'))
        assert.ok(vendor, 'fixture renders a vendor-kind group')
        const v = cy.getElementById(vendor.data.id)
        assert.equal(pstr(v, 'background-color'), VENDOR[theme][0], `${theme}: gk-vendor background from the palette`)
        assert.equal(pstr(v, 'border-color'), VENDOR[theme][1], `${theme}: gk-vendor border from the palette`)
        // every gk-<kind> rule actually paints its cards (nothing silently missing)
        for (const g of groups) {
          const kind = g.classes.find((c) => c.startsWith('gk-'))
          const rule = style.find((r) => r.selector === 'node.group.' + kind)
          assert.ok(rule, `app.js has a palette rule for the emitted class ${kind}`)
          assert.notEqual(pstr(cy.getElementById(g.data.id), 'background-color'), 'rgb(238,238,238)',
            `${kind} renders at the cytoscape default → palette entry missing`)
        }
        // I-1: the label cap is the declared value, not the dist default 9999
        const zone = els.find((e) => e.classes.includes('zone'))
        assert.equal(pnum(cy.getElementById(zone.data.id), 'text-max-width'), 300, 'zone label cap applied')
        // V2.3 label clamp (THE fix for the browser-only label collision): the
        // collision is SIBLING PKG LABELS side by side, never box on box — both
        // compound rules pin width/height/min-* to data(w)/data(h) and set
        // compound-sizing-wrt-labels:'exclude' (app.js, the zone and group
        // rules), so frames never grow with child labels. At the shipped 96px a
        // centred label outgrew the intra-row CENTRE pitch CELL(46)+GAP(12)=58
        // and lay across the neighbouring column's text (short names hide it,
        // scoped long names do not). Headless cytoscape has no font metrics, so
        // the numeric pin below is what the harness can honestly assert.
        const pkgs = els.filter((e) => e.group === 'nodes' && e.classes.includes('pkg'))
        if (expectOp === 0.14) assert.ok(pkgs.length >= 6, 'the expanded view renders packages to clamp')
        for (const p of pkgs) {
          assert.equal(pnum(cy.getElementById(p.data.id), 'text-max-width'), 50,
            `${theme}/${p.data.id}: pkg label clamped to 50 ≤ CELL+GAP (58)`)
        }
        // I-3: the themed canvas background actually lands on core
        const core = cy.style().core('background-color')
        assert.ok(core, `${theme}: core background-color rule parsed`)
        assert.equal(core.strValue, THEME_BG[theme], `${theme}: core background-color themes the canvas pane`)
        // I-2 sanity: the CARD marker is the childless test, never `:orphan`
        assert.deepEqual([...cy.nodes(':orphan').map((e) => e.id())],
          els.filter((e) => e.group === 'nodes' && e.data.parent == null).map((e) => e.data.id),
          ':orphan is "no parent" in this dist — only zones qualify')
      } finally {
        if (cy) cy.destroy()
      }
    }
  }
})

// =========================================================================
// static contract guards on the browser layer
// =========================================================================
test('app.js: binds the AtlasModel contract exactly (sizing/enums/shapes/no-layout)', () => {
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
  // spelling traps the dist proved (I-1/I-3): the wrong name parses to nothing
  assert.doesNotMatch(src, /['"]?max-text-width['"]?\s*:/, 'the property is text-max-width, not max-text-width')
  assert.doesNotMatch(src, /\{\s*background\s*:/, 'core background must be spelled background-color')
  assert.match(src, /'text-max-width':\s*300/, 'zone label cap declared')
  // V2.3: the PACKAGE clamp, derived against the model's own grid constants (the
  // model file is not edited by this task — it is read here as the source of truth).
  const modelSrc = readFileSync(join(WEB, 'graph-model.js'), 'utf8')
  const CELL = Number(/CELL:\s*(\d+)/.exec(modelSrc)[1])
  const GAP = Number(/\n\s+GAP:\s*(\d+)/.exec(modelSrc)[1])
  assert.equal(CELL + GAP, 58, 'fixture-free re-derivation: intra-row centre distance is 58')
  const pkgRule = loadAppStyle(fixture()).styleFor('light').find((r) => r.selector === 'node.pkg')
  assert.ok(pkgRule, 'node.pkg style rule exists')
  assert.equal(pkgRule.style['text-max-width'], 50, 'V2.3 pkg label clamp is 50 (was 96)')
  assert.ok(pkgRule.style['text-max-width'] <= CELL + GAP,
    'a pkg label can never reach the next column label box')
  assert.doesNotMatch(src, /'text-max-width':\s*96/, 'the oversized 96px pkg label is gone')
  // cytoscape keeps position outside data (dist-verified) — paint must map x/y in
  assert.match(src, /position:\s*\{\s*x:\s*el\.data\.x,\s*y:\s*el\.data\.y\s*\}/, 'data.x/y mapped to element position on add')
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
})

test('app.js + style.css: XSS discipline, asset order, hidden progress bar, themed pane', () => {
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
  assert.match(html, /id="progress-bar"\s+hidden/, '#progress-bar ships hidden')
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  // #progress-bar sets display:flex, which beats the UA [hidden]{display:none}
  // rule (author origin wins regardless of specificity) → an override-free hidden
  // bar left a permanent empty track on screen.
  assert.match(css, /#progress-bar\[hidden\]\s*\{[^}]*display:\s*none/, 'hidden progress bar is truly invisible')
  assert.match(css, /#progress-bar\s*\{[^}]*display:\s*flex/, 'and it still displays when V6 un-hides it')
  // The pane has to be themed by CSS, not by the stylesheet: the frozen dist's
  // canvas renderer clears to transparent and never draws a core background
  // (CRp.clearCanvas), and its webgl path reads the CONTAINER's CSS background
  // (getBGColor) — so `core { background-color }` alone cannot theme anything.
  // The colors must still be the ones styleFor() declares, or the two sources drift.
  const app = loadAppStyle(null)
  const graphRule = /#graph\s*\{[^}]*\}/.exec(css)
  assert.ok(graphRule, 'style.css themes #graph')
  for (const theme of ['light', 'dark']) {
    const coreRule = app.styleFor(theme).find((r) => r.selector === 'core')
    assert.ok(coreRule && coreRule.style['background-color'], `${theme}: styleFor still declares a core background`)
    assert.match(coreRule.style['background-color'], /^#[0-9a-f]{6}$/i, 'core background is a hex color')
    assert.ok(graphRule[0].toLowerCase().includes(coreRule.style['background-color'].toLowerCase()),
      `#graph must carry the ${theme} canvas color ${coreRule.style['background-color']}`)
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

// =========================================================================
// Task V6 — interaction layer. The pure helpers (pathSets/buildPathLists/
// normalizeDepth/matchNodes/progressFor/edgeKindsFor) are DOM-free by contract
// (app.js keeps them self-contained apart from EDGE_KINDS_ALL), so the SAME
// balanced-extraction seam that loadAppStyle() uses lifts them into a bare
// function scope.
// Anchor caveat: extractBalanced() counts only { } and [ ], so a function
// anchor must END at the body's opening brace — full signature required.
// =========================================================================

/**
 * V22b: pathSets is no longer extracted from app.js — the copy was deleted and
 * the app consumes AtlasModel.pathSets. The model source is therefore eval'd
 * INTO THIS REALM (its IIFE receives a sandbox object shadowing `globalThis`)
 * so host-realm buildPathLists instanceof-Set checks keep passing and the V21
 * suite runs against the canonical implementation with zero other edits.
 */
function loadAppPure() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const model = readFileSync(join(WEB, 'graph-model.js'), 'utf8')
  // bare numeric consts have no brace to balance on: capture the statements
  const consts = {}
  for (const name of ['PEEK_DESC_CAP', 'PATH_STACK_CAP', 'CRUMB_MAX', 'GROUP_MEMBER_CAP']) {
    const m = new RegExp('var ' + name + ' = [^\\n;]+').exec(src)
    assert.ok(m, `app.js must still declare \`var ${name} = …\``)
    consts[name] = m[0] + '\n'
  }
  const body = [
    extractBalanced(src, 'var EDGE_KINDS_ALL = [') + '\n',
    extractBalanced(src, 'var DOWN_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'var UP_EDGE_KINDS = [') + '\n',
    consts.PEEK_DESC_CAP, consts.PATH_STACK_CAP, consts.CRUMB_MAX, consts.GROUP_MEMBER_CAP,
    extractBalanced(src, 'function normalizeDepth(depth) {') + '\n',
    extractBalanced(src, 'function buildPathLists(sets, graph, byId) {') + '\n',
    extractBalanced(src, 'function matchNodes(graph, query, limit) {') + '\n',
    extractBalanced(src, 'function progressFor(status) {') + '\n',
    extractBalanced(src, 'function edgeKindsFor(checked) {') + '\n',
    extractBalanced(src, 'function catTitle(categories, catId, lang) {') + '\n',
    extractBalanced(src, 'function groupZoneOf(graph, gid) {') + '\n',
    extractBalanced(src, 'function buildGroupMembers(sel, graph) {') + '\n',
    extractBalanced(src, 'function buildPeekCard(n, graph, byId, lang) {') + '\n',
    extractBalanced(src, 'function pushPathStack(stack, id, cap) {') + '\n',
    extractBalanced(src, 'function pathChainText(labels, sep) {') + '\n',
    extractBalanced(src, 'function groupRowsByDist(rows) {') + '\n',
    extractBalanced(src, 'function soloToggleFor(allCats, current, id) {') + '\n',
    extractBalanced(src, 'function hideAllCats(allCats) {') + '\n',
    extractBalanced(src, 'function showAllCats() {') + '\n',
    extractBalanced(src, 'function buildRelatedGroups(sets, graph, groupsMeta, tier) {') + '\n',
    extractBalanced(src, 'function assembleView(view) {') + '\n',
    extractBalanced(src, 'function buildContextMenu(target, state, lang) {') + '\n',
    'var __sb = {};(function (globalThis) {' + model + '\n}).call(__sb, __sb)\n',
    'return { EDGE_KINDS_ALL, normalizeDepth, pathSets: __sb.AtlasModel.pathSets, buildPathLists, matchNodes, progressFor, edgeKindsFor,\n'
    + '  catTitle, groupZoneOf, PEEK_DESC_CAP, buildPeekCard, buildGroupMembers, GROUP_MEMBER_CAP,\n'
    + '  PATH_STACK_CAP, pushPathStack, CRUMB_MAX, pathChainText, groupRowsByDist,\n'
    + '  soloToggleFor, hideAllCats, showAllCats, buildRelatedGroups, assembleView, buildContextMenu }',
  ].join('')
  return new Function(body)()
}

/**
 * applyClasses() + the pure helpers it depends on, evaluated against a FAKE
 * cytoscape: the focus class algebra is pure bookkeeping (which id gets which
 * class); the paint() → computed-style hop is pinned separately by the
 * real-cytoscape test below. `state` is handed in exactly as paint() leaves it.
 */
function loadFocusLogic() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    extractBalanced(src, 'var DOWN_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'var UP_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'function gidOf(n) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function renderIdOf(id) {') + '\n',
    extractBalanced(src, 'function applyClasses() {') + '\n',
    // V22b: applyClasses consumes AtlasModel.pathSets; view.edgeKinds drives ek-off
    'var state = { cy: null, graph: null, byId: new Map(), groupZone: new Map(), focus: null, selected: null, view: { edgeKinds: null } }\n',
    'return { pathSets: AtlasModel.pathSets, apply: function (o) { Object.assign(state, o); applyClasses() } }',
  ].join('')
  return new Function('AtlasModel', body)(loadModel())
}

/**
 * Minimal cytoscape surface for applyClasses: elements()/nodes()/edges()
 * collections, getElementById, add/removeClass, hasClass, parents(). Compound
 * parents come from the element data (the AtlasModel contract).
 */
function makeFakeCy(elements) {
  const els = elements.map((e) => ({
    id: e.data.id,
    group: e.group === 'nodes' ? 'nodes' : 'edges',
    data: e.data,
    classes: new Set(e.classes),
    parent: e.group === 'nodes' && e.data.parent != null ? e.data.parent : null,
  }))
  const byId = new Map(els.map((e) => [e.id, e]))
  const tokens = (s) => String(s).split(/\s+/).filter(Boolean)
  const wrap = (e) => ({
    length: 1,
    id: () => e.id,
    data: (k) => (k == null ? e.data : e.data[k]),
    addClass: (s) => tokens(s).forEach((c) => e.classes.add(c)),
    removeClass: (s) => tokens(s).forEach((c) => e.classes.delete(c)),
    hasClass: (c) => e.classes.has(c),
    parents: () => {
      const chain = []
      let p = e.parent
      while (p != null && byId.has(p)) { chain.push(wrap(byId.get(p))); p = byId.get(p).parent }
      return { forEach: (fn) => chain.forEach(fn) }
    },
  })
  const EMPTY = {
    length: 0, id: () => '', addClass() {}, removeClass() {},
    hasClass: () => false, parents: () => ({ forEach() {} }),
  }
  const coll = (list) => ({
    length: list.length,
    forEach: (fn) => list.forEach((el) => fn(wrap(el))),
    removeClass: (s) => list.forEach((el) => tokens(s).forEach((c) => el.classes.delete(c))),
  })
  return {
    nodes: () => coll(els.filter((e) => e.group === 'nodes')),
    edges: () => coll(els.filter((e) => e.group === 'edges')),
    elements: () => coll(els),
    getElementById: (id) => (byId.has(id) ? wrap(byId.get(id)) : EMPTY),
    classesOf: (id) => [...byId.get(id).classes],
  }
}

/** group→zone exactly as computeGroupUniverse/AtlasModel derive it. */
function zoneTable(graph) {
  const declared = new Map()
  for (const g of graph.groups || []) if (g && g.id != null) declared.set(String(g.id), g)
  const firstCat = new Map()
  for (const n of graph.nodes) {
    if (!n || n.id == null) continue
    const gid = n.group == null ? 'ungrouped' : String(n.group)
    if (!firstCat.has(gid) && n.category) firstCat.set(gid, String(n.category))
  }
  const map = new Map()
  for (const [gid, entry] of declared) {
    map.set(gid, entry.category ? String(entry.category) : (firstCat.get(gid) || 'ungrouped'))
  }
  return map
}

function byIdMap(graph) {
  return new Map(graph.nodes.map((n) => [n.id, n]))
}

/**
 * The details-panel row builders are DOM code, so the pure seams cannot reach
 * them. This harness extracts them verbatim and runs them against a ~20-line
 * fake document: enough to prove the row SHAPE (title / row / badge / ⚠ / cap
 * tail), the click→selectNode re-rooting, and that every string reaches the tree
 * through textContent (the fake element's textContent setter WIPES children, like
 * the real one, so a builder that tried to compose markup would show up here).
 */
function loadDetailsDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  // a bare numeric const has no brace for extractBalanced to balance on:
  // grab the statement verbatim instead
  const capDecl = /var PATH_ROW_CAP = [^\n;]+/.exec(src)
  assert.ok(capDecl, 'app.js must still declare `var PATH_ROW_CAP = …`')
  const body = [
    'var CLICKS = [], SELECTED = []\n',
    'var KEYS = { pathCountLabel: \x27{n}·{d}\x27, pathNoneLabel: \x27NONE\x27, pathDistLabel: \x27d{n}\x27, unsatLabel: \x27UNSAT\x27, mountsLabel: \x27MOUNTS\x27, moreLabel: \x27+{n} MORE\x27,\n'
    + '  peekDeps: \x27PEEK-DEPS\x27, peekDependents: \x27PEEK-UP\x27, peekUnsat: \x27PEEK-UNSAT\x27, peekBroken: \x27PEEK-BROKEN\x27, membersLabel: \x27PEEK-MEMBERS\x27,\n'
    + '  brokenLabel: \x27BROKEN\x27, relatedGroupsLabel: \x27RELGRP({n})\x27, relatedPkgsLabel: \x27RELPKG({n})\x27 }\n',
    'function t(k) { return Object.prototype.hasOwnProperty.call(KEYS, k) ? KEYS[k] : k }\n',
    'function selectNode(id) { SELECTED.push(id) }\n',
    'function El(tag) {\n',
    '  this.tag = tag; this.children = []; this.className = \x27\x27; this.text = \x27\x27; this.handlers = {}; this.hidden = false\n',
    '  this.appendChild = function (c) { this.children.push(c); return c }\n',
    '  this.addEventListener = function (k, fn) { this.handlers[k] = fn; CLICKS.push({ el: this, kind: k, fn: fn }) }\n',
    '}\n',
    'Object.defineProperty(El.prototype, \x27textContent\x27, {\n',
    '  get: function () { return this.text },\n',
    '  set: function (v) { this.text = String(v); this.children.length = 0 },\n',
    '})\n',
    'var document = {\n',
    '  createElement: function (tag) { return new El(tag) },\n',
    '  createTextNode: function (s) { return { tag: \x27#text\x27, text: String(s), children: [], className: \x27\x27 } },\n',
    '}\n',
    'var state = { graph: null, byId: new Map(), groupZone: new Map(), focus: null }\n',
    capDecl[0] + '\n',
    extractBalanced(src, 'var EDGE_KINDS_ALL = [') + '\n',
    extractBalanced(src, 'function escText(el, s) {') + '\n',
    extractBalanced(src, 'function kvRow(box, key, value) {') + '\n',
    extractBalanced(src, 'function secTitle(box, text) {') + '\n',
    extractBalanced(src, 'function pathRow(box, row, onClick) {') + '\n',
    extractBalanced(src, 'function groupRowsByDist(rows) {') + '\n',
    extractBalanced(src, 'function tierBlock(box, tier, open) {') + '\n',
    extractBalanced(src, 'function pathListSection(box, title, rows) {') + '\n',
    extractBalanced(src, 'function mountOutSection(box, id) {') + '\n',
    extractBalanced(src, 'function renderPeek(card, p) {') + '\n',
    extractBalanced(src, 'function buildRelatedGroups(sets, graph, groupsMeta, tier) {') + '\n',
    extractBalanced(src, 'function relatedRow(box, row, onClick) {') + '\n',
    extractBalanced(src, 'function relatedSection(box, rootCardId) {') + '\n',
    'return { El: El, state: state, CLICKS: CLICKS, SELECTED: SELECTED, t: t,\n',
    '  pathListSection: pathListSection, mountOutSection: mountOutSection, renderPeek: renderPeek,\n'
    + '  buildRelatedGroups: buildRelatedGroups, relatedSection: relatedSection, CAP: PATH_ROW_CAP }',
  ].join('')
  return new Function('AtlasModel', body)(loadModel())
}

/** every textContent string in a fake-DOM tree, in document order */
function domTexts(el, out) {
  out = out || []
  if (el.text) out.push(el.text)
  ;(el.children || []).forEach((c) => domTexts(c, out))
  return out
}

/** deepFreeze recursively — a pure helper that writes into graph/view now THROWS. */
function deepFreeze(x) {
  if (x && typeof x === 'object' && !Object.isFrozen(x)) {
    Object.freeze(x)
    for (const k of Object.keys(x)) deepFreeze(x[k])
  }
  return x
}

const setArr = (s) => [...(s || [])]
const sorted = (s) => setArr(s).slice().sort()

// Mini focus graph: chain a—b—c—d; b→c is UNSATISFIED (still a real edge);
// 'iso' has no edges at all.
function focusFixture() {
  return {
    nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }, { id: 'iso' }],
    edges: [
      { from: 'a', to: 'b', kind: 'dep' },
      { from: 'b', to: 'c', kind: 'mount', unsatisfied: true },
      { from: 'c', to: 'd', kind: 'peer-optional' },
    ],
  }
}

// V21 direction fixture: root 'r' with a three-layer down chain, an up chain
// (including the mount reverse climb member ← bundle ← profile), a disconnected
// component and a self-contained cycle pair.
function dirFixture() {
  return {
    nodes: ['r', 'd1', 'd2', 'd3', 'u1', 'u2', 'prof', 'bundle', 'member',
      'side', 'cx', 'cy', 'iso'].map((id) => ({ id })),
    edges: [
      { from: 'r', to: 'd1', kind: 'dep' },            // down layer 1
      { from: 'd1', to: 'd2', kind: 'peer' },          // down layer 2
      { from: 'd2', to: 'd3', kind: 'peer-optional' }, // down layer 3
      { from: 'd1', to: 'd3', kind: 'mount' },         // wrong kind for DOWN
      { from: 'u1', to: 'r', kind: 'dep' },            // up layer 1 (reverse dep)
      { from: 'u2', to: 'u1', kind: 'peer' },          // up layer 2
      { from: 'bundle', to: 'member', kind: 'mount' }, // member's up layer 1
      { from: 'prof', to: 'bundle', kind: 'mount' },   // member's up layer 2 = profile
      { from: 'side', to: 'iso', kind: 'dep' },        // disconnected component
      { from: 'cx', to: 'cy', kind: 'peer' },          // a cycle nothing here reaches
      { from: 'cy', to: 'cx', kind: 'peer' },
    ],
  }
}

// Search fixture: prefix / substring / description-only ranks, plus a
// name-null node (matcher falls back to id) and a non-matching node.
function searchFixture() {
  return {
    nodes: [
      { id: 'n4', name: 'zulu', description: 'The CORE idea' },
      { id: 'n1', name: 'core', description: null },
      { id: 'n2', name: 'core-sync', description: 'misc' },
      { id: 'n3', name: 'pkgcorex', description: 'core also in description' },
      { id: 'n5', name: 'delta', description: 'nothing here' },
      { id: 'n6', name: null, description: null },
    ],
  }
}

// =========================================================================
// Task V2.1 (R35/R36) — bidirectional path sets. These tests INHERIT the whole
// semantic surface of the retired focusNeighbors suite (depth clamping,
// unsatisfied edges as real relationships, root/unknown-root behaviour,
// deterministic insertion order, defensive junk inputs) and extend it with the
// direction asymmetry the undirected BFS could not express.
// =========================================================================

test('V21 normalizeDepth: null/0/junk → unlimited (the shipped default); 1-3 kept, fractions floored', () => {
  const { normalizeDepth } = loadAppPure()
  for (const junk of [null, undefined, 0, -1, -5, NaN, Infinity, '2', true, {}, []]) {
    assert.equal(normalizeDepth(junk), null, `unusable depth ${JSON.stringify(junk)} → unlimited`)
  }
  assert.equal(normalizeDepth(1), 1)
  assert.equal(normalizeDepth(3), 3)
  assert.equal(normalizeDepth(2.6), 2, 'fractions floor')
  assert.equal(normalizeDepth(1.999), 1, 'fractions floor')
  assert.equal(normalizeDepth(99), 3, 'above 3 clamps to 3')
})

test('V21 pathSets: down follows OUT dep/peer/peer-opt only; up climbs IN edges incl. mount', () => {
  const { pathSets } = loadAppPure()
  const s = pathSets(dirFixture(), 'r', null)
  assert.deepEqual(sorted(s.down), ['d1', 'd2', 'd3'],
    'three down layers; d3 arrives over a peer-optional edge — that kind participates')
  assert.deepEqual(sorted(s.up), ['u1', 'u2'], 'up = reverse dep + reverse peer')
  assert.deepEqual(sorted(s.both), [], 'the two universes are disjoint here')
  assert.equal(s.down.has('r'), false, 'the root is never a member of its own path')
  assert.equal(s.up.has('r'), false, 'the root is never a member of its own path')
  assert.equal(s.down.has('member'), false, 'a disconnected chain is not down')
  assert.equal(s.up.has('iso'), false, 'the disconnected component stays out entirely')
  assert.equal(s.down.has('prof'), false, 'a profile is reached through mount only')
})

test('V21 pathSets: mount reverse climb — member ← bundle ← profile all light, layer by layer', () => {
  const { pathSets } = loadAppPure()
  const s = pathSets(dirFixture(), 'member', null)
  assert.deepEqual(sorted(s.up), ['bundle', 'prof'],
    'the mount chain auto-climbs: the bundle AND the profile:web-shaped node')
  assert.deepEqual(sorted(s.down), [], 'mount points the other way: nothing hangs below a member')
  assert.deepEqual(sorted(s.downEdges), [], 'no down edges at all')
  assert.deepEqual(sorted(s.upEdges), ['e:bundle|member|mount', 'e:prof|bundle|mount'],
    'both mount hops are induced up edges')
})

test('V21 pathSets: depth truncates each direction; null is unlimited; >3 clamps', () => {
  const { pathSets } = loadAppPure()
  const g = dirFixture()
  assert.deepEqual(sorted(pathSets(g, 'r', 1).down), ['d1'], 'depth 1 = direct deps')
  assert.deepEqual(sorted(pathSets(g, 'r', 2).down), ['d1', 'd2'], 'depth 2')
  assert.deepEqual(sorted(pathSets(g, 'r', 3).down), ['d1', 'd2', 'd3'], 'depth 3')
  assert.deepEqual(sorted(pathSets(g, 'r', 99).down), ['d1', 'd2', 'd3'], '99 clamps to 3')
  assert.deepEqual(sorted(pathSets(g, 'r', null).down), ['d1', 'd2', 'd3'], 'null = unlimited')
  assert.deepEqual(sorted(pathSets(g, 'r', 1).up), ['u1'], 'depth 1 up')
  assert.deepEqual(sorted(pathSets(g, 'member', 1).up), ['bundle'],
    'the profile is two mount steps up — depth 1 stops at the bundle')
  assert.deepEqual(sorted(pathSets(g, 'member', 2).up), ['bundle', 'prof'], 'depth 2 reaches the profile')
  assert.deepEqual(sorted(pathSets(g, 'r', 99).up), sorted(pathSets(g, 'r', null).up),
    'clamped and unlimited agree once the frontier drains')
  assert.deepEqual(sorted(pathSets(g, 'r', 1).downEdges), ['e:r|d1|dep'],
    'depth also cuts the induced edge set, not just the nodes')
  assert.deepEqual(sorted(pathSets(g, 'r', 2).downEdges), ['e:d1|d2|peer', 'e:r|d1|dep'])
})

test('V21 pathSets: unsatisfied edges are real relationships and are traversed', () => {
  const { pathSets } = loadAppPure()
  const s = pathSets(focusFixture(), 'a', null)
  assert.deepEqual(sorted(s.down), ['b'],
    'a→b dep lights; b→c is a MOUNT edge (R35: never a DOWN kind) so c/d stay below the radar')
  assert.deepEqual(sorted(s.downEdges), ['e:a|b|dep'], 'only the dep edge is a down edge')
  const up = pathSets(focusFixture(), 'd', null)
  assert.deepEqual(sorted(up.up), ['a', 'b', 'c'],
    'reverse BFS crosses the UNSATISFIED b→c mount edge too — the flag is a version note, not an absent relationship')
  assert.deepEqual(sorted(up.upEdges), ['e:a|b|dep', 'e:b|c|mount', 'e:c|d|peer-optional'],
    'the whole reverse chain is induced, unsatisfied flag included')
  const dep = pathSets({
    nodes: [{ id: 'p' }, { id: 'q' }],
    edges: [{ from: 'p', to: 'q', kind: 'dep', unsatisfied: true }],
  }, 'p', null)
  assert.deepEqual(sorted(dep.down), ['q'], 'an unsatisfied DEP edge is still traversed downward')
  assert.deepEqual(sorted(dep.downEdges), ['e:p|q|dep'], 'and joins the induced set')
})

test('V21 pathSets: cycle A↔peer B→A terminates and lands in both', () => {
  const { pathSets } = loadAppPure()
  const g = {
    nodes: [{ id: 'A' }, { id: 'B' }, { id: 'C' }],
    edges: [
      { from: 'A', to: 'B', kind: 'peer' },
      { from: 'B', to: 'A', kind: 'peer' },
      { from: 'B', to: 'C', kind: 'dep' },
      { from: 'C', to: 'A', kind: 'dep' },
    ],
  }
  const s = pathSets(g, 'A', null)
  assert.deepEqual(sorted(s.down), ['B', 'C'], 'BFS terminates on the visited set (no infinite loop)')
  assert.deepEqual(sorted(s.up), ['B', 'C'], 'the same cycle is reachable backwards')
  assert.deepEqual(sorted(s.both), ['B', 'C'], 'every cycle member is both a dependency and a dependent')
  assert.deepEqual(sorted(s.downEdges), ['e:A|B|peer', 'e:B|A|peer', 'e:B|C|dep', 'e:C|A|dep'],
    'the whole cycle is induced over down ∪ {root}')
  assert.deepEqual(sorted(s.upEdges), sorted(s.downEdges), 'and over up ∪ {root} too')
})

test('V21 pathSets: induced-edge rule — kind mismatch and endpoint mismatch stay dark', () => {
  const { pathSets } = loadAppPure()
  const g = {
    nodes: [{ id: 'r' }, { id: 'a' }, { id: 'b' }, { id: 'far' }],
    edges: [
      { from: 'r', to: 'a', kind: 'dep' },
      { from: 'r', to: 'b', kind: 'dep' },
      { from: 'a', to: 'b', kind: 'mount' },   // both endpoints down, WRONG kind
      { from: 'b', to: 'far', kind: 'dep' },   // far leaves the set at depth 1
      { from: 'far', to: 'r', kind: 'mount' },  // points INTO the root: an up edge
    ],
  }
  const s = pathSets(g, 'r', 1)
  assert.deepEqual(sorted(s.down), ['a', 'b'])
  assert.deepEqual(sorted(s.up), ['far'], 'mount is an UP kind: far mounts r, so it sits above r')
  assert.deepEqual(sorted(s.downEdges), ['e:r|a|dep', 'e:r|b|dep'],
    'a→b is a mount edge (not a down kind) and b→far leaves the set — neither lights')
  assert.deepEqual(sorted(s.upEdges), ['e:far|r|mount'],
    'the up universe spans every kind, so only the ENDPOINT rule cuts it here')
  const wide = pathSets(g, 'r', 2)
  assert.deepEqual(sorted(wide.downEdges), ['e:b|far|dep', 'e:r|a|dep', 'e:r|b|dep'],
    'at depth 2 the b→far dep joins the induced set — still no a→b mount edge')
})

test('V21 pathSets: a pair related in both directions lands in both sets (both-colour)', () => {
  const { pathSets } = loadAppPure()
  const g = {
    nodes: [{ id: 'r' }, { id: 'a' }],
    edges: [{ from: 'r', to: 'a', kind: 'dep' }, { from: 'a', to: 'r', kind: 'peer' }],
  }
  const s = pathSets(g, 'r', null)
  assert.deepEqual(sorted(s.down), ['a'])
  assert.deepEqual(sorted(s.up), ['a'])
  assert.deepEqual(sorted(s.both), ['a'], 'intersects to both')
  assert.deepEqual(sorted(s.downEdges), ['e:a|r|peer', 'e:r|a|dep'])
  assert.deepEqual(sorted(s.upEdges), ['e:a|r|peer', 'e:r|a|dep'],
    'the same two edges sit in both edge sets → the renderer paints them both-colour')
})

test('V21 pathSets: empty/defensive inputs yield empty sets, never a throw', () => {
  const { pathSets } = loadAppPure()
  for (const [label, g, root] of [
    ['no graph', null, 'x'],
    ['no edges', {}, 'x'],
    ['malformed edges', { edges: [null, {}, { from: 'x' }, { to: 'y' }] }, 'x'],
  ]) {
    const s = pathSets(g, root, null)
    for (const key of ['down', 'up', 'both', 'downEdges', 'upEdges']) {
      assert.deepEqual([...s[key]], [], `${label}: ${key} empty`)
    }
  }
  const iso = pathSets(focusFixture(), 'iso', null)
  assert.deepEqual([...iso.down], [], 'isolated package: nothing below')
  assert.deepEqual([...iso.up], [], 'isolated package: nothing above')
  const unknown = pathSets(dirFixture(), 'nope', null)
  assert.deepEqual([sorted(unknown.down), sorted(unknown.up)], [[], []], 'unknown root → empty sets')
})

test('V21 pathSets: never mutates graph or view (deep-frozen fixture) and is deterministic', () => {
  const { pathSets } = loadAppPure()
  const frozen = deepFreeze(dirFixture())
  const a = pathSets(frozen, 'r', null)
  const b = pathSets(frozen, 'r', null)
  assert.deepEqual(a, b, 'two calls deep-equal (a frozen fixture proves zero mutation)')
  assert.deepEqual(setArr(a.down), setArr(b.down), 'Set ITERATION ORDER is stable (insertion, not hash)')
  assert.deepEqual(setArr(a.up), setArr(b.up), 'stable iteration order (up)')
  assert.deepEqual(setArr(a.downEdges), setArr(b.downEdges), 'stable iteration order (downEdges)')
  assert.deepEqual(setArr(a.both), setArr(b.both), 'stable iteration order (both)')
  const g = dirFixture()
  const before = JSON.stringify(g)
  pathSets(g, 'r', 2)
  assert.equal(JSON.stringify(g), before, 'a live (unfrozen) graph comes back byte-identical')
})

test('V21 buildPathLists: rows carry dist/kinds/unsat/isProfile, sorted dist then name', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const g = dirFixture()
  g.nodes = [
    { id: 'r', name: 'root-pkg', version: '1.0.0' },
    { id: 'd1', name: 'alpha', version: '2.0.0' },
    { id: 'd2', name: 'beta', version: '1.2.3' },
    { id: 'd3', name: 'gamma', version: '0.1.0' },
    { id: 'u1', name: 'zulu', version: '3.0.0' },
    { id: 'u2', name: 'yankee', version: '1.0.0' },
    { id: 'prof', name: 'web', version: '-', kind: 'profile' },
    { id: 'bundle', name: 'bundle-pkg', version: '1.0.0' },
    { id: 'member', name: 'member-pkg', version: '1.0.0' },
  ]
  g.edges[1].unsatisfied = true // d1 → d2 peer, unsatisfied
  const lists = buildPathLists(pathSets(g, 'r', 2), g, byIdMap(g))
  assert.deepEqual(lists.down.map((r) => [r.id, r.dist, r.kinds, r.unsat]), [
    ['d1', 1, ['dep'], false],
    ['d2', 2, ['peer'], true],
  ], 'dist = BFS layer (1 = direct), kinds = the path-edge kinds, unsat flagged, dist order')
  assert.deepEqual(lists.down.map((r) => [r.name, r.version]), [['alpha', '2.0.0'], ['beta', '1.2.3']],
    'name/version come off the graph node')
  assert.deepEqual(lists.up.map((r) => [r.id, r.dist]), [['u1', 1], ['u2', 2]],
    'the reverse peer puts u2 in layer 2 — dist outranks the name order')
  const lists3 = buildPathLists(pathSets(g, 'r', null), g, byIdMap(g))
  assert.deepEqual(lists3.down.map((r) => [r.id, r.dist]), [['d1', 1], ['d2', 2], ['d3', 3]],
    'unlimited depth reaches layer 3')
  const upMember = buildPathLists(pathSets(g, 'member', null), g, byIdMap(g)).up
  assert.deepEqual(upMember.map((r) => [r.id, r.dist, r.kinds]), [
    ['bundle', 1, ['mount']],
    ['prof', 2, ['mount']],
  ], 'the mount climb lands in the up list with the mount kind, layer by layer')
  assert.equal(upMember[1].isProfile, false,
    'isProfile is ID-driven (a node with kind "profile" but a bare id is not one)')
  const lists2 = buildPathLists(pathSets(g, 'r', 2), g, byIdMap(g))
  assert.deepEqual(lists, lists2, 'deterministic: two calls deep-equal')
})

test('V21 buildPathLists: same-layer rows sort by name; profile ids are looked up by id', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const g = {
    nodes: [
      { id: 'r', name: 'r', version: '1.0.0' },
      { id: 'profile:web', name: 'web', version: '-', kind: 'profile' },
      { id: 'zeta@1.0.0', name: 'zeta', version: '1.0.0' },
      { id: 'alpha@1.0.0', name: 'alpha', version: '1.0.0' },
    ],
    edges: [
      { from: 'profile:web', to: 'r', kind: 'mount' },
      { from: 'zeta@1.0.0', to: 'r', kind: 'dep' },
      { from: 'alpha@1.0.0', to: 'r', kind: 'peer' },
    ],
  }
  const lists = buildPathLists(pathSets(g, 'r', null), g, byIdMap(g))
  assert.deepEqual(lists.up.map((r) => r.name), ['alpha', 'web', 'zeta'],
    'layer 1 sorts by DISPLAY name (web sorts in by its bare name, not by id)')
  assert.deepEqual(lists.up.map((r) => r.isProfile), [false, true, false])
  assert.deepEqual(lists.up.map((r) => r.kinds), [['peer'], ['mount'], ['dep']])
})

test('V21 buildPathLists: a both-direction member appears in BOTH lists with its own kinds', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const g = {
    nodes: [
      { id: 'r', name: 'r', version: '1.0.0' },
      { id: 'p@1.0.0', name: 'p', version: '1.0.0' },
    ],
    edges: [
      { from: 'r', to: 'p@1.0.0', kind: 'dep' },
      { from: 'p@1.0.0', to: 'r', kind: 'peer' },
    ],
  }
  const lists = buildPathLists(pathSets(g, 'r', null), g, byIdMap(g))
  assert.equal(lists.down.length, 1, 'down list has p …')
  assert.equal(lists.up.length, 1, '… and the up list has it too')
  assert.deepEqual(lists.down[0].kinds, ['dep'], 'the down row reports the kind that reaches it')
  assert.deepEqual(lists.up[0].kinds, ['peer'], 'the up row reports its own reaching kind')
  assert.equal(lists.down[0].dist, 1)
  assert.equal(lists.up[0].dist, 1)
})

test('V21 buildPathLists: empty sets → two empty lists; junk inputs stay empty, never throw', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const g = focusFixture() // 'iso' here has NO edges at all (dirFixture's iso has a dependents side)
  const empty = buildPathLists(pathSets(g, 'iso', null), g, byIdMap(g))
  assert.deepEqual(empty, { down: [], up: [] }, 'isolated package → two empty lists')
  assert.deepEqual(buildPathLists(null, g, byIdMap(g)), { down: [], up: [] }, 'no sets → empty')
  assert.deepEqual(buildPathLists({ rootId: 'r' }, null, null), { down: [], up: [] },
    'no graph / no byId → empty, never a throw')
  const dangling = buildPathLists({ rootId: 'a', down: new Set(['ghost']), up: new Set(), downEdges: new Set(), upEdges: new Set() }, g, byIdMap(g))
  assert.deepEqual(dangling, { down: [], up: [] }, 'a member with no reaching edge is not on any path → dropped')
})

// ---------- V21: the f-* class algebra applyClasses writes (fake cytoscape) ----------

test('V21 details DOM: path rows are built with textContent only, click re-roots, empty says 无', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const dom = loadDetailsDom()
  const evil = '<img src=x onerror=alert(1)>'
  const graph = {
    nodes: [
      { id: 'r', name: 'root-pkg', version: '1' },
      { id: 'x', name: evil, version: '<script>' },
      { id: 'b', name: 'beta', version: '2' },
      { id: 'y', name: 'yonder', version: '3' },
    ],
    edges: [
      { from: 'r', to: 'x', kind: 'dep' },
      { from: 'r', to: 'b', kind: 'peer', unsatisfied: true },
      { from: 'x', to: 'y', kind: 'dep' },  // layer 2: proves the header's deepest
      { from: 'r', to: 'z', kind: 'mount' },
      { from: 'r', to: 'z2', kind: 'mount' },
      { from: 'r', to: 'z', kind: 'mount' }, // duplicate pair: one row
      { from: 'r', to: 'b', kind: 'dep' },   // second kind to the same node
    ],
  }
  dom.state.graph = graph
  dom.state.byId = byIdMap(graph)
  const lists = buildPathLists(pathSets(graph, 'r', null), graph, dom.state.byId)
  assert.deepEqual(lists.down.map((rw) => rw.id), ['x', 'b', 'y'], 'layer 1 by name, then layer 2')

  const box = new dom.El('div')
  dom.pathListSection(box, 'DOWN', lists.down)
  // V22b tiering: title + (header + body) per layer; d1 open, d2+ collapsed.
  assert.equal(box.children.length, 5, 'title + two tiers × (header + body) — [x d1, b d1, y d2]')
  assert.equal(box.children[0].className, 'sec', 'title row')
  assert.equal(box.children[0].text, 'DOWN · 3·2', 'header = title · {n} rows · deepest {d} layer')
  const head1 = box.children[1]
  assert.equal(head1.className, 'tier', 'V22b: per-layer segment header')
  assert.equal(head1.text, '▾ d1 (2)', 'd1 is the one tier expanded by default; header shows d{layer} (N)')
  const body1 = box.children[2]
  assert.equal(body1.className, 'tier-body'); assert.equal(body1.hidden, false, 'd1 open by default')
  assert.equal(body1.children.length, 2, 'the two layer-1 rows')
  const head2 = box.children[3]
  assert.equal(head2.text, '▸ d2 (1)', 'd2 starts collapsed (▸)')
  const body2 = box.children[4]
  assert.equal(body2.hidden, true, 'V22b: d2+ tiers default-collapsed')
  assert.equal(body2.children.length, 1, 'the single layer-2 row sits inside the collapsed body')
  const row = body1.children[0]
  assert.equal(row.className, 'jump', 'rows reuse the .jump row class (no new CSS surface)')
  assert.equal(row.children[0].text, evil + '@<script>', 'attacker name@version survive VERBATIM as text')
  assert.equal(row.children[1].className, 'dist')
  assert.equal(row.children[1].text, ' · d1', 'the BFS layer token renders through t(pathDistLabel)')
  assert.deepEqual(row.children.filter((c) => c.className === 'badge').map((c) => c.text), ['dep'], 'kind badge')
  assert.deepEqual(body1.children[1].children.filter((c) => c.className === 'badge').map((c) => c.text),
    ['dep', 'peer'], 'a second kind reaches the same row as its own badge, in EDGE_KINDS order')
  assert.equal(body1.children[1].children.slice(2).map((c) => [c.className, c.text]).slice(-1)[0][1], ' ⚠ UNSAT',
    'the unsatisfied flag rides the existing .unsat span')

  const texts = domTexts(box)
  assert.equal(texts.filter((s) => s.includes(evil)).length, 1,
    'the attacker string reaches the tree exactly once, as TEXT — never composed as markup')
  assert.equal(JSON.stringify(box).includes('innerHTML'), false, 'no innerHTML anywhere in the built tree')

  const betaBtn = body1.children[1]
  assert.equal(betaBtn.handlers.click instanceof Function, true, 'rows are clickable')
  betaBtn.handlers.click()
  assert.deepEqual(dom.SELECTED, ['b'], 'clicking a row calls selectNode(row.id) → the focus re-roots there')

  head2.handlers.click()
  assert.equal(body2.hidden, false, 'V22b: clicking the d2 header opens the tier')
  assert.equal(head2.text, '▾ d2 (1)', '…and the arrow flips')
  head2.handlers.click()
  assert.equal(body2.hidden, true, '…and closes again')

  const empty = new dom.El('div')
  dom.pathListSection(empty, 'UP', [])
  assert.equal(empty.children.length, 1, 'an empty list still renders its heading')
  assert.equal(empty.children[0].text, 'UP · NONE', '…with 「无」 (pathNoneLabel)')

  const mounts = new dom.El('div')
  dom.mountOutSection(mounts, 'r')
  assert.equal(mounts.children.length, 3, 'title + the 2 mount targets (the duplicate pair deduped)')
  assert.equal(mounts.children[0].text, 'MOUNTS · 2', 'the bundle surface keeps its own labelled block')
  assert.equal(mounts.children[1].children.some((c) => c.className === 'dist'), false,
    'mount rows are not path rows: no layer token')
  assert.deepEqual(mounts.children[1].children.filter((c) => c.className === 'badge').map((c) => c.text), ['mount'],
    '…but the mount kind still shows as its badge')
  const noMounts = new dom.El('div')
  dom.mountOutSection(noMounts, 'x')
  assert.deepEqual(noMounts.children, [], 'a node with no mount out-edges gets no section')

  const wide = { nodes: [{ id: 'r', name: 'r' }], edges: [] }
  for (let i = 0; i < dom.CAP + 1; i++) {
    wide.nodes.push({ id: 'm' + i, name: 'm' + i })
    wide.edges.push({ from: 'r', to: 'm' + i, kind: 'dep' })
  }
  dom.state.graph = wide
  dom.state.byId = byIdMap(wide)
  const bigBox = new dom.El('div')
  dom.pathListSection(bigBox, 'DOWN', buildPathLists(pathSets(wide, 'r', null), wide, dom.state.byId).down)
  assert.equal(bigBox.children.length, 3, 'title + one tier (header + body) — all rows are layer 1')
  assert.equal(bigBox.children[1].text, '▾ d1 (' + (dom.CAP + 1) + ')', 'the tier header counts every row it holds')
  const tierBody = bigBox.children[2]
  assert.equal(tierBody.children.length, dom.CAP + 1, 'per-tier cap: rows + the +N 更多 tail')
  assert.equal(tierBody.children[tierBody.children.length - 1].children[1].text, '+1 MORE',
    'the cap tail counts what it hid')
})


test('V21 applyClasses: members take f-down/f-up/f-both, the root stays plain, ancestors never dim', () => {
  const Model = loadModel()
  const graph = fixture()
  const logic = loadFocusLogic()
  const els = paintElements(Model, graph, { collapsedGroups: new Set() })
  const cy = makeFakeCy(els)
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: A1, depth: null }, selected: A1,
  })
  const cls = (id) => cy.classesOf(id)
  assert.ok(cls(U1).includes('f-down'), 'U1 is a direct dependency → f-down')
  assert.ok(!cls(U1).includes('f-up'), 'U1 is not depended-upon by the root')
  assert.ok(cls(V1).includes('dim'), 'the vendor lib (depends on U1, unrelated to A1) dims')
  assert.ok(cls(F1).includes('dim'),
    'R35 ruling: a mount edge A1→F1 is not a DOWN kind and points away upward → F1 stays out')
  assert.ok(cls(X1).includes('f-both'), 'X1 depends on the root AND is depended on → f-both')
  assert.ok(!cls(X1).includes('f-down') && !cls(X1).includes('f-up'),
    'f-both is exclusive — exactly one direction class per node')
  assert.ok(cls(WB).includes('f-up'), 'profile:web mounts the root → f-up')
  assert.ok(cls(B1).includes('f-up'), 'a broken pkg that depends on the root → f-up')
  assert.ok(cls(L1).includes('dim'), 'an unrelated package dims out')
  assert.ok(!cls(L1).includes('f-down') && !cls(L1).includes('f-up'), 'dimmed nodes carry no direction')
  assert.ok(cls(A1).includes('selected') && cls(A1).includes('in-focus'), 'root keeps selected/in-focus')
  assert.ok(!cls(A1).includes('dim'), 'the root never dims')
  for (const c of ['f-down', 'f-up', 'f-both']) assert.ok(!cls(A1).includes(c), `the root carries no ${c}`)
  assert.ok(cls('g:bundle').includes('in-focus') && !cls('g:bundle').includes('dim'),
    'the root group container follows its member (never dimmed)')
  assert.ok(cls('cat:kernel').includes('in-focus') && !cls('cat:kernel').includes('dim'),
    'and so does the zone shell')
  assert.ok(cls('cat:plugin').includes('in-focus'), 'the plugin zone hosts a focused member')
  // a stale run must not leave any focus class behind (removeClass covers all nine)
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: null, selected: null,
  })
  for (const el of els) {
    for (const c of ['dim', 'in-focus', 'selected', 'f-down', 'f-up', 'f-both',
      'f-e-down', 'f-e-up', 'f-e-both']) {
      assert.ok(!cy.classesOf(el.data.id).includes(c), `cleared run leaves no ${c} on ${el.data.id}`)
    }
  }
})

test('V21 applyClasses: a collapsed view maps each member onto its group card / zone shell', () => {
  const Model = loadModel()
  const graph = fixture()
  const logic = loadFocusLogic()
  const cy = makeFakeCy(paintElements(Model, graph, {})) // default: every group collapsed
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: A1, depth: null }, selected: 'g:bundle',
  })
  assert.ok(cy.classesOf('g:util').includes('f-down'), 'U1 collapsed → its card g:util is f-down')
  assert.ok(cy.classesOf('g:plugin').includes('f-both'), 'X1 is both → the card is f-both')
  assert.ok(cy.classesOf('g:profiles').includes('f-up'), 'the profile card is f-up')
  assert.ok(cy.classesOf('g:bundle').includes('in-focus'), "the root's own card stays in-focus")
  assert.ok(!cy.classesOf('g:bundle').includes('dim'), "the root's own card never dims")
  for (const c of ['f-down', 'f-up', 'f-both']) {
    assert.ok(!cy.classesOf('g:bundle').includes(c), `the root's card carries no direction class (${c})`)
  }
  assert.ok(!cy.classesOf('cat:kernel').includes('dim'), 'zone shell above a kept card never dims')
})

test('V21 applyClasses: edges light f-e-down/f-e-up/f-e-only, induced-subgraph only', () => {
  const Model = loadModel()
  const graph = fixture()
  const logic = loadFocusLogic()
  const view = { collapsedGroups: new Set(), showRealCross: true }
  const cy = makeFakeCy(paintElements(Model, graph, view))
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: A1, depth: null }, selected: A1,
  })
  const real = (s, t, k) => `e:${s}|${t}|${k}`
  assert.ok(cy.classesOf(real(A1, U1, 'dep')).includes('f-e-down'), 'A1→U1 dep is a down edge')
  assert.ok(cy.classesOf(real(A1, X1, 'peer')).includes('f-e-both'),
    'A1→X1 peer sits in both edge sets (peer-optional back edge) → both colour')
  assert.ok(cy.classesOf(real(WB, A1, 'mount')).includes('f-e-up'), 'the profile mount edge is up')
  assert.ok(cy.classesOf(real(B1, A1, 'dep')).includes('f-e-up'), 'broken→root dep is up')
  assert.ok(cy.classesOf(real(A1, F1, 'mount')).includes('dim'),
    'the A1→F1 mount edge is not induced by either universe → dims')
  assert.ok(cy.classesOf(real(V1, U1, 'dep')).includes('dim'), 'a wholly unrelated edge dims')
  assert.ok(!cy.classesOf(real(A1, U1, 'dep')).includes('f-e-up'), 'a down edge takes no up colour')
})

/**
 * Fix-round-1 fixtures: the rendered-vs-pure contradiction. Every node is a
 * package in a single kernel zone; one-zone-one-group renders it all-expanded
 * (real cross edges), the four-group variant renders it as group CARDS
 * (aggregate edges) when the view collapses groups by default.
 */
function miniNode(id, group) {
  return {
    id, kind: 'package', name: id, version: '1.0.0', scope: 'official', group, category: 'kernel',
    path: '$DSH_HOME\\x', description: null, servicesRequired: [], externalDeps: [],
    mountedBy: [], flags: { unreadable: false },
  }
}
function miniGraph(groups, nodes, edges) {
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }],
    profiles: [],
    groups: groups.map((g) => ({ id: g, kind: 'official', category: 'kernel', packageCount: 1 })),
    nodes, edges,
  }
}
// a→b carries BOTH a dep and a mount edge; bnd→x is a bundle's mount-out edge.
// In both cases the two endpoints are DOWN members, which is exactly what the
// old endpoint-only rule mistook for a down edge.
function mountPairGraph() {
  return miniGraph(['g1'], [miniNode('r', 'g1'), miniNode('a', 'g1'), miniNode('b', 'g1'),
    miniNode('bnd', 'g1'), miniNode('x', 'g1')], [
    { from: 'r', to: 'a', kind: 'dep' },
    { from: 'a', to: 'b', kind: 'dep' },
    { from: 'a', to: 'b', kind: 'mount' },   // wrong kind between two down members
    { from: 'r', to: 'bnd', kind: 'dep' },
    { from: 'r', to: 'x', kind: 'dep' },     // makes x a down member on its own path
    { from: 'bnd', to: 'x', kind: 'mount' }, // bundle mount-out: never colored (R37)
  ])
}
// One package per group: collapsed, every edge renders as an aggregate whose
// data.kind is the DOMINANT kind of its bucket.
function aggMountGraph() {
  return miniGraph(['gr', 'gb', 'gx', 'gy', 'gp'], [miniNode('r', 'gr'), miniNode('b', 'gb'),
    miniNode('x', 'gx'), miniNode('y', 'gy'), miniNode('p', 'gp')], [
    { from: 'r', to: 'b', kind: 'dep' },
    { from: 'r', to: 'x', kind: 'dep' },
    { from: 'x', to: 'y', kind: 'dep' },
    { from: 'b', to: 'x', kind: 'mount' },  // aggregate mount between two DOWN cards
    { from: 'p', to: 'r', kind: 'mount' },  // aggregate mount on the UP side (p → root)
  ])
}

test('V21 fix1 (R37): a real edge takes its direction from pathSets, not endpoint membership', () => {
  const Model = loadModel()
  const logic = loadFocusLogic()
  const { pathSets } = loadAppPure()
  const graph = mountPairGraph()
  const cy = makeFakeCy(paintElements(Model, graph, { collapsedGroups: new Set(), showRealCross: true }))
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: 'r', depth: null }, selected: 'r',
  })
  const real = (s, t, k) => `e:${s}|${t}|${k}`
  const sets = pathSets(graph, 'r', null)
  // the seam the fix leans on: AtlasModel's real-cross id IS the pathSets key
  assert.ok(sets.downEdges.has(real('a', 'b', 'dep')),
    'pathSets keys the dep edge with the model id (graph-model.js buildView)')
  assert.ok(!sets.downEdges.has(real('a', 'b', 'mount')),
    'R37: a mount edge is in NO down-edge set, whatever its endpoints are')

  assert.ok(cy.classesOf(real('a', 'b', 'dep')).includes('f-e-down'), 'the dep edge lights amber')
  for (const id of [real('a', 'b', 'mount'), real('bnd', 'x', 'mount')]) {
    const c = cy.classesOf(id)
    assert.ok(c.includes('in-focus'), `${id} sits inside the induced subgraph → stays visible`)
    for (const f of ['f-e-down', 'f-e-up', 'f-e-both']) {
      assert.ok(!c.includes(f), `R37: ${id} carries no direction colour (${f})`)
    }
  }
})

test('V21 fix1 (R37): aggregate edges take the kind-aware rule (agg mount between down cards stays dark)', () => {
  const Model = loadModel()
  const logic = loadFocusLogic()
  const graph = aggMountGraph()
  // R43 (V2.4a): the BASE path no longer emits aggregates, so the agg elements
  // this rule must keep coloring are the g: focus ones task B wires up. They are
  // layered onto the (unchanged) model node set in the g: focus emission shape
  // (V24-05 pins that shape in the model) — the applyClasses agg branch itself
  // is untouched and stays pinned here.
  const els = paintElements(Model, graph, {})
  const mkAgg = (s, t, kind, count) => ({
    group: 'edges', classes: ['e-agg', 'e-' + kind],
    data: { id: `agg:g:${s}|g:${t}`, source: `g:${s}`, target: `g:${t}`, count, kind },
  })
  els.push(mkAgg('gr', 'gb', 'dep', 1), mkAgg('gr', 'gx', 'dep', 1), mkAgg('gx', 'gy', 'dep', 1),
    mkAgg('gb', 'gx', 'mount', 1), mkAgg('gp', 'gr', 'mount', 1))
  const cy = makeFakeCy(els)
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: 'r', depth: null }, selected: 'g:gr',
  })
  const agg = (s, t) => `agg:g:${s}|g:${t}`
  // Pinned behavior (R37): an aggregate edge has no raw pathSets key, so the
  // kind half comes from data.kind (the dominant kind) and the endpoint half
  // from the SAME container-membership predicate the nodes use — a group card
  // counts as a member of the side its mapped members sit on, and the root's
  // own card counts on both sides. Hence: mount never down, dep never up.
  assert.ok(cy.classesOf(agg('gr', 'gb')).includes('f-e-down'), 'root card → down card dep lights amber')
  assert.ok(cy.classesOf(agg('gx', 'gy')).includes('f-e-down'), 'down card → down card dep lights amber')
  const c = cy.classesOf(agg('gb', 'gx'))
  assert.ok(c.includes('in-focus'), 'the aggregate mount edge stays visible (both cards kept)')
  for (const f of ['f-e-down', 'f-e-up', 'f-e-both']) {
    assert.ok(!c.includes(f), `R37: agg mount between two down containers carries no direction colour (${f})`)
  }
  assert.ok(cy.classesOf(agg('gp', 'gr')).includes('f-e-up'),
    'mount IS an up kind: the p→root card aggregate lights teal (both sides of the gate hold)')
})

test('V21 applyClasses: depth reaches the class algebra', () => {
  const Model = loadModel()
  const graph = fixture()
  const logic = loadFocusLogic()
  const cy = makeFakeCy(paintElements(Model, graph, { collapsedGroups: new Set() }))
  const st = { cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph), selected: A1 }
  logic.apply({ ...st, focus: { rootId: A1, depth: 1 } })
  assert.ok(cy.classesOf(U1).includes('f-down'), 'direct dep still lit at depth 1')
  assert.ok(cy.classesOf(WB).includes('f-up'), 'the mount climb is layer 1 → lit at depth 1')
  logic.apply({ ...st, focus: { rootId: A1, depth: null } })
  assert.ok(cy.classesOf(U1).includes('f-down'), 'and at unlimited depth')
  // depth 1 must not leave a deeper layer lit: a graph where that distinction bites
  const deep = {
    nodes: [{ id: 'x', kind: 'package', name: 'x' }, { id: 'y', kind: 'package', name: 'y' },
      { id: 'z', kind: 'package', name: 'z' }],
    edges: [{ from: 'x', to: 'y', kind: 'dep' }, { from: 'y', to: 'z', kind: 'dep' }],
  }
  const cy2 = makeFakeCy(deep.nodes.map((n) => ({
    group: 'nodes', data: { id: n.id, kind: 'pkg', name: n.id, x: 0, y: 0 }, classes: ['pkg', 'sk-package'],
  })))
  const deepState = { cy: cy2, graph: deep, byId: byIdMap(deep), groupZone: new Map(), selected: 'x' }
  logic.apply({ ...deepState, focus: { rootId: 'x', depth: 1 } })
  assert.ok(cy2.classesOf('y').includes('f-down'), 'layer 1 lights')
  assert.ok(cy2.classesOf('z').includes('dim'), 'layer 2 stays out at depth 1')
  logic.apply({ ...deepState, focus: { rootId: 'x', depth: null } })
  assert.ok(cy2.classesOf('z').includes('f-down'), 'unlimited depth reaches layer 2')
})

test('V6 matchNodes: name-prefix > name-substring > description-only, then name asc, case-insensitive', () => {
  const { matchNodes } = loadAppPure()
  const g = searchFixture()
  const ids = (q, lim) => matchNodes(g, q, lim).map((n) => n.id)
  assert.deepEqual(ids('core'), ['n1', 'n2', 'n3', 'n4'],
    'prefix ("core" < "core-sync" by name) → substring → description-only')
  assert.deepEqual(ids('CORE'), ['n1', 'n2', 'n3', 'n4'], 'query is lower-cased')
  assert.deepEqual(ids('sync'), ['n2'], 'name substring alone')
  assert.deepEqual(ids('idea'), ['n4'], 'description-only hit still matches')
  assert.deepEqual(ids('zzz'), [], 'no match → []')
  assert.deepEqual(matchNodes(g, 'core')[0].name, 'core', 'rank wins over array position (n3 listed before n4)')
  assert.deepEqual(matchNodes(null, 'core'), [], 'defensive: no graph → []')
})

test('V6 matchNodes: empty query → []; limit honored; non-positive limit falls back to the 40 cap', () => {
  const { matchNodes } = loadAppPure()
  const g = searchFixture()
  for (const q of ['', '   ', null, undefined]) {
    assert.deepEqual(matchNodes(g, q), [], `blank-ish query ${JSON.stringify(q)} → []`)
  }
  assert.deepEqual(matchNodes(g, 'core', 2).map((n) => n.id), ['n1', 'n2'], 'limit=2 honored')
  assert.deepEqual(matchNodes(g, 'core', 1).map((n) => n.id), ['n1'], 'limit=1 honored')
  assert.equal(matchNodes(g, 'core', 0).length, 4, 'limit 0 → default (no truncation at 4 hits)')
  assert.equal(matchNodes(g, 'core', -3).length, 4, 'negative limit → default')
  const many = { nodes: Array.from({ length: 42 }, (_x, i) => ({ id: 'i' + i, name: 'k' + i, description: null })) }
  assert.equal(matchNodes(many, 'k').length, 40, 'default cap is 40')
  assert.equal(matchNodes(many, 'k', 999).length, 42, 'explicit limit above the hit count is respected')
})

test('V6 progressFor: idle/scanning → bar frame with floored+clamped pct; ready/failed/junk → null', () => {
  const { progressFor } = loadAppPure()
  for (const junk of [null, undefined, 'x', 42, true]) {
    assert.equal(progressFor(junk), null, `non-object ${JSON.stringify(junk)} → null`)
  }
  assert.equal(progressFor({ state: 'ready' }), null, 'ready → hide the bar')
  assert.equal(progressFor({ state: 'failed', error: 'e-scan-failed' }), null, 'failed → hide the bar')
  assert.deepEqual(progressFor({ state: 'idle' }),
    { state: 'idle', phase: null, pct: 0, scanned: 0, total: 0 }, 'idle → zeroed frame')
  assert.deepEqual(progressFor({ state: 'booting' }),
    { state: 'idle', phase: null, pct: 0, scanned: 0, total: 0 }, 'any non-terminal state → idle frame')
  assert.deepEqual(progressFor({ state: 'scanning', phase: 'manifests', scanned: 30, total: 120 }),
    { state: 'scanning', phase: 'manifests', pct: 25, scanned: 30, total: 120 }, 'pct = floor(scanned/total·100)')
  assert.equal(progressFor({ state: 'scanning', scanned: 1, total: 3 }).pct, 33, 'floored, not rounded')
  assert.equal(progressFor({ state: 'scanning', scanned: 150, total: 100 }).pct, 100, 'clamped to 100')
  assert.equal(progressFor({ state: 'scanning', scanned: 5, total: 0 }).pct, 0, 'unknown total → pct 0')
  assert.deepEqual(progressFor({ state: 'scanning', scanned: -5, total: 10 }),
    { state: 'scanning', phase: null, pct: 0, scanned: 0, total: 10 }, 'negative scanned → 0')
  assert.equal(progressFor({ state: 'scanning', scanned: '12', total: 10 }).scanned, 0, 'non-numeric → 0')
  assert.equal(progressFor({ state: 'scanning', scanned: Infinity, total: 10 }).pct, 0, 'non-finite scanned → 0')
  assert.equal(progressFor({ state: 'scanning', scanned: 5, total: NaN }).total, 0, 'non-finite total → 0 → pct 0')
})

test('V6 edgeKindsFor: all kinds checked → null (model "all pass"); anything else → Set of checked kinds only', () => {
  const { edgeKindsFor, EDGE_KINDS_ALL } = loadAppPure()
  assert.deepEqual(EDGE_KINDS_ALL, ['dep', 'mount', 'peer', 'peer-optional'], 'the four kinds lib/scan.js emits')
  assert.equal(edgeKindsFor(['dep', 'mount', 'peer', 'peer-optional']), null, 'all checked → null')
  assert.equal(edgeKindsFor(['peer', 'dep', 'peer-optional', 'mount']), null, 'order-independent')
  assert.equal(edgeKindsFor(['dep', 'mount', 'peer', 'peer-optional', 'zzz']), null, 'extras cannot break all-checked')
  const sub = edgeKindsFor(['dep', 'peer'])
  assert.ok(sub instanceof Set, 'subset → Set')
  assert.deepEqual([...sub], ['dep', 'peer'], 'checked kinds only')
  assert.equal(sub.has('mount'), false, 'unchecked kind excluded')
  assert.equal(edgeKindsFor([]).size, 0, 'nothing checked → EMPTY Set (passes nothing — deliberate, NOT null)')
  assert.equal(edgeKindsFor(null).size, 0, 'non-array → empty Set')
  assert.equal(edgeKindsFor('dep').size, 0, 'string is not an array → empty Set')
  assert.deepEqual([...edgeKindsFor(['dep', 'dep', 'mount'])], ['dep', 'mount'], 'duplicates collapse')
  assert.deepEqual([...edgeKindsFor(['dep', 'zzz'])], ['dep', 'zzz'], 'foreign kinds survive in a subset')
})

test('V6 controls → view: every index.html control id is referenced by app.js and writes its view field', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  // the brief checklist (its #profile-filter appears twice there — deduplicated)
  const ids = ['scope-filter', 'profile-filter', 'edge-kinds', 'show-real-cross', 'zone-chips',
    'focus-depth', 'focus-clear', 'lang-btn', 'search', 'refresh']
  for (const id of ids) {
    assert.ok(html.includes(`id="${id}"`), `index.html declares #${id}`)
    // referenced either as a getElementById string or as a (possibly compound)
    // CSS selector string: '#edge-kinds input[data-kind]' etc.
    const wired = src.includes(`'${id}'`) || src.includes(`'#${id}'`) || src.includes(`'#${id} `)
    assert.ok(wired, `app.js references #${id}`)
  }
  // the mapping itself: each handler mutates exactly its view field, paint renders it
  assert.match(src, /state\.view\.filterScope = scope\.value \|\| 'all'/, '#scope-filter → filterScope')
  assert.match(src, /state\.view\.filterProfile = prof\.value \|\| null/, '#profile-filter → filterProfile')
  assert.match(src, /state\.view\.showRealCross = !!cross\.checked/, '#show-real-cross → showRealCross')
  assert.match(src, /state\.view\.edgeKinds = edgeKindsFor\(kinds\)/, '#edge-kinds → edgeKinds via edgeKindsFor()')
  assert.match(src, /state\.view\.filterCats\.has\(id\)\) state\.view\.filterCats\.delete\(id\); else state\.view\.filterCats\.add\(id\)/,
    '#zone-chips → filterCats EXCLUSION toggle (R32: dim chip = hidden zone)')
  assert.match(src, /state\.focus = \{ rootId: rootId, depth: d \}/, 'focus wiring sets state.focus {rootId, depth}')
  assert.match(src, /state\.focus = null/, '#focus-clear clears state.focus')
  assert.match(src, /state\.lang = state\.lang === 'zh' \? 'en' : 'zh'/, '#lang-btn drives state.lang (V6: the switch is live)')
})

test('V6 i18n parity: every t() literal, dynamic key, and data-i18n attribute resolves in zh AND en', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const I18N = new Function(extractBalanced(src, 'var I18N = {') + '\nreturn I18N')()
  assert.ok(I18N.zh && I18N.en, 'table carries zh + en entries')
  assert.deepEqual(Object.keys(I18N.zh).sort(), Object.keys(I18N.en).sort(), 'zh and en key SETS are equal')

  const used = new Set()
  let m
  // bare t('key') calls — the boundary class keeps escText('…')/createElement('…')
  // (whose names also end in t + paren) from masquerading as i18n lookups
  const reT = /(?:^|[^A-Za-z0-9_$.])t\('([A-Za-z][A-Za-z0-9]*)'\)/g
  while ((m = reT.exec(src))) used.add(m[1])
  // the two DYNAMIC call sites: scope-option table pairs + progressText phase map
  const rePair = /\['(?:all|official|third-party)', '([A-Za-z][A-Za-z0-9]*)'\]/g
  while ((m = rePair.exec(src))) used.add(m[1])
  const rePhase = /'(phase[A-Za-z0-9]+)'/g
  while ((m = rePhase.exec(src))) used.add(m[1])
  // static chrome strings: index.html data-i18n(-ph|-title) attributes
  const reAttr = /data-i18n(?:-ph|-title)?="([A-Za-z][A-Za-z0-9]*)"/g
  while ((m = reAttr.exec(html))) used.add(m[1])

  assert.ok(used.size >= 30, `the scan must find the full key surface (got ${used.size})`)
  for (const k of [...used].sort()) {
    assert.ok(Object.prototype.hasOwnProperty.call(I18N.zh, k), `zh entry for "${k}"`)
    assert.ok(Object.prototype.hasOwnProperty.call(I18N.en, k), `en entry for "${k}"`)
  }
})

test('V6 css guards: #legend is clickable again; #focus-ctl[hidden] and #progress-bar[hidden] stay display:none', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const legendRule = /#legend\s*\{[^}]*\}/.exec(css)
  assert.ok(legendRule, 'style.css styles #legend')
  // V5 shipped pointer-events:none (decorative + empty); V6 puts the collapse
  // button INSIDE #legend — clicks must reach it.
  assert.doesNotMatch(legendRule[0], /pointer-events:\s*none/, '#legend must accept clicks (legend collapse lives there now)')
  assert.match(css, /#legend:empty\s*\{\s*display:\s*none/, '#legend:empty still collapses when unpopulated (V5)')
  // V2.7 R52: the legend anchors on the LEFT of the pane (right:10px is history)
  assert.match(legendRule[0], /left:\s*10px/, 'R52: #legend pins left')
  assert.doesNotMatch(legendRule[0], /right:\s*\d/, 'R52: no right anchor survives')
  // #focus-ctl declares display:inline-flex, which beats the UA [hidden] rule —
  // the override must exist or the focus chip shows while state.focus is null.
  assert.match(css, /#focus-ctl\s*\{[^}]*display:\s*inline-flex/, '#focus-ctl base display')
  assert.match(css, /#focus-ctl\[hidden\]\s*\{[^}]*display:\s*none/, 'the [hidden] override exists')
  assert.match(html, /id="focus-ctl"\s+hidden/, 'focus control ships hidden')
  // the V5-pinned progress rule survives V6 verbatim (showProgress toggles .hidden)
  assert.ok(css.includes('#progress-bar[hidden] { display: none; }'), '#progress-bar[hidden] rule verbatim')
  assert.match(css, /#progress-bar\s*\{[^}]*display:\s*flex/, 'and it still displays when un-hidden')
})

test('V6 XSS re-sweep: the banned HTML sinks appear nowhere in app.js (code or comments)', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  assert.doesNotMatch(src, /\.innerHTML|\.outerHTML|insertAdjacentHTML|createContextualFragment|document\.write/,
    'DOM writes go through textContent/createTextNode only (front-end XSS discipline)')
  // V2.3 widens the sweep to the code-generation sinks too (the member list is a
  // NEW render surface for attacker-controlled names — the ban covers the WHOLE
  // file, not just the new lines).
  assert.doesNotMatch(src, /\beval\s*\(|new\s+Function\s*\(/,
    'no code-generation sink anywhere: nothing built from data can be executed')
})

// =========================================================================
// Task V2.1 (R35/R36) — bidirectional dependency paths.
// The pure half (pathSets/buildPathLists) is above; this section pins the
// visual half: the direction palette, the RULE ORDER that lets a focus color
// beat a kind color, the real frozen dist reading the result back off
// cytoscape, plus the control/i18n/README wiring R35 prescribes.
// =========================================================================

/** Compact renderable path graph: one zone, one group, all-expanded rendering. */
function pathGraph() {
  const n = (id) => ({
    id, kind: 'package', name: id, version: '1.0.0', scope: 'official', group: 'g1', category: 'kernel',
    path: '$DSH_HOME\\x', description: null, servicesRequired: [], externalDeps: [],
    mountedBy: [], flags: { unreadable: false },
  })
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }],
    profiles: [], groups: [{ id: 'g1', kind: 'official', category: 'kernel', packageCount: 5 }],
    nodes: [n('r'), n('d1'), n('d2'), n('u1'), n('p1')],
    edges: [
      { from: 'r', to: 'd1', kind: 'dep' },
      { from: 'd1', to: 'd2', kind: 'peer' },   // dashed AND downward = the ruling pin
      { from: 'u1', to: 'r', kind: 'dep' },
      { from: 'p1', to: 'u1', kind: 'mount' },
    ],
  }
}

/** applyClasses' output replayed onto the element list it was handed. */
function classesApplied(Model, graph, view, focus, selected, stateView) {
  const logic = loadFocusLogic()
  const els = paintElements(Model, graph, view)
  const fake = makeFakeCy(els)
  const apply0 = { cy: fake, graph, byId: byIdMap(graph), groupZone: zoneTable(graph), focus, selected }
  // V2.4b: the group-focus branch reads view.granularity — hand the app-state view in when the test cares
  if (stateView) apply0.view = stateView
  logic.apply(apply0)
  return {
    fake,
    elements: els.map((e) => ({
      group: e.group, data: e.data, position: e.position, classes: [...fake.classesOf(e.data.id)],
    })),
  }
}

/** the f-* class literals app.js writes, derived from its own source (never a list) */
function focusClassLiterals() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const re = /(?:addClass|removeClass)\(\s*'([^']*)'/g
  const out = new Set()
  let m
  while ((m = re.exec(src))) m[1].split(/\s+/).filter(Boolean).forEach((c) => { if (/^f-/.test(c)) out.add(c) })
  return out
}

const hueOf = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min
  if (!d) return 0
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return (h * 60 + 360) % 360
}
const hueGap = (a, b) => {
  const d = Math.abs(hueOf(a) - hueOf(b))
  return d > 180 ? 360 - d : d
}

test('V21 R36 palette: three mutually distinct direction colors, clear of the frozen palette', () => {
  const mod = loadAppStyle(null)
  assert.ok(mod.FOCUS_COLORS, 'app.js declares FOCUS_COLORS (and loadAppStyle extracts it)')
  const F = mod.FOCUS_COLORS
  // Every color shipped before V21 that the direction colors must not repeat.
  const FORBIDDEN = new Set(['#c08a2e', '#c9a45c', '#d9a441', '#9a6ac2', '#8a5fc0', '#c194e8',
    '#e05252', '#c04a4a', '#8f2b2b', '#ffd166', '#4c7fb8', '#6da3d8', '#3f9d6d', '#57b98a',
    '#9aa7b4', '#44505e', '#3f5a74', '#9dc1e8', '#4b7bb5', '#0f7d64', '#4fc2a0'])
  for (const theme of ['light', 'dark']) {
    assert.ok(F[theme], `FOCUS_COLORS.${theme} exists`)
    const trio = ['down', 'up', 'both'].map((k) => String(F[theme][k]).toLowerCase())
    assert.equal(new Set(trio).size, 3, `${theme}: down/up/both are pairwise distinct`)
    for (const hex of trio) {
      assert.match(hex, /^#[0-9a-f]{6}$/, `${theme}.${hex} is a 6-digit hex color`)
      assert.ok(!FORBIDDEN.has(hex), `${theme}: ${hex} collides with a frozen existing color (R36)`)
      const zone = Object.keys(mod.ZONE_COLORS[theme])
        .find((id) => String(mod.ZONE_COLORS[theme][id].line).toLowerCase() === hex)
      assert.equal(zone, undefined, `${theme}: ${hex} must not reuse the ${zone} zone line color`)
    }
    assert.ok(hueGap(trio[0], trio[1]) >= 30, `${theme}: down vs up hue gap >= 30°`)
    assert.ok(hueGap(trio[0], trio[2]) >= 30, `${theme}: down vs both hue gap >= 30°`)
    assert.ok(hueGap(trio[1], trio[2]) >= 30, `${theme}: up vs both hue gap >= 30°`)
    // family rulings: amber down, teal up, magenta both — in BOTH themes
    assert.ok(hueOf(trio[0]) <= 60 || hueOf(trio[0]) >= 330, `${theme}: down is amber (${Math.round(hueOf(trio[0]))}°)`)
    assert.ok(hueOf(trio[1]) >= 150 && hueOf(trio[1]) <= 220, `${theme}: up is teal (${Math.round(hueOf(trio[1]))}°)`)
    assert.ok(hueOf(trio[2]) >= 290 && hueOf(trio[2]) <= 345, `${theme}: both is magenta (${Math.round(hueOf(trio[2]))}°)`)
  }
})

test('V21 R36: every f-* class app.js applies has a STYLE rule; every f-* selector is applied (two-way pin)', () => {
  const mod = loadAppStyle(fixture())
  const applied = focusClassLiterals()
  assert.deepEqual([...applied].sort(), ['f-both', 'f-down', 'f-e-both', 'f-e-down', 'f-e-up', 'f-up'],
    'app.js applies exactly the six R36 direction classes (rename either side → this fails)')
  let selectors
  for (const theme of ['light', 'dark']) {
    const rules = mod.styleFor(theme)
    const sels = rules.map((r) => r.selector)
    if (theme === 'light') selectors = sels
    else assert.deepEqual(sels, selectors, 'the selector list is theme-independent (only colors differ)')
    for (const cls of applied) {
      const hit = rules.filter((r) => selectorClassTokens(r.selector).includes(cls))
      assert.ok(hit.length >= 1, `${theme}: STYLE has a rule for the applied class ${cls}`)
      for (const r of hit) {
        assert.ok(Object.keys(r.style).length > 0, `${cls} on ${r.selector} declares a property`)
        assert.equal(r.style.opacity, undefined, `${cls} must not re-declare opacity (.dim owns that)`)
        if (cls.startsWith('f-e-')) {
          assert.ok(/(^|\s)(edge|node\.)/.test('edge.' + cls) && r.selector.startsWith('edge'),
            `${r.selector}: edge direction rules select edges`)
          assert.ok(r.style['line-color'], `${r.selector}: edges need a line-color to show the direction`)
        } else {
          assert.ok(r.selector.startsWith('node'), `${r.selector}: node direction rules select nodes`)
          assert.ok(r.style['border-color'], `${r.selector}: nodes signal direction through the border`)
        }
      }
    }
  }
})

test('V21 R36: rule ORDER is the priority — every f-* rule lands after all e-<kind>/sc-*/gk-*/sk-* rules', () => {
  const mod = loadAppStyle(fixture())
  for (const theme of ['light', 'dark']) {
    const sels = mod.styleFor(theme).map((r) => r.selector)
    const isType = (s) => /(^|\.)(e-(dep|mount|peer|peer-optional)\b|sc-|gk-|sk-)/.test(s)
    const isFocus = (s) => /\.f-(down|up|both|e-down|e-up|e-both)\b/.test(s)
    const lastType = sels.reduce((acc, s, i) => (isType(s) ? i : acc), -1)
    const firstFocus = sels.findIndex(isFocus)
    const lastFocus = sels.reduce((acc, s, i) => (isFocus(s) ? i : acc), -1)
    assert.ok(lastType >= 0, `${theme}: the style carries kind/scope rules`)
    assert.ok(firstFocus >= 0, `${theme}: the style carries f-* rules`)
    assert.ok(firstFocus > lastType,
      `${theme}: f-* rules start at index ${firstFocus}, after the last type rule at ${lastType}`)
    assert.ok(lastFocus > firstFocus, `${theme}: the whole f-* block sits at the tail`)
  }
})

test('V21 R36 computed style (frozen dist): a focused dashed e-peer edge takes the DIRECTION color', () => {
  const Model = loadModel()
  const Cytoscape = loadVendoredCytoscape()
  const graph = pathGraph()
  const mod = loadAppStyle(graph)
  for (const theme of ['light', 'dark']) {
    // applyClasses' real output → the same element list handed to real cytoscape
    const run = classesApplied(Model, graph, { collapsedGroups: new Set(), showRealCross: true },
      { rootId: 'r', depth: null }, 'r')
    const F = mod.FOCUS_COLORS[theme]
    let cy
    const warns = captureWarnings(() => {
      cy = Cytoscape({ headless: true, styleEnabled: true, elements: run.elements })
      cy.style(mod.styleFor(theme))
    })
    try {
      assert.deepEqual(warns.filter((w) => /is invalid|Halting/i.test(w)), [],
        `${theme}: the frozen dist rejected a V21 style rule:\n  ${warns.join('\n  ')}`)
      assert.deepEqual(warns, [], `${theme}: unexpected cytoscape warnings:\n  ${warns.join('\n  ')}`)
      const peer = cy.getElementById('e:d1|d2|peer')
      assert.ok(peer.length, 'the dashed peer edge renders as a real cross edge')
      assert.ok(run.fake.classesOf('e:d1|d2|peer').includes('f-e-down'), 'applyClasses marked it down')
      assert.equal(pstr(peer, 'line-style'), 'dashed', 'e-peer still owns the line type')
      assert.equal(pstr(peer, 'line-color'), hexToRgb(F.down),
        `${theme}: later f-* rule wins the tie → the direction color, not the peer blue`)
      assert.equal(pstr(peer, 'target-arrow-color'), hexToRgb(F.down), 'the arrow follows the direction')
      const upEdge = cy.getElementById('e:p1|u1|mount')
      assert.equal(pstr(upEdge, 'line-color'), hexToRgb(F.up), 'an up edge takes the up color')
      assert.equal(pstr(cy.getElementById('d2'), 'border-color'), hexToRgb(F.down), 'down member border')
      assert.equal(pstr(cy.getElementById('u1'), 'border-color'), hexToRgb(F.up), 'up member border')
      assert.ok(pnum(cy.getElementById('d2'), 'border-width') >= 2, 'the direction border is actually visible')
      assert.equal(pnum(cy.getElementById('d2'), 'opacity'), 1, 'a member is never dimmed')
      assert.equal(pstr(cy.getElementById('r'), 'border-color'), 'rgb(255,209,102)',
        'the root keeps the selected/in-focus gold ring (no direction class on the root)')
    } finally {
      if (cy) cy.destroy()
    }
  }
})

test('V21 R36 computed style (frozen dist): a dimmed element fades, an ancestor container never does', () => {
  const Model = loadModel()
  const Cytoscape = loadVendoredCytoscape()
  const graph = fixture()
  const mod = loadAppStyle(graph)
  for (const theme of ['light', 'dark']) {
    const run = classesApplied(Model, graph, { collapsedGroups: new Set(), showRealCross: true },
      { rootId: A1, depth: null }, A1)
    let cy
    const warns = captureWarnings(() => {
      cy = Cytoscape({ headless: true, styleEnabled: true, elements: run.elements })
      cy.style(mod.styleFor(theme))
    })
    try {
      assert.deepEqual(warns.filter((w) => /is invalid|Halting/i.test(w)), [],
        `${theme}: style rejected:\n  ${warns.join('\n  ')}`)
      const F = mod.FOCUS_COLORS[theme]
      // the edge that sits in BOTH universes (peer + peer-optional pair) is magenta
      const both = cy.getElementById(`e:${A1}|${X1}|peer`)
      assert.ok(run.fake.classesOf(`e:${A1}|${X1}|peer`).includes('f-e-both'), 'both-colour applied')
      assert.equal(pstr(both, 'line-style'), 'dashed', 'line type survives the direction color')
      assert.equal(pstr(both, 'line-color'), hexToRgb(F.both), 'both-universe edge → magenta family')
      assert.equal(pstr(cy.getElementById(`e:${WB}|${A1}|mount`), 'line-color'), hexToRgb(F.up),
        'the profile mount edge is an up edge')
      assert.equal(pstr(cy.getElementById(`e:${A1}|${F1}|mount`), 'line-color'),
        theme === 'dark' ? 'rgb(87,185,138)' : 'rgb(63,157,109)',
        'the A1→F1 mount edge is induced by NEITHER universe → keeps its mount color and dims')
      // ancestors: in-focus, never .dim, full opacity
      for (const id of ['cat:kernel', 'g:bundle', 'cat:plugin', 'cat:profiles', 'cat:broken', 'g:profiles']) {
        assert.ok(run.fake.classesOf(id).includes('in-focus'), `${id}: ancestor carries in-focus`)
        assert.ok(!run.fake.classesOf(id).includes('dim'), `${id}: an ancestor never carries .dim`)
        assert.equal(pnum(cy.getElementById(id), 'opacity'), 1, `${id}: computed opacity is 1`)
      }
      // unrelated containers DO dim
      for (const id of ['cat:tools', 'g:fs', 'cat:infra', 'cat:ungrouped']) {
        assert.ok(run.fake.classesOf(id).includes('dim'), `${id}: unrelated to the focus → dim`)
        assert.equal(pnum(cy.getElementById(id), 'opacity'), 0.15, `${id}: the .dim opacity lands`)
      }
      // members
      assert.equal(pstr(cy.getElementById(U1), 'border-color'), hexToRgb(F.down), 'down member border')
      assert.equal(pstr(cy.getElementById(X1), 'border-color'), hexToRgb(F.both), 'both member border')
      assert.equal(pstr(cy.getElementById(WB), 'border-color'), hexToRgb(F.up), 'up member border')
      assert.equal(pnum(cy.getElementById(L1), 'opacity'), 0.15, 'an unrelated package dims')
    } finally {
      if (cy) cy.destroy()
    }
  }
})

// ---------- V21: R35 wiring (control defaults, details data, README/legend) ----------

test('V21 R35 controls: depth 0 option ships selected (unlimited), and the wiring maps 0 → null', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  // greedy-to-the-end: the control contains an inner <span> label, so a lazy
  // .*?</span> would stop at the label instead of the control's own end
  const ctl = /<span id="focus-ctl"[\s\S]*?<button id="focus-clear"[\s\S]*?<\/span>/.exec(html)
  assert.ok(ctl, '#focus-ctl exists')
  assert.match(ctl[0], /<select id="focus-depth">/, 'the depth select is inside #focus-ctl')
  assert.match(ctl[0], /<option value="0"[^>]*selected/, 'option 0 (不限/unlimited) is the DEFAULT selection')
  assert.equal((ctl[0].match(/ selected/g) || []).length, 1, 'exactly one option carries selected')
  assert.match(ctl[0], /<option value="1">1<\/option><option value="2">2<\/option><option value="3">3<\/option>/,
    'depths 1-3 remain available, unselected')
  assert.match(ctl[0], /data-i18n="focusUnlimited"/, 'the unlimited option label is an i18n key (bilingual)')
  // depth 0 ↔ null, and syncFocusCtl writes the value back the same way
  assert.match(src, /v === 0 \? null : v >= 1 && v <= 3 \? v : null/, 'depthOfCtl maps 0 → null')
  assert.match(src, /sel\.value = String\(state\.focus\.depth == null \? 0 : state\.focus\.depth\)/,
    'syncFocusCtl maps null depth → "0"')
  assert.match(src, /focusNode\(n\.id, null, n\.id\)/, 'the #node= deep link starts at unlimited depth')
  assert.match(src, /state\.focus = null/, 'focus clears (blank tap / non-package / #focus-clear)')
  // V2.6 (R46): the shared decision fn gained the nav flag — a COLD tap declines,
  // explicit navigation (the selectNode(id, true) call sites) still roots.
  assert.match(src, /function focusForId\(id, nav\) \{/, 'R35 routes focus through selectNode/revealNode')
  assert.match(src, /n\.kind === 'package'/, 'only kind=package nodes can be a focus root')
  assert.match(src, /return focusTransition\(focusForId\(id, nav\)\)/,
    'the selection funnel installs the focus through the V2.5 transition recorder')
  // rescan guard: a focus root that vanished OR stopped being a package is dropped
  assert.match(src, /state\.focus && \!isFocusRoot\(state\.focus\.rootId\)\) state\.focus = null/,
    'applyGraph prunes a stale focus root')
})

test('V21 fix1: the #node= deep link is gated by isFocusRoot (only a package anchors a focus)', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const i = src.indexOf('/node=(.+)$/.exec(hash)')
  assert.ok(i >= 0, 'the #node= deep-link branch still exists')
  const block = src.slice(i, src.indexOf('paint()', i))
  assert.match(block, /isFocusRoot\(/,
    'R35 gate: #node=profile:web anchors a selection, never a focus (package kind only)')
  assert.match(block, /focusNode\(n\.id, null, n\.id\)/, 'a package anchor still focuses at unlimited depth')
})

test('V21 R36 legend + README + style.css stay in sync with the direction palette', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const readme = readFileSync(join(WEB, '..', 'README.md'), 'utf8')
  const app = loadAppStyle(null)
  const F = app.FOCUS_COLORS
  // the legend carries the two new rows and their i18n keys
  assert.match(src, /legRow\('fp-down', 'leg-edge', t\('pathDownLabel'\)\)/, 'legend row: dependency path')
  assert.match(src, /legRow\('fp-up', 'leg-edge', t\('pathUpLabel'\)\)/, 'legend row: dependent path')
  // the swatch colors must be the SAME hexes app.js paints with (drift guard, like #graph)
  const downRule = /\.leg-edge\.fp-down\s*\{[^}]*\}/.exec(css)
  const upRule = /\.leg-edge\.fp-up\s*\{[^}]*\}/.exec(css)
  assert.ok(downRule && upRule, 'style.css styles the two direction swatches')
  assert.ok(downRule[0].toLowerCase().includes(F.light.down.toLowerCase()) && downRule[0].toLowerCase().includes(F.dark.down.toLowerCase()),
    `the .fp-down swatch carries both theme hexes (${F.light.down}/${F.dark.down})`)
  assert.ok(upRule[0].toLowerCase().includes(F.light.up.toLowerCase()) && upRule[0].toLowerCase().includes(F.dark.up.toLowerCase()),
    `the .fp-up swatch carries both theme hexes (${F.light.up}/${F.dark.up})`)
  // README: the usage line and the legend line describe what actually ships
  assert.match(readme, /聚焦[：:].{0,220}依赖路径/, 'README 聚焦 line mentions the dependency path highlight')
  assert.match(readme, /被依赖路径/, 'README covers both directions')
  assert.match(readme, /图例[（(].{0,80}两色|图例.{0,40}依赖路径/, 'README legend line mentions the two direction colors')
})

test('V21 details data: pathSets → buildPathLists over the shipped fixture', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const graph = fixture()
  const lists = buildPathLists(pathSets(graph, A1, null), graph, byIdMap(graph))
  assert.deepEqual(lists.down.map((r) => [r.id, r.dist]), [[U1, 1], [X1, 1]],
    'core depends on util and plugin-x, both layer 1, sorted by name (@… sorts before plugin-x)')
  assert.deepEqual(lists.up.map((r) => r.id), [B1, X1, WB],
    'reverse dep + reverse peer-optional + mounted-by, all layer 1, sorted by DISPLAY name')
  assert.deepEqual(lists.up.map((r) => r.kinds), [['dep'], ['peer-optional'], ['mount']],
    'each row reports the kind of the edge that reaches it (X1 via its peer-optional back edge)')
  const wb = lists.up[2]
  assert.equal(wb.isProfile, true, 'profile:web is flagged as a profile row')
  assert.equal(wb.name, 'web', 'its display name carries no profile: prefix')
  assert.equal(lists.down.length, 2, 'the F1 mount edge is NOT a down kind → only two down rows')
  assert.equal(lists.down[0].version, '1.0.0', 'rows carry the node version')
})

test('V21 details data: attacker-controlled names survive verbatim and never become markup', () => {
  const { pathSets, buildPathLists } = loadAppPure()
  const evil = '<img src=x onerror=alert(1)>'
  const graph = {
    nodes: [
      { id: 'r', kind: 'package', name: 'r', version: '1.0.0' },
      { id: 'profile:' + evil, kind: 'package', name: evil, version: evil, scope: 'third-party' },
    ],
    edges: [{ from: 'r', to: 'profile:' + evil, kind: 'dep' }],
  }
  const rows = buildPathLists(pathSets(graph, 'r', null), graph, byIdMap(graph)).down
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, evil,
    'the row carries the raw string — the renderer writes it through escText (pinned above)')
  assert.equal(rows[0].version, evil)
  assert.deepEqual(rows[0].kinds, ['dep'])
})

// =========================================================================
// Task V2.2b — path mode UI + LOD + peek + tiered lists + chip solo/all.
// The pure helpers live in app.js's PURE HELPERS section and run through the
// same extract seam; the DOM-ish half runs through the fake-DOM harnesses
// below; the frozen dist decides ctx/ek-off validity; real headless
// cytoscape pins the fit-to-path selection numerically.
// =========================================================================

// ---------- V2.3: the auto-LOD is GONE, the segment is two-state ----------

test('V2.3 auto-LOD deleted: no decideGranularity / zoom thresholds / granMode anywhere', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  for (const gone of ['decideGranularity', 'LOD_T_IN', 'LOD_T_OUT', 'LOD_DEBOUNCE_MS', 'granMode', 'lodAuto']) {
    assert.ok(!src.includes(gone), `app.js must not mention ${gone} any more (auto-LOD is deleted, not disabled)`)
    assert.ok(!html.includes(gone), `index.html must not mention ${gone} any more`)
  }
  // The zoom event survives for exactly one job: a live peek cannot track the camera.
  assert.match(src, /cy\.on\('zoom', hidePeek\)/, 'zoom still closes a live peek')
  assert.doesNotMatch(src, /cy\.on\('zoom',\s*function/, 'no zoom HANDLER is left to repaint the structure')
  // …and no debounce timer is left holding a granularity repaint either
  assert.doesNotMatch(src, /zoomTimer/, 'the zoom debounce timer is gone')
  // 组级 ships as the default tier in BOTH places the view is built
  assert.equal((src.match(/granularity: 'groups'/g) || []).length, 2,
    'state.view AND freshView() both default to 组级 (the model default, no zoom round-trip)')
})

test('V2.3 granularity segment: two states, straight through to view.granularity', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  assert.match(html, /<span id="lod-ctl"/, 'the granularity control still exists')
  const segs = [...html.matchAll(/data-seg="([^"]+)"/g)].map((m) => m[1])
  assert.deepEqual(segs, ['groups', 'packages'], 'exactly two segments, in order: 组级 | 包级')
  for (const key of ['lodGroups', 'lodPkgs']) {
    assert.ok(html.includes(`data-i18n="${key}"`), `${key} label is bilingual`)
  }
  // the click handler: the SEGMENT VALUE is the model tier — no decision function,
  // no zoom read, and a same-tier click repaints nothing.
  const a = src.indexOf('// V2.3 granularity segment')
  const b = src.indexOf('// V22b Esc: window-level')
  assert.ok(a > 0 && b > a, 'the segment binder is still there (anchor pair)')
  const seg = src.slice(a, b)
  assert.match(seg, /if \(seg !== 'groups' && seg !== 'packages'\) return/, 'junk segment ignored (two states only)')
  assert.match(seg, /if \(seg === state\.view\.granularity\) return/, 'the active tier is a no-op click')
  assert.match(seg, /state\.view\.granularity = seg/, 'the segment writes view.granularity straight through')
  assert.match(seg, /syncLodCtl\(\)/, 'the active mark follows the click')
  assert.match(seg, /paint\(\)/, 'a tier switch is a structural repaint (since V2.5 every repaint KEEPS the viewport)')
  assert.doesNotMatch(seg, /zoom\(\)/, 'the click never consults the zoom')
  // syncLodCtl marks the tier that IS in effect: it reads the model field, not a mode
  const s0 = src.indexOf('function syncLodCtl() {')
  const s1 = src.indexOf('// ---------- V22b global Esc')
  assert.ok(s0 > 0 && s1 > s0, 'syncLodCtl is still there (anchor pair)')
  assert.match(src.slice(s0, s1), /getAttribute\('data-seg'\) === state\.view\.granularity/,
    'the lit segment always reports view.granularity (one source of truth)')
  assert.doesNotMatch(src.slice(s0, s1), /granMode/, 'syncLodCtl has no separate mode to track')
})

test('V2.3 constants: peek/wheel timings survive, the LOD thresholds do not', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  assert.match(src, /var PEEK_DEBOUNCE_MS = 250/, 'peek debounce 250ms')
  assert.match(src, /var WHEEL_SENS = 2\.5/, 'wheel sensitivity constant')
  // wheelSensitivity is a CYTOSCAPE OPTION (init), not a style property
  assert.match(src, /window\.cytoscape\(\{ container: document\.getElementById\('graph'\), elements: \[\], wheelSensitivity: WHEEL_SENS \}\)/,
    'cy init carries wheelSensitivity: WHEEL_SENS')
})

// ---------- V2.3 pure: group / zone member packages ----------

function memberFixture() {
  return {
    categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }, { id: 'tools', zh: '工具', en: 'Tools' }],
    groups: [
      { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 2 },
      { id: 'fs', kind: 'official', category: 'tools', packageCount: 2 },
    ],
    nodes: [
      { id: 'a@1', kind: 'package', name: 'alpha', version: '1.0.0', group: 'bundle', scope: 'official' },
      { id: 'b@1', kind: 'package', name: 'beta', version: '2.0.0', group: 'bundle', scope: 'official' },
      { id: 'c@1', kind: 'package', name: 'gamma', version: '0.1.0', group: 'fs', scope: 'third-party' },
      // no declared category on this group: the zone comes from the MEMBER's own
      { id: 'd@1', kind: 'package', name: 'delta', version: '1.0.0', group: 'loose', category: 'tools', scope: 'third-party' },
      // a package attached to no group at all ('ungrouped'), plus the pseudo-kinds
      { id: 'l@1', kind: 'package', name: 'loose-lib', version: '1.0.0', group: null, scope: 'third-party' },
      { id: 'brk', kind: 'broken', name: 'pkg-broken', version: '-', group: 'fs', scope: 'official' },
    ],
    edges: [
      { from: 'a@1', to: 'b@1', kind: 'dep' },
      { from: 'c@1', to: 'a@1', kind: 'dep', unsatisfied: true }, // touches a@1 AND c@1
      { from: 'b@1', to: 'b@1', kind: 'dep' },                    // a self-loop touches b@1 only
    ],
  }
}

test('V2.3 buildGroupMembers: a group lists its own packages, sorted name→version→id', () => {
  const { buildGroupMembers } = loadAppPure()
  const g = memberFixture()
  const r = buildGroupMembers({ kind: 'group', id: 'bundle' }, g)
  assert.equal(r.total, 2, 'the two bundle members')
  assert.deepEqual(r.rows.map((x) => x.id), ['a@1', 'b@1'], 'sorted by display name')
  assert.deepEqual(r.rows[0], {
    id: 'a@1', name: 'alpha', version: '1.0.0', scope: 'official', kind: 'package', broken: false, unsat: true,
  }, 'row shape: id/name/version/scope/kind/broken/unsat (unsat = an UNSATISFIED edge touches it)')
  assert.equal(r.rows[1].unsat, false, 'a self-loop / satisfied dep does not flag 未满足')
  assert.equal(r.capped, false, 'under the cap nothing is capped')
  // determinism is a contract: the same graph in a shuffled input order, same rows
  const shuffled = Object.assign({}, g, { nodes: g.nodes.slice().reverse() })
  assert.deepEqual(buildGroupMembers({ kind: 'group', id: 'bundle' }, shuffled).rows, r.rows,
    'sort is a total order (name→version→id), not an accident of input order')
})

test('V2.3 buildGroupMembers: a zone lists every package whose GROUP maps to it', () => {
  const { buildGroupMembers } = loadAppPure()
  const g = memberFixture()
  const tools = buildGroupMembers({ kind: 'zone', id: 'tools' }, g)
  assert.deepEqual(tools.rows.map((x) => x.id), ['d@1', 'c@1', 'brk'],
    'declared-category group + member-category group + the broken pseudo-node of that zone')
  assert.equal(tools.total, 3)
  assert.equal(tools.rows[2].broken, true, 'kind=broken carries the convenience flag')
  assert.equal(tools.rows[2].version, '-', 'the pseudo-node version rides through verbatim')
  assert.deepEqual(buildGroupMembers({ kind: 'zone', id: 'ungrouped' }, g).rows.map((x) => x.id), ['l@1'],
    'a package on no group at all lands in 未归类, exactly where it renders')
  assert.deepEqual(buildGroupMembers({ kind: 'zone', id: 'kernel' }, g).rows.map((x) => x.id), ['a@1', 'b@1'],
    'the declared groups[].category mapping wins')
})

test('V2.3 buildGroupMembers: empty group, junk selection and unknown kinds list nothing, never throw', () => {
  const { buildGroupMembers } = loadAppPure()
  const g = memberFixture()
  assert.deepEqual(buildGroupMembers({ kind: 'group', id: 'ghost' }, g), { total: 0, rows: [], capped: false },
    'a group with no members: an honest zero')
  assert.deepEqual(buildGroupMembers({ kind: 'node', id: 'bundle' }, g).rows, [], 'not a container selection → no list')
  assert.deepEqual(buildGroupMembers(null, g), { total: 0, rows: [], capped: false }, 'junk selection, never a throw')
  assert.deepEqual(buildGroupMembers({ kind: 'group', id: 'bundle' }, null), { total: 0, rows: [], capped: false })
  assert.deepEqual(buildGroupMembers({ kind: 'group' }, g), { total: 0, rows: [], capped: false },
    'a selection with no id matches nothing (id-less nodes never join the list)')
})

test('V2.3 buildGroupMembers: 200-row cap with an honest total (meta count is the TRUE count)', () => {
  const { buildGroupMembers, GROUP_MEMBER_CAP } = loadAppPure()
  assert.equal(GROUP_MEMBER_CAP, 200, 'member rows cap at 200')
  const nodes = []
  for (let i = 0; i < GROUP_MEMBER_CAP + 7; i++) {
    nodes.push({ id: 'p' + i + '@1', kind: 'package', name: 'pkg-' + String(i).padStart(4, '0'), version: '1.0.0', group: 'big' })
  }
  const r = buildGroupMembers({ kind: 'group', id: 'big' }, { nodes, edges: [] })
  assert.equal(r.total, GROUP_MEMBER_CAP + 7, 'total is the TRUE count, not the rendered count')
  assert.equal(r.rows.length, GROUP_MEMBER_CAP, 'rows are capped')
  assert.equal(r.capped, true, 'the renderer gets the truncation flag (and prints the +N tail)')
  assert.equal(r.rows[0].name, 'pkg-0000', 'the rows kept are the FIRST 200 in sort order')
  assert.equal(r.rows[GROUP_MEMBER_CAP - 1].name, 'pkg-0199')
})

test('V2.3 buildGroupMembers: names/versions are attacker data and arrive VERBATIM', () => {
  const { buildGroupMembers } = loadAppPure()
  const evil = '<img src=x onerror=alert(1)>'
  const g = {
    groups: [],
    nodes: [{ id: 'e@1', kind: 'package', name: evil, version: '<script>', group: 'g1', scope: evil }],
    edges: [],
  }
  const rows = buildGroupMembers({ kind: 'group', id: 'g1' }, g).rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, evil, 'the raw string rides to the renderer (escText writes it as TEXT — pinned in the DOM test)')
  assert.equal(rows[0].version, '<script>')
  assert.equal(rows[0].scope, evil)
})

test('V2.3 buildGroupMembers sort: identical name+version breaks the tie on id', () => {
  const { buildGroupMembers } = loadAppPure()
  // name AND version identical; input order adversarial (z before a) so only a
  // real id tiebreak can produce the expected order.
  const g = { nodes: [
    { id: 'z@1', kind: 'package', name: 'twin', version: '1.0.0', group: 't', scope: 'official' },
    { id: 'a@1', kind: 'package', name: 'twin', version: '1.0.0', group: 't', scope: 'official' },
  ], edges: [] }
  assert.deepEqual(buildGroupMembers({ kind: 'group', id: 't' }, g).rows.map((x) => x.id), ['a@1', 'z@1'],
    'id is the final tiebreak of the name→version→id order')
})

test('V2.3 buildGroupMembers sort: same name breaks on version before id is consulted', () => {
  const { buildGroupMembers } = loadAppPure()
  // ids point one way (a@1 sorts first), versions the other (z@1@1.0.0 first):
  // only a version-keyed order can produce the expected rows.
  const g = { nodes: [
    { id: 'a@1', kind: 'package', name: 'same', version: '2.0.0', group: 't', scope: 'official' },
    { id: 'z@1', kind: 'package', name: 'same', version: '1.0.0', group: 't', scope: 'official' },
  ], edges: [] }
  assert.deepEqual(buildGroupMembers({ kind: 'group', id: 't' }, g).rows.map((x) => x.id), ['z@1', 'a@1'],
    'version orders ahead of id (an id-first order would put a@1 first)')
})


// ---------- pure: path back-stack + breadcrumb text ----------

test('V22b pushPathStack: dedupes consecutive same-root, caps at 20 dropping the oldest, never mutates', () => {
  const { pushPathStack, PATH_STACK_CAP } = loadAppPure()
  assert.equal(PATH_STACK_CAP, 20)
  assert.deepEqual(pushPathStack([], 'a'), ['a'], 'push onto empty')
  assert.deepEqual(pushPathStack(['x'], 'a'), ['x', 'a'], 'distinct roots stack')
  assert.deepEqual(pushPathStack(['x', 'a'], 'a'), ['x', 'a'], 'consecutive same root dedupes (walk a->x->a then a again)')
  assert.deepEqual(pushPathStack(['a', 'b', 'a'], 'a'), ['a', 'b', 'a'], 'same id deeper in the stack still pushes (only CONSECUTIVE dedupes)')
  const src = ['a', 'b']
  const out = pushPathStack(src, 'c')
  assert.notEqual(out, src, 'pure: a new array comes back')
  assert.deepEqual(src, ['a', 'b'], 'input untouched')
  let stack = []
  for (let i = 0; i < 30; i += 2) { stack = pushPathStack(stack, 'r' + i); stack = pushPathStack(stack, 'r' + (i + 1)) }
  assert.equal(stack.length, PATH_STACK_CAP, 'cap holds no matter how deep the walk goes')
  assert.equal(stack[0], 'r10', 'the OLDEST entries dropped (r0..r9)')
  assert.equal(stack[PATH_STACK_CAP - 1], 'r29', 'newest kept at the tail')
  assert.deepEqual(pushPathStack([], null), [], 'null root never enters the stack')
})

test('V22b pathChainText: joins with arrows; over CRUMB_MAX entries truncates with a leading ellipsis', () => {
  const { pathChainText, CRUMB_MAX } = loadAppPure()
  assert.equal(CRUMB_MAX, 4, 'breadcrumb shows at most 4 entries')
  assert.equal(pathChainText([]), '', 'empty stack -> empty text (button stays hidden)')
  assert.equal(pathChainText(['a']), 'a')
  assert.equal(pathChainText(['a', 'b', 'c', 'd']), 'a \u2192 b \u2192 c \u2192 d', 'exactly CRUMB_MAX stays whole')
  assert.equal(pathChainText(['a', 'b', 'c', 'd', 'e']), '\u2026 \u2192 b \u2192 c \u2192 d \u2192 e',
    'over the cap: the tail survives, the head collapses to \u2026')
  assert.equal(pathChainText(['a', 'b'], ' | '), 'a | b', 'separator injectable')
  assert.equal(pathChainText(null), '', 'junk -> empty, never a throw')
})

// ---------- pure: tiered detail rows + chip state predicates ----------

test('V22b groupRowsByDist: ascending layer segments, input order inside a layer, empty stays empty', () => {
  const { groupRowsByDist } = loadAppPure()
  assert.deepEqual(groupRowsByDist([]), [], 'empty in, empty out (the caller owns the empty heading)')
  const rows = [
    { id: 'x', dist: 1 }, { id: 'b', dist: 1 }, { id: 'y', dist: 2 }, { id: 'z', dist: 3 },
  ]
  const tiers = groupRowsByDist(rows)
  assert.deepEqual(tiers.map((t) => t.dist), [1, 2, 3], 'segments ascend by layer')
  assert.deepEqual(tiers[0].rows.map((r) => r.id), ['x', 'b'], 'input (name) order survives inside a layer')
  assert.equal(tiers[1].rows.length, 1)
  // out-of-order input still segments ascending (defensive — buildPathLists sorts, but tiering must not assume)
  const t2 = groupRowsByDist([{ id: 'd', dist: 2 }, { id: 'a', dist: 1 }, { id: 'd2', dist: 2 }])
  assert.deepEqual(t2.map((t) => t.dist), [1, 2])
  assert.deepEqual(t2[1].rows.map((r) => r.id), ['d', 'd2'], 'rows of a segment keep their relative order')
})

test('V22b chip predicates: dblclick solo toggles, hide-all excludes every category, show-all clears', () => {
  const { soloToggleFor, hideAllCats, showAllCats } = loadAppPure()
  const all = ['kernel', 'tools', 'plugin']
  const s1 = soloToggleFor(all, new Set(), 'tools')
  assert.deepEqual([...s1].sort(), ['kernel', 'plugin'], 'solo tools = every OTHER category excluded (filterCats is the EXCLUDE set)')
  const s2 = soloToggleFor(all, s1, 'tools')
  assert.deepEqual([...s2], [], 'same chip again = restore (everything visible)')
  const s3 = soloToggleFor(all, new Set(['tools']), 'tools')
  assert.deepEqual([...s3].sort(), ['kernel', 'plugin'], 'chip was hidden -> solo makes it the only one shown')
  const s4 = soloToggleFor(all, new Set(['kernel']), 'tools')
  assert.deepEqual([...s4].sort(), ['kernel', 'plugin'], 'a partial filter is replaced by the solo, not merged')
  const hidden = hideAllCats(all)
  assert.deepEqual([...hidden].sort(), ['kernel', 'plugin', 'tools'], 'hide-all excludes every category')
  assert.equal(hideAllCats(all) === hideAllCats(all), false, 'fresh Sets every call (no shared mutable state)')
  assert.deepEqual([...showAllCats()], [], 'show-all = the empty exclude set')
  assert.deepEqual([...soloToggleFor([], new Set(), 'x')], [], 'no categories -> empty set, never a throw')
})

// ---------- pure: peek card data ----------

function peekFixture() {
  return {
    categories: [
      { id: 'kernel', zh: 'NEIKER', en: 'KernelEN' },
      { id: 'tools', zh: 'GONGJU', en: 'ToolsEN' },
    ],
    groups: [
      { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 2 },
      { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
    ],
    nodes: [
      { id: 'a@1', kind: 'package', name: 'alpha', version: '1.0.0', group: 'bundle', category: 'kernel', description: 'x'.repeat(200) },
      { id: 'b@1', kind: 'package', name: 'beta', version: '2.0.0', group: 'bundle', category: 'kernel', description: null },
      { id: 'c@1', kind: 'package', name: 'gamma', version: '3.0.0', group: 'fs', category: 'tools', description: 'small' },
      { id: 'brk', kind: 'broken', name: 'pkg-broken', version: '-', group: 'fs', category: 'tools', description: null },
    ],
    edges: [
      { from: 'a@1', to: 'b@1', kind: 'dep' },
      { from: 'a@1', to: 'b@1', kind: 'peer' },   // same pair again: still ONE dependency
      { from: 'a@1', to: 'a@1', kind: 'dep' },    // self-loop never counts
      { from: 'c@1', to: 'a@1', kind: 'mount', unsatisfied: true },
      { from: 'brk', to: 'a@1', kind: 'dep' },
    ],
  }
}

test('V22b buildPeekCard: package counts, deduped pair counting, bilingual titles, truncation, flags', () => {
  const { buildPeekCard, PEEK_DESC_CAP } = loadAppPure()
  const g = peekFixture()
  const byId = byIdMap(g)
  const zh = buildPeekCard({ id: 'a@1', kind: 'pkg', name: 'a@1' }, g, byId, 'zh')
  assert.equal(zh.title, 'alpha', 'the graph node name wins over the element data name')
  assert.equal(zh.version, '1.0.0')
  assert.equal(zh.deps, 1, 'a→b over TWO kinds still counts as one dependency (pair-deduped)')
  assert.equal(zh.dependents, 2, 'c mounts a, broken depends on a -> two dependents')
  assert.equal(zh.unsat, true, 'the unsatisfied mount rides the ⚠ flag')
  assert.equal(zh.broken, false)
  assert.equal(zh.zone, 'NEIKER', 'zh picks the zh category title')
  assert.equal(zh.group, 'bundle')
  assert.equal(zh.desc, 'x'.repeat(PEEK_DESC_CAP), 'description truncated at PEEK_DESC_CAP')
  assert.equal(zh.descCut, true, 'the renderer learns truncation happened (adds the ellipsis)')
  const en = buildPeekCard({ id: 'c@1', kind: 'pkg', name: 'c@1' }, g, byId, 'en')
  assert.equal(en.zone, 'ToolsEN', 'en picks the en title')
  assert.equal(en.desc, 'small'); assert.equal(en.descCut, false)
  assert.equal(en.unsat, true, 'the unsatisfied edge touches c, so c flags it too (direct-edge semantics)')
  assert.equal(en.deps, 0)
  const brk = buildPeekCard({ id: 'brk', kind: 'pkg', name: 'brk' }, g, byId, 'zh')
  assert.equal(brk.broken, true, 'kind=broken nodes carry the broken flag')
  const prof = buildPeekCard({ id: 'nope@9', kind: 'pkg', name: 'nope@9' }, g, byId, 'zh')
  assert.equal(prof.title, 'nope@9', 'an unknown node falls back to the raw id everywhere, never a throw')
  assert.deepEqual([prof.deps, prof.dependents, prof.unsat], [0, 0, false])
})

test('V22b buildPeekCard: group cards and zone shells get title/zone/members without counts', () => {
  const { buildPeekCard } = loadAppPure()
  const g = peekFixture()
  const byId = byIdMap(g)
  const grp = buildPeekCard({ id: 'g:fs', kind: 'group', name: 'fs', count: 2 }, g, byId, 'zh')
  assert.equal(grp.title, 'fs', 'group card titles are the group id')
  assert.equal(grp.zone, 'GONGJU', 'the group zone derives like the model: declared groups[].category')
  assert.equal(grp.members, 2, 'the rendered data.count rides through')
  assert.equal(grp.deps, null, 'cards have no package-level counts — the renderer drops those rows')
  const zone = buildPeekCard({ id: 'cat:kernel', kind: 'zone', name: 'kernel', count: 7 }, g, byId, 'zh')
  assert.equal(zone.title, 'NEIKER', 'zone title comes out bilingual-resolved')
  assert.equal(zone.members, 7)
  const unknown = buildPeekCard({ id: 'g:ghost', kind: 'group', name: 'ghost', count: 1 }, g, byId, 'zh')
  assert.equal(unknown.zone, 'ungrouped', 'a group no category claim resolves ungrouped, never a throw')
})

test('V22b renderPeek: attacker-controlled peek strings reach the DOM as TEXT only', () => {
  const { buildPeekCard } = loadAppPure()
  const dom = loadDetailsDom()
  const evil = '<img src=x onerror=alert(1)>'
  const graph = {
    categories: [{ id: 'k', zh: evil, en: evil }],
    groups: [{ id: evil, kind: 'official', category: 'k', packageCount: 1 }],
    nodes: [{ id: 'p', kind: 'package', name: evil, version: evil, group: evil, category: 'k', description: evil + evil + evil }],
    edges: [{ from: 'p', to: 'q', kind: 'dep', unsatisfied: true }],
  }
  const p = buildPeekCard({ id: 'p', kind: 'pkg', name: 'p' }, graph, new Map([['p', graph.nodes[0]]]), 'zh')
  const card = new dom.El('div')
  dom.renderPeek(card, p)
  const texts = domTexts(card)
  assert.ok(texts.some((s) => s.includes(evil)), 'the strings are THERE (rendered)')
  assert.equal(texts.filter((s) => s.includes(evil)).length >= 1, true)
  assert.equal(JSON.stringify(card).includes('innerHTML'), false, 'no markup composition in the peek card')
  const json = JSON.stringify(card)
  assert.equal(json.includes('<img'), true, 'the raw text is visible as text (an HTML sink would have escaped/parsed it away differently)')
  // a group card peek renders no deps/dependents row at all
  const gp = buildPeekCard({ id: 'g:x', kind: 'group', name: 'x', count: 3 }, graph, new Map(), 'en')
  const card2 = new dom.El('div')
  dom.renderPeek(card2, gp)
  const t2 = domTexts(card2)
  assert.equal(t2.some((s) => s.includes('PEEK-DEPS')), false, 'cards skip the count row (deps === null)')
  assert.ok(t2.some((s) => s.includes('PEEK-MEMBERS 3')), 'cards carry the members row')
})

// ---------- fake DOM: focus-ctl breadcrumb ----------

function loadFocusCtlDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const crumbCap = /var CRUMB_MAX = [^\n;]+/.exec(src)
  assert.ok(crumbCap, 'app.js must still declare `var CRUMB_MAX = …`')
  const body = [
    'var CTL = { hidden: true }, SEL = { value: \x27\x27, disabled: false, title: \x27\x27 }, BACK = { hidden: true, textContent: \x27\x27 }\n',
    'var document = { getElementById: function (id) {\n',
    '  return id === \x27focus-ctl\x27 ? CTL : id === \x27focus-depth\x27 ? SEL : id === \x27path-back\x27 ? BACK : null\n',
    '} }\n',
    'function t(k) { return k === \x27backLabel\x27 ? \x27BACK\x27 : k }\n',
    'function escText(el, s) { el.textContent = s == null ? \x27\x27 : String(s) }\n',
    'var state = { focus: null, pathStack: [], byId: new Map() }\n',
    crumbCap[0] + '\n',
    extractBalanced(src, 'function shortName(name, kind) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function pathChainText(labels, sep) {') + '\n',
    extractBalanced(src, 'function idToLabel(id) {') + '\n',
    extractBalanced(src, 'function syncFocusCtl() {') + '\n',
    'return { state: state, CTL: CTL, SEL: SEL, BACK: BACK, sync: syncFocusCtl }',
  ].join('')
  return new Function(body)()
}

test('V22b syncFocusCtl breadcrumb: hidden without a stack, ← BACK (a → b → c) with one, truncates past the cap', () => {
  const dom2 = loadFocusCtlDom()
  const byId = new Map([
    ['a@1', { id: 'a@1', kind: 'package', name: '@deepseek-ai/a' }],
    ['b@1', { id: 'b@1', kind: 'package', name: 'b' }],
    ['c@1', { id: 'c@1', kind: 'package', name: 'c' }],
  ])
  dom2.state.byId = byId
  dom2.sync()
  assert.equal(dom2.CTL.hidden, true, 'no focus -> the whole control hides')
  assert.equal(dom2.BACK.hidden, true, 'no stack -> no back button')
  dom2.state.focus = { rootId: 'a@1', depth: null }
  dom2.sync()
  assert.equal(dom2.CTL.hidden, false)
  assert.equal(dom2.BACK.hidden, true, 'a fresh root has nowhere to go back to')
  dom2.state.pathStack = ['b@1', 'c@1']
  dom2.sync()
  assert.equal(dom2.BACK.hidden, false)
  assert.equal(dom2.BACK.textContent, '\u2190 BACK (b \u2192 c \u2192 a)',
    'labels ride idToLabel (the @deepseek-ai/ prefix is stripped by shortName), current root last')
  assert.equal(dom2.SEL.value, '0', 'depth null still round-trips to the unlimited option')
  dom2.state.focus = { rootId: 'a@1', depth: 2 }
  dom2.sync()
  assert.equal(dom2.SEL.value, '2')
  dom2.state.pathStack = ['x1', 'x2', 'x3', 'x4', 'x5']
  dom2.state.focus = { rootId: 'x6', depth: null }
  dom2.sync()
  assert.equal(dom2.BACK.textContent, '\u2190 BACK (\u2026 \u2192 x3 \u2192 x4 \u2192 x5 \u2192 x6)',
    'over CRUMB_MAX the oldest entries collapse to \u2026')
})

// ---------- fake cytoscape: focus-flow stack/snapshot semantics ----------

function loadFocusFlow() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const stackCap = /var PATH_STACK_CAP = [^\n;]+/.exec(src)
  assert.ok(stackCap, 'app.js must still declare `var PATH_STACK_CAP = …`')
  const body = [
    'var CALLS = [], DEPTH = null\n',
    'function depthOfCtl() { return DEPTH }\n',
    // V2.7 R50 tripwire: focusTransition must never call this again — every
    // CALLS assertion below expects [] (zero snapshot/glide side effects).
    'function snapshotViewport() { CALLS.push(\x27snapshot\x27); state.viewport = { zoom: 3.3, pan: { x: 1, y: 2 } } }\n',
    'var state = { byId: new Map(), groupIds: new Set(["bundle", "fs"]), groupZone: new Map(),\n'
    + '  focus: null, selected: null, pathStack: [],\n'
    + '  view: { collapsedCats: new Set() } }\n',
    stackCap[0] + '\n',
    extractBalanced(src, 'function pushPathStack(stack, id, cap) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function focusTransition(next) {') + '\n',
    extractBalanced(src, 'function exitFocus() {') + '\n',
    extractBalanced(src, 'function focusFlowAction(id, nav) {') + '\n',
    'return { state: state, CALLS: CALLS,\n'
    + '  reset: function (o) { state.byId = new Map(); state.focus = null; state.selected = null; state.pathStack = [];\n'
    + '    state.viewport = null; CALLS.length = 0; Object.assign(state, o || {}) },\n'
    // V2.6 (R46): `nav` rides the second arg exactly like the real call sites:
    // the tap door passes nothing, the explicit doors pass true.
    + '  depth: function (d) { DEPTH = d }, act: function (sel, nav) { return focusFlowAction(sel, nav) } }',
  ].join('')
  return new Function(body)()
}

const PKG = (id) => ({ id, kind: 'package', name: id })

// V2.6 MIGRATION (R46): this V2.2b test entered path mode with the package act
// (the old cold-tap door). The door retired, so ENTRY now rides the nav flag —
// exactly what selectNode(id, true) hands the funnel from the menu command and
// every row/jump/table call site. The cold branch is pinned FIRST, and the
// whole walk/snapshot/stack battery below is UNCHANGED.
test('V2.6 R46 focus flow: the cold package act is inert; NAV enters, walking pushes the previous root, repeat-tap pushes nothing', () => {
  const flow = loadFocusFlow()
  const byId = new Map([['a@1', PKG('a')], ['b@1', PKG('b')], ['c@1', PKG('c')]])
  flow.reset({ byId })
  let act = flow.act('a@1') // the TAP door: no nav flag, cold state
  assert.deepEqual([act.entered, act.walked, act.exited], [false, false, false], 'cold package tap = NO transition of any kind')
  assert.equal(flow.state.focus, null, '…no focus…')
  assert.deepEqual(flow.CALLS, [], '…and not one snapshot/glide side effect')
  assert.equal(flow.state.selected, 'a@1', 'the tap still selects (details panel rides it)')
  act = flow.act('a@1', true)
  assert.deepEqual([act.entered, act.walked, act.exited], [true, false, false], 'nav-driven ENTRY (menu 路径模式 / row / table)')
  assert.deepEqual(flow.state.focus, { rootId: 'a@1', depth: null })
  assert.deepEqual(flow.CALLS, [], 'R50: ENTRY runs ZERO snapshot/glide side effects')
  assert.deepEqual(flow.state.pathStack, [], 'a fresh root starts with an empty stack')
  act = flow.act('a@1')
  assert.deepEqual([act.entered, act.walked], [false, false], 'tapping the current root again is inert')
  assert.deepEqual(flow.CALLS, [], '…and re-snapshots zero times (nothing is left to snapshot)')
  act = flow.act('b@1')
  assert.deepEqual([act.entered, act.walked], [false, true], 'WALK inside the path')
  assert.equal(flow.state.focus.rootId, 'b@1')
  assert.deepEqual(flow.state.pathStack, ['a@1'], 'the previous root entered the stack')
  assert.deepEqual(flow.CALLS, [], 'walking runs no side effect either')
  act = flow.act('c@1')
  assert.deepEqual(flow.state.pathStack, ['a@1', 'b@1'])
  act = flow.act('b@1')
  assert.deepEqual(flow.state.pathStack, ['a@1', 'b@1', 'c@1'], 'back-and-forth walks stack (the user can walk back)')
})

test('V2.7 R50 focus flow: exit clears focus+stack with ZERO side effects; edge taps keep the path', () => {
  const flow = loadFocusFlow()
  flow.reset({ byId: new Map([['a@1', PKG('a')], ['b@1', PKG('b')]]) })
  flow.act('a@1', true) // V2.6 (R46): path mode is entered by explicit nav now
  flow.act('b@1')
  let act = flow.act(null)
  assert.deepEqual([act.entered, act.walked, act.exited], [false, false, true], 'blank tap = EXIT')
  assert.equal(flow.state.focus, null, 'focus cleared')
  assert.deepEqual(flow.state.pathStack, [], 'the stack empties with the focus')
  assert.deepEqual(flow.CALLS, [], 'R50: the exit spends/arms NO camera side effect at all')
  // an edge tap keeps the current focus (edges are not roots, R35)
  flow.reset({ byId: new Map([['a@1', PKG('a')]]) })
  flow.act('a@1', true) // V2.6 (R46): nav entry, then the walk-side battery is unchanged
  act = flow.act('agg:g:x|g:y')
  assert.deepEqual([act.entered, act.walked, act.exited], [false, false, false], 'an edge tap is inert for the path')
  assert.equal(flow.state.focus.rootId, 'a@1', 'focus survives')
  assert.deepEqual(flow.state.pathStack, [], 'no phantom push from the same root')
  // a non-package node (profile / group card / zone) exits
  act = flow.act('profile:web')
  assert.equal(act.exited, true, 'profile tap exits the path (only packages root)')
  // focus installed by hand (the reveal/deep-link shape): the exit is the SAME
  // zero-side-effect chain (R50 retired the armed/disarmed distinction).
  flow.reset({ byId: new Map([['a@1', PKG('a')]]) })
  flow.state.focus = { rootId: 'a@1', depth: null } // installed WITHOUT the entry snapshot
  act = flow.act(null)
  assert.equal(act.exited, true)
  assert.deepEqual(flow.CALLS, [], 'same chain, zero snapshot calls — there is no marker left to arm')
})

test('V22b focus flow: the depth control flows through focusForId with the ctl value', () => {
  const flow = loadFocusFlow()
  flow.reset({ byId: new Map([['a@1', PKG('a')]]) })
  flow.depth(2)
  const act = flow.act('a@1', true) // V2.6 (R46): the nav door still honors the ctl depth
  assert.equal(act.entered, true)
  assert.deepEqual(flow.state.focus, { rootId: 'a@1', depth: 2 }, 'the slider value rides the entry')
})

// ---------- fake cytoscape: ek-off (UI-layer edgeKinds in focus mode) ----------

test('V22b ek-off: focus edges whose kind the user unchecked get ek-off; the class clears on every run', () => {
  const Model = loadModel()
  const logic = loadFocusLogic()
  const graph = fixture()
  const els = paintElements(Model, graph, { focus: { rootId: A1, depth: null } })
  const cy = makeFakeCy(els)
  const real = (s, t, k) => `e:${s}|${t}|${k}`
  // fixture focus of A1 induces: A1→U1 dep, A1→X1 peer, X1→U1 dep, X1→A1
  // peer-optional, B1→A1 dep, WB→A1 mount. Only dep stays checked.
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: A1, depth: null }, selected: A1, view: { edgeKinds: new Set(['dep']) },
  })
  for (const dep of [real(A1, U1, 'dep'), real(X1, U1, 'dep'), real(B1, A1, 'dep')]) {
    assert.ok(cy.getElementById(dep).length, `the focus view carries ${dep}`)
    assert.ok(!cy.classesOf(dep).includes('ek-off'), `${dep} is checked -> stays visible`)
  }
  for (const off of [real(WB, A1, 'mount'), real(A1, X1, 'peer'), real(X1, A1, 'peer-optional')]) {
    assert.ok(cy.getElementById(off).length, `the focus view carries ${off}`)
    assert.ok(cy.classesOf(off).includes('ek-off'), `${off} unchecked -> ek-off (display:none rule hides it)`)
    assert.ok(!cy.classesOf(off).includes('dim'), 'ek-off is NOT dim: the kind filter hides, the focus does not fade')
  }
  // edgeKinds: null (all checked) hides nothing
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: { rootId: A1, depth: null }, selected: A1, view: { edgeKinds: null },
  })
  for (const el of els) assert.ok(!cy.classesOf(el.data.id).includes('ek-off'), 'all kinds checked -> no ek-off anywhere')
  // a cleared run strips ek-off everywhere (same removeClass sweep as the f-* nine)
  logic.apply({
    cy, graph, byId: byIdMap(graph), groupZone: zoneTable(graph),
    focus: null, selected: null, view: { edgeKinds: new Set(['dep']) },
  })
  for (const el of els) assert.ok(!cy.classesOf(el.data.id).includes('ek-off'), `no stale ek-off on ${el.data.id}`)
})

// ---------- real dist: ctx + ek-off are VALID (and do what they claim) ----------

test('V22b dist validity: node.ctx dashed outline + edge.ek-off display:none parse and compute in 3.34.1', () => {
  const Model = loadModel()
  const Cytoscape = loadVendoredCytoscape()
  const graph = fixture()
  const els = paintElements(Model, graph, { focus: { rootId: A1, depth: null } })
  // the app applies ek-off at runtime; replay it on one edge for the probe
  const edgeId = els.find((e) => e.group === 'edges').data.id
  els.forEach((e) => { if (e.data.id === edgeId) e.classes = [...e.classes, 'ek-off'] })
  const mod = loadAppStyle(graph)
  for (const theme of ['light', 'dark']) {
    let cy
    const warns = captureWarnings(() => {
      cy = Cytoscape({ headless: true, styleEnabled: true, elements: els })
      cy.style(mod.styleFor(theme))
    })
    try {
      assert.deepEqual(warns, [], `${theme}: the frozen dist rejected the V22b style rules:\n  ${warns.join('\n  ')}`)
      const zone = cy.getElementById('cat:kernel')
      assert.ok(zone.length && zone.hasClass('ctx'), 'the focus view zones carry ctx')
      assert.equal(pstr(zone, 'border-style'), 'dashed', 'ctx paints the dashed outline')
      assert.ok(pnum(zone, 'background-opacity') <= 0.08,
        `ctx containers fade to background-opacity <= 0.08 (got ${pnum(zone, 'background-opacity')})`)
      const card = cy.getElementById('g:bundle')
      assert.equal(pstr(card, 'border-style'), 'dashed', 'ctx also restyles the group containers')
      const hidden = cy.getElementById(edgeId)
      assert.equal(pstr(hidden, 'display'), 'none', 'ek-off hides the edge — display:none is VALID for edges in this dist')
    } finally {
      if (cy) cy.destroy()
    }
  }
})

// ---------- V2.7 R50 MIGRATION: fit-to-path + viewport snapshot/restore ----------
// The two V2.2b tests built on loadViewportLogic (「fit-to-path excludes ctx
// numerically」, 「snapshot deep-copies / restore self-disarms」) and the harness
// itself are DELETED HERE ON PURPOSE: every symbol they exercised (pathFitEles,
// snapshotViewport, restoreViewport, animateFitPath, state.viewport) is retired
// dead code by R50 — entry-capture, the exit restore-glide and the entry/walk
// fit-glide are all gone. Their intent (「a focus transition never moves the
// camera」) is re-asserted ZERO-CAMERA by the real-handler battery in
// test/ctx-menu-wiring.test.mjs, the loadExitWiring tests below and the V2.7 R50
// camera audit.

// ---------- Esc ordering (extracted against stub DOM) ----------

function loadEscLogic() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var CALLS = []\n',
    'var BOX = { hidden: true }\n',
    'var MENU = { hidden: true }\n',
    'var document = { getElementById: function (id) {\n'
    + '  return id === \x27search-results\x27 ? BOX : id === \x27ctx-menu\x27 ? MENU : null } }\n',
    'var state = { focus: null, pathStack: [], selected: \x27z\x27 }\n',
    'function syncFocusCtl() { CALLS.push(\x27sync\x27) }\n',
    'function renderDetails(id) { CALLS.push(\x27details:\x27 + id) }\n',
    'function paint() { CALLS.push(\x27paint\x27) }\n',
    extractBalanced(src, 'function exitFocus() {') + '\n',
    extractBalanced(src, 'function exitFocusCommand() {') + '\n',
    extractBalanced(src, 'function onGlobalKey(e) {') + '\n',
    'return { BOX: BOX, MENU: MENU, CALLS: CALLS, state: state, key: onGlobalKey }',
  ].join('')
  return new Function(body)()
}

test('V22b Esc ordering: open search results close first; then focus exits; text inputs are never hijacked', () => {
  const esc = loadEscLogic()
  // 1. results open -> ONLY the results close, even with a live focus
  esc.BOX.hidden = false
  esc.state.focus = { rootId: 'a@1', depth: null }
  esc.state.pathStack = ['x']
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.equal(esc.BOX.hidden, true, 'the results box closed')
  assert.ok(esc.state.focus, 'the focus survived the results-closing Esc')
  assert.deepEqual(esc.CALLS, [], 'nothing else ran')
  // 2. results closed + focus active -> the path exits. V2.7 R50 MIGRATION: the
  // old tail was paint → animate-back off the armed entry snapshot; the snapshot
  // is retired, so the chain ENDS at the viewport-kept repaint.
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.equal(esc.state.focus, null, 'focus exited')
  assert.deepEqual(esc.state.pathStack, [], 'stack cleared by the exit')
  assert.deepEqual(esc.CALLS, ['details:z', 'sync', 'paint'],
    'details → ctl → viewport-kept repaint — and NO camera step after it (R50)')
  // 3. plain view -> no-op
  esc.CALLS.length = 0
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.deepEqual(esc.CALLS, [], 'no results, no focus -> Esc does nothing')
  // 4. a text input keeps its own Esc semantics (future-proof guard) — with results CLOSED
  esc.state.focus = { rootId: 'a@1', depth: null }
  for (const tag of ['INPUT', 'TEXTAREA', 'SELECT']) {
    esc.key({ key: 'Escape', target: { tagName: tag } })
    assert.ok(esc.state.focus, `${tag} keeps the focus mode intact`)
  }
  esc.key({ key: 'Escape', target: { isContentEditable: true } })
  assert.ok(esc.state.focus, 'contenteditable too')
  assert.deepEqual(esc.CALLS, [], 'not one handler ran while typing')
  // and with results OPEN, Esc still closes just the results from inside the search input
  esc.BOX.hidden = false
  esc.key({ key: 'Escape', target: { tagName: 'INPUT' } })
  assert.equal(esc.BOX.hidden, true, 'results still close (the brief-exempt branch)')
  assert.ok(esc.state.focus, '…without touching the focus')
  // 5. unrelated keys ignore
  esc.BOX.hidden = false
  esc.key({ key: 'q', target: { tagName: 'BODY' } })
  assert.equal(esc.BOX.hidden, false, 'not Esc -> nothing happens')
  // V2.5 R44: the context menu takes PRIORITY over both — menu > results > focus.
  esc.CALLS.length = 0
  esc.MENU.hidden = false
  esc.BOX.hidden = false
  esc.state.focus = { rootId: 'a@1', depth: null }
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.equal(esc.MENU.hidden, true, 'the first Esc closes ONLY the menu')
  assert.equal(esc.BOX.hidden, false, 'the results panel is untouched')
  assert.ok(esc.state.focus, 'the focus is untouched')
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.equal(esc.BOX.hidden, true, 'the second Esc closes the results')
  assert.ok(esc.state.focus, '…and still not the focus')
  esc.key({ key: 'Escape', target: { tagName: 'BODY' } })
  assert.equal(esc.state.focus, null, 'the third Esc exits the focus (V2.5 funnel)')
  assert.deepEqual(esc.CALLS, ['details:z', 'sync', 'paint'],
    'the menu-level Esc ran ZERO exit handlers until its own level was reached')
})

// ---------- wiring-level: the REAL tap/Esc handlers drive the REAL exit chain ----------
// Everything that decides the path mode runs from app.js here: bindCy (the actual
// cy.on('tap', …) registration), selectNode/focusFlowAction/focusTransition/
// exitFocus/exitFocusCommand/focusForId/groupFocusShape/isFocusRoot/
// pushPathStack (V2.7 R50: the viewport-snapshot trio retired with the camera
// chain itself) + the V2.5 menu-close
// guards. Only the leaf side effects are recording stubs: paint (its own
// behaviour has a dedicated suite) plus details/ctl chrome and the peek card.
// paint records WHETHER focus was still installed when it ran, which is what
// pins the paint-then-NOTHING order on the exit (V2.7 R50 retired the glide).
// V2.5: paint lost its refit
// argument (keep-viewport IS the default now) — the stub just says "paint".

function loadExitWiring() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const stackCap = /var PATH_STACK_CAP = [^\n;]+/.exec(src)
  assert.ok(stackCap, 'app.js must still declare `var PATH_STACK_CAP = …`')
  const body = [
    'var LOG = [], ANIMS = []\n',
    'var BOX = { hidden: true }\n',
    'var document = { getElementById: function (id) { return id === "search-results" ? BOX : null } }\n',
    'function depthOfCtl() { return null }\n',
    'function t(k) { return k }\n',
    'function hidePeek() { LOG.push("peek-off") }\n',
    'function showPeek() {}\n',
    'function toggleGroup() {}\n',
    'function renderDetails(id) { LOG.push("details") }\n',
    'function syncFocusCtl() { LOG.push("sync") }\n',
    'function paint() { LOG.push("paint" + (state.focus ? ":focus" : ":nofocus")) }\n',
    'var PEEK_DEBOUNCE_MS = 250\n',
    'var menuSwallow = false\n',
    'var state = { graph: {}, cy: null, byId: new Map(), focus: null, selected: null, pathStack: [],\n'
    + '  tableMode: false, view: { collapsedCats: new Set(), granularity: "groups" } }\n',
    'function coll(items) {\n'
    + '  return { length: items.length, items: items, filter: function (f) { return coll(items.filter(f)) } }\n'
    + '}\n',
    'var GRAPH_NODES = [\n'
    + '  { id: "a@1", kind: "pkg" }, { id: "u@1", kind: "pkg" }, { id: "cat:kernel", kind: "zone" }]\n'
    + '.map(function (n) { return { isElement: true, id: function () { return n.id },\n'
    + '    data: function (k) { return k === "kind" ? n.kind : n.id } } })\n',
    'var vp = { zoom: 1.35, pan: { x: -40, y: 90 } }\n',
    'var handlers = []\n',
    'var cy = {\n',
    '  on: function (evt, sel, fn) { if (typeof sel === "function") { fn = sel; sel = null } handlers.push({ evt: evt, sel: sel, fn: fn }) },\n',
    '  // cytoscape hands pan()/zoom() back as the live viewport: hand back a COPY so a\n',
    '  // shallow snapshot cannot accidentally look correct through aliasing.\n',
    '  pan: function () { return { x: vp.pan.x, y: vp.pan.y } },\n',
    '  zoom: function () { return vp.zoom },\n',
    '  nodes: function () { return coll(GRAPH_NODES) },\n',
    '  animate: function (o) { ANIMS.push(o); LOG.push("animate") },\n',
    '  trigger: function (evt, target) {\n',
    '    handlers.forEach(function (h) {\n',
    '      if (h.evt !== evt) return\n',
    '      if (h.sel === null) { if (target === cy) h.fn({ target: target }) }\n',
    '      else if (target && target.isElement) h.fn({ target: target })\n',
    '    })\n',
    '  },\n',
    '}\n',
    stackCap[0] + '\n',
    extractBalanced(src, 'function pushPathStack(stack, id, cap) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function focusTransition(next) {') + '\n',
    extractBalanced(src, 'function focusFlowAction(id, nav) {') + '\n',
    extractBalanced(src, 'function exitFocus() {') + '\n',
    extractBalanced(src, 'function exitFocusCommand() {') + '\n',
    extractBalanced(src, 'function afterFocusChange(act, id) {') + '\n',
    extractBalanced(src, 'function menuIsOpen() {') + '\n',
    extractBalanced(src, 'function closeMenu() {') + '\n',
    extractBalanced(src, 'function swallowMenuTap() {') + '\n',
    extractBalanced(src, 'function onCtxTap(evt) {') + '\n',
    extractBalanced(src, 'function onCtxTapBackground(evt) {') + '\n',
    extractBalanced(src, 'function onCanvasGesture() {') + '\n',
    extractBalanced(src, 'function onCanvasMouseDown() {') + '\n',
    extractBalanced(src, 'function selectNode(id, nav) {') + '\n',
    extractBalanced(src, 'function bindCy() {') + '\n',
    extractBalanced(src, 'function onGlobalKey(e) {') + '\n',
    'state.cy = cy\n',
    'state.byId = new Map([["a@1", { id: "a@1", kind: "package", name: "a" }]])\n',
    'return { state: state, cy: cy, BOX: BOX, LOG: LOG, ANIMS: ANIMS,\n'
    + '  bind: function () { bindCy() },\n'
    + '  tap: function (target) { cy.trigger("tap", target) },\n'
    // V2.6 (R46): the browser hands selectNode(id, true) from menu-row/details-row/
    // table-row click handlers; selectNode here is the REAL extracted function, so
    // this is the honest stand-in for those call sites (the tap handler itself can
    // no longer enter — pinned by the lightweight assertion in the test below).
    + '  navSelect: function (id) { selectNode(id, true) },\n'
    + '  esc: function () { onGlobalKey({ key: "Escape", target: { tagName: "BODY" } }) },\n'
    + '  pkg: function () { return GRAPH_NODES[0] },\n'
    + '  liveZoom: function () { return vp.zoom },\n'
    + '  // the user dragging/zooming the canvas themselves: the app must be indifferent.\n'
    + '  moveCamera: function (z, x, y) { vp.zoom = z; vp.pan.x = x; vp.pan.y = y } }',
  ].join('')
  return new Function(body)()
}

test('V2.7 R50 exit wiring: the registered blank-tap handler runs entry and exit with ZERO camera ops — the snapshot chain is gone', () => {
  const w = loadExitWiring()
  w.bind() // the real cy.on('tap', …) registration, no manual state poking
  const animsOf = () => w.ANIMS.length
  // V2.6 MIGRATION (R46) pinned the lightweight cold tap; V2.7 R50 MIGRATION:
  // every camera assertion below REVERSED from the V2.2b/V2.5 matrices — the
  // entry glide, the walk glide, the exit restore and the entry snapshot are all
  // retired. The battery now runs the REAL chain end to end and the ANIMS record
  // proves the camera NEVER moved.
  w.tap(w.pkg())
  assert.equal(w.state.focus, null, 'the registered tap handler roots NOTHING from the cold state')
  assert.equal(w.state.selected, 'a@1', '…but the tap still selects')
  assert.equal(animsOf(), 0, '…and moves the camera zero times')
  // --- ENTRY through the explicit nav door (menu 依赖图 / dbl-tap / row / table) ---
  w.navSelect('a@1')
  assert.deepEqual(w.state.focus, { rootId: 'a@1', depth: null }, 'explicit nav roots the path')
  assert.equal(animsOf(), 0, 'R50: entry fires ZERO camera ops (the fit glide is retired)')
  assert.equal(w.state.viewport, undefined, 'R50: state.viewport no longer EXISTS — the snapshot mechanism is deleted')
  // the reader may move the camera themselves — the app must not care
  w.moveCamera(3.1, 777, -888)
  w.LOG.length = 0
  // --- EXIT through the SAME registered blank-tap handler ---
  w.tap(w.cy)
  assert.equal(w.state.focus, null, 'the blank tap exited the path')
  assert.deepEqual(w.LOG, ['peek-off', 'details', 'sync', 'paint:nofocus'],
    'peek off → details → ctl → ONE viewport-kept repaint — nothing follows it')
  assert.equal(animsOf(), 0, '…and the exit glides NOTHING back (the armed-snapshot exit is retired)')
  // a second blank tap: the same plain repaint, still no camera
  w.LOG.length = 0
  w.tap(w.cy)
  assert.equal(animsOf(), 0, 'no animate anywhere, ever')
  assert.deepEqual(w.LOG, ['peek-off', 'details', 'sync', 'paint:nofocus'], 'a plain repaint, no camera move')
})

test('V2.7 R50 exit wiring: Esc runs the same zero-camera chain, and the 退出依赖图 button stays a ONE-call delegation into the funnel', () => {
  const w = loadExitWiring()
  w.bind()
  w.navSelect('a@1') // V2.6 (R46): entry via the explicit nav door (see the test above)
  w.moveCamera(2.4, 500, 500)
  w.LOG.length = 0
  w.esc()
  assert.equal(w.state.focus, null, 'Esc exited the path')
  assert.equal(w.ANIMS.length, 0, 'R50: Esc exits with ZERO camera ops')
  assert.deepEqual(w.LOG, ['details', 'sync', 'paint:nofocus'],
    'details → ctl → ONE viewport-kept repaint — the chain ends there (peek is not part of the Esc chain)')
  // 退出依赖图 (V2.5-M1 delegation + V2.7 R48 rename): the button body stays ONE
  // call, and the funnel it delegates to now ENDS at the repaint.
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const clear = src.slice(src.indexOf("getElementById(\'focus-clear\')"), src.indexOf("var pathBack = document"))
  assert.ok(clear.length > 0, 'the 退出依赖图 handler is still in app.js')
  const clearCode = clear.replace(/\/\/[^\n]*/g, '')
  assert.match(clearCode, /addEventListener\('click',\s*function\s*\(\)\s*\{\s*exitFocusCommand\(\)\s*\}\)/,
    'the button body is ONE call — the exit lives only in the funnel (menu row and Esc share it)')
  assert.ok(!/exitFocus\(\)/.test(clearCode), 'no re-spelled inline exit sequence survives in the button')
  const funnel = extractBalanced(src, 'function exitFocusCommand() {')
  const iExit = funnel.indexOf('exitFocus()')
  const iPaint = funnel.indexOf('paint()')
  assert.ok(iExit >= 0 && iPaint >= 0 && iExit < iPaint, 'exitFocus → repaint, in that order')
  assert.ok(!/restoreViewport|snapshotViewport|animate/.test(funnel),
    'the exit funnel ends at the repaint — the glide that used to trail it is retired (R50)')
})

// ---------- peek: single reusable card, focus-invariant ----------

function loadPeekDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const cap = /var PEEK_DESC_CAP = [^\n;]+/.exec(src)
  assert.ok(cap, 'app.js must still declare `var PEEK_DESC_CAP = …`')
  const body = [
    'var CREATE_CALLS = 0, HIDES = 0\n',
    'function El(tag) { this.tag = tag; this.children = []; this.className = \x27\x27; this.hidden = true; this.style = {}; this.appendChild = function (c) { this.children.push(c); return c } }\n',
    'Object.defineProperty(El.prototype, \x27textContent\x27, { get: function () { return this.text || \x27\x27 }, set: function (v) { this.text = String(v); this.children.length = 0 } })\n',
    'var GRAPH = new El(\x27div\x27); GRAPH.clientWidth = 500; GRAPH.clientHeight = 400\n',
    'var document = {\n',
    '  getElementById: function (id) {\n',
    '    if (id === \x27graph\x27) return GRAPH\n',
    '    if (id === \x27peek-card\x27) {\n',
    '      for (var i = 0; i < GRAPH.children.length; i++) { if (GRAPH.children[i].id === \x27peek-card\x27) return GRAPH.children[i] }\n',
    '      return null\n',
    '    }\n',
    '    return null\n',
    '  },\n',
    '  createElement: function (tag) { CREATE_CALLS++; return new El(tag) },\n',
    '  createTextNode: function (s) { return { tag: \x27#text\x27, text: String(s), children: [] } },\n',
    '}\n',
    'var state = { graph: null, byId: new Map(), lang: \x27zh\x27, focus: null, selected: null, tableMode: false }\n',
    'function t(k) { return k }\n',
    'function hidePeek() { HIDES++ }\n',
    cap[0] + '\n',
    extractBalanced(src, 'var DOWN_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'var UP_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'function catTitle(categories, catId, lang) {') + '\n',
    extractBalanced(src, 'function groupZoneOf(graph, gid) {') + '\n',
    extractBalanced(src, 'function buildPeekCard(n, graph, byId, lang) {') + '\n',
    extractBalanced(src, 'function escText(el, s) {') + '\n',
    extractBalanced(src, 'function renderPeek(card, p) {') + '\n',
    extractBalanced(src, 'function peekCard() {') + '\n',
    extractBalanced(src, 'function positionPeek(card, el) {') + '\n',
    extractBalanced(src, 'function showPeek(el) {') + '\n',
    'return { state: state, GRAPH: GRAPH, CREATE_CALLS: function () { return CREATE_CALLS }, CREATE_CALLS_N: 0, showPeek: showPeek, peekCard: peekCard }',
  ].join('')
  return new Function(body)()
}

test('V22b peek works WHILE a focus is active and never touches focus/selected (the core user story)', () => {
  const pk = loadPeekDom()
  const g = peekFixture()
  pk.state.graph = g
  pk.state.byId = byIdMap(g)
  pk.state.focus = { rootId: 'a@1', depth: null } // the user is deep in path mode
  pk.state.selected = 'a@1'
  const mkNode = (id, kind, name, count) => ({
    id: () => id,
    data: (k) => ({ id: id, kind: kind, name: name, count: count }[k]),
    removed: () => false,
    renderedBoundingBox: () => ({ x1: 10, y1: 10, x2: 26, y2: 26 }),
  })
  pk.showPeek(mkNode('b@1', 'pkg', 'b@1', undefined))
  const card = pk.GRAPH.children[0]
  assert.ok(card, 'the peek card lives inside the #graph container')
  const texts = card.children.map((c) => c.text)
  assert.ok(texts.some((s) => s.startsWith('beta@2.0.0')), `the peeked member renders: ${JSON.stringify(texts)}`)
  assert.deepEqual([pk.state.focus.rootId, pk.state.selected], ['a@1', 'a@1'],
    'peeking a lit member changed NOTHING about the root or the selection — focus is intact')
  // the same card element is reused for the next hover (no per-hover DOM churn)
  pk.showPeek(mkNode('c@1', 'pkg', 'c@1', undefined))
  assert.equal(pk.GRAPH.children.length, 1, 'the same single card lives in #graph, never a second one')
  assert.equal(pk.GRAPH.children[0], card, '…and it is the SAME element, reused not rebuilt')
  const texts2 = pk.GRAPH.children[0].children.map((c) => c.text)
  assert.ok(texts2.some((s) => s.startsWith('gamma@3.0.0')), 'and it now shows the new member')
})

// ---------- grep guards for the wiring that the fake harnesses cannot reach ----------

test('V22b wiring guards: dbl-click gates, paint mirrors focus into view, chip buttons', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  // double-click gates: manual group collapse only makes sense on the 组级 tier —
  // at 包级 every group is expanded BY DEFINITION (the model ignores collapsedGroups).
  // V2.4b refined the second gate: inside a live PACKAGE path it stays inert, but
  // the ROOT CARD of a live GROUP focus keeps its toggle — the tap-tap-dbltap
  // sequence enters the group focus on the taps and opens the group on the gesture
  // (the V24b real-handler test pins the whole chain).
  const dbl = src.slice(src.indexOf("cy.on('dbltap', 'node.group'"), src.indexOf("cy.on('tap', 'node, edge'"))
  assert.match(dbl, /if \(state\.view\.granularity !== 'groups'\) return/,
    'the packages tier makes group dbl-click a no-op (README); 组级 restores the toggle')
  assert.match(dbl, /if \(state\.focus && !\(isGroupRootId\(state\.focus\.rootId\) && state\.focus\.rootId === String\(evt\.target\.data\('id'\)\)\)\) return/,
    'inside a focus only the group-focus ROOT card stays toggleable; package roots keep the full V2.2b inertness')
  assert.match(dbl, /toggleGroup\(String\(evt\.target\.data\('id'\)\)\.replace\(\/\^g:\/, ''\)\)/,
    'the groups tier routes the dbl-click to the real collapse toggle')
  // V2.7 R49: the PACKAGE dbl-tap door shares the menu's nav funnel verbatim
  assert.match(dbl, /cy\.on\('dbltap', 'node\.pkg', function \(evt\) \{[\s\S]*?if \(!evt\.target\.hasClass\('pkg'\)\) return[\s\S]*?selectNode\(evt\.target\.id\(\), true\)/,
    'R49: dbl-tapping a package enters the dependency graph through selectNode(id, true)')
  // the zone shell keeps its own gate: inert inside a path only (both tiers)
  const zdbl = src.slice(src.indexOf("cy.on('dbltap', 'node.zone'"), src.indexOf("cy.on('dbltap', 'node.group'"))
  assert.match(zdbl, /if \(state\.focus\) return/, 'zone dbl-click stays inert inside a path')
  assert.doesNotMatch(zdbl, /granularity/, 'zone collapse is tier-independent (a collapsed zone is a collapsed zone)')
  // paint is the single place the focus mirror enters the model view
  assert.match(src, /state\.view\.focus = state\.focus/, 'paint mirrors state.focus into view.focus (view→paint flow)')
  // V2.5 (R45): the auto-refit is RETIRED — every structural repaint keeps the
  // viewport. The V22b refit-targeting inside paint (the three-state meta.focus
  // branch + the pathFitEles fit) must never come back; the boot first frame
  // (state.fitted gate) is the only fit paint performs, and NO caller passes a
  // keep/refit argument anymore (keep is the signature-free default).
  assert.doesNotMatch(src, /built\.meta\.focus/, 'no refit-decision focus test survives inside paint')
  assert.doesNotMatch(src, /state\.cy\.fit\(pathFitEles\(state\.cy\), 40\)/,
    'paint no longer refits the path — R50: the ONLY camera moves are the boot fit, the ⌂ reset and the reveal flash, all OUTSIDE paint')
  assert.match(src, /if \(!state\.fitted\) \{[\s\S]{0,200}?state\.fitted = true[\s\S]{0,120}?state\.cy\.fit\(undefined, 24\)/,
    'the boot first frame fits exactly once through the state.fitted gate')
  assert.doesNotMatch(src, /paint\((false|true|refit)\)/, 'no caller passes a refit argument — paint() keeps the viewport, always')
  // chip UI: solo on dblclick + the two row-tail buttons
  assert.match(src, /addEventListener\('dblclick'/, 'chips carry a dblclick handler (solo)')
  assert.match(src, /state\.view\.filterCats = soloToggleFor\(cats, state\.view\.filterCats, id\)/, 'dblclick routes through the pure solo predicate')
  assert.match(src, /t\('chipShowAll'\)/, 'show-all button label')
  assert.match(src, /t\('chipHideAll'\)/, 'hide-all button label')
  assert.match(src, /state\.view\.filterCats = showAllCats\(\)/, 'show-all clears the exclude set')
  assert.match(src, /state\.view\.filterCats = hideAllCats\(cats\)/, 'hide-all excludes everything')
  // the peek card is created once and reused; hovering never writes focus
  const peekFn = src.slice(src.indexOf('function showPeek(el) {'), src.indexOf('function positionPeek(card, el) {'))
  assert.ok(peekFn.includes('function showPeek(el) {'), 'showPeek still exists')
  assert.doesNotMatch(peekFn, /createElement/, 'showPeek creates nothing — the reusable card comes from peekCard()')
  assert.doesNotMatch(peekFn, /state\.focus\s*=[^=]|state\.selected\s*=[^=]|selectNode\(|exitFocus\(/,
    'hovering a member cannot disturb the focus/selection')
  assert.match(src, /granularity: 'groups'/, 'the model-level default tier is groups')
})

test('V22b index.html: granularity segment, back button, and the exit rename ship', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  assert.match(html, /<button id="path-back"[^>]*hidden/, 'the breadcrumb back button ships hidden inside #focus-ctl')
  const ctl = /<span id="focus-ctl"[\s\S]*?<\/span>/.exec(html)
  assert.ok(ctl, '#focus-ctl block')
  assert.ok(html.indexOf('id="path-back"') > html.indexOf('id="focus-ctl"'), 'the breadcrumb rides INSIDE #focus-ctl')
  assert.match(html, /id="focus-clear" data-i18n="focusOff">退出依赖图/, 'V2.7 R48: 退出路径 renamed 退出依赖图 (exit the dependency graph)')
})

test('V22b style.css: peek card, segment control, tier headers and breadcrumb get minimal rules', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  assert.match(css, /#graph\s*\{[^}]*position:\s*relative/, '#graph anchors the absolute peek card')
  assert.match(css, /#peek-card\s*\{[^}]*position:\s*absolute/, 'the peek card is absolutely positioned')
  assert.match(css, /#peek-card\s*\{[^}]*pointer-events:\s*none/, 'the card never eats canvas events (no hover flicker loop)')
  assert.match(css, /#peek-card\[hidden\]\s*\{[^}]*display:\s*none/, 'hidden peek is truly invisible')
  assert.match(css, /#lod-ctl\s*\{[^}]*display:\s*inline-flex/, 'segment control display')
  assert.match(css, /#lod-ctl button\.on\b/, 'the active segment is marked')
  assert.match(css, /\.tier\s*\{[^}]*cursor:\s*pointer/, 'tier headers are clickable')
  assert.match(css, /#path-back\[hidden\]\s*\{[^}]*display:\s*none/, 'the breadcrumb hides via [hidden] like its siblings')
})

test('V2.3 style.css: the member-row 断链 flag rides the 未满足 treatment, no parallel row design', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  const unsat = /#details \.jump \.unsat\s*\{([^}]*)\}/.exec(css)
  const brk = /#details \.jump \.brk\s*\{([^}]*)\}/.exec(css)
  assert.ok(unsat, 'the 未满足 flag rule is still there')
  assert.ok(brk, 'V2.3: the member-row 断链 flag is styled (app.js writes .brk)')
  assert.equal(brk[1].trim(), unsat[1].trim(), 'same red, same size — a second flag, not a second design')
  assert.doesNotMatch(css, /\.member\b|\.memrow\b/, 'the member list reuses .jump/.badge — no parallel row CSS')
  assert.match(css, /#lod-ctl button\.on\b/, 'the segment control still marks the lit tier (two states, same shell)')
})

// ---------- chip bar behaviour (fake DOM) ----------

function loadChipDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var PAINTS = []\n',
    'function El(tag) {\n',
    '  this.tag = tag; this.children = []; this.className = \x27\x27; this.text = \x27\x27; this.handlers = {}; this.style = {}\n',
    '  var self = this; this.children_ = this.children\n',
    '  this.appendChild = function (c) { this.children.push(c); return c }\n',
    '  this.addEventListener = function (k, fn) { this.handlers[k] = fn }\n',
    '  this.classList = { add: function () {}, toggle: function () {} }\n',
    '}\n',
    'Object.defineProperty(El.prototype, \x27textContent\x27, {\n',
    '  get: function () { return this.text },\n',
    '  set: function (v) { this.text = String(v); this.children.length = 0 },\n',
    '})\n',
    'var BOX = new El(\x27div\x27)\n',
    'var document = { getElementById: function (id) { return id === \x27zone-chips\x27 ? BOX : null }, createElement: function (t) { return new El(t) } }\n',
    'var state = { graph: null, view: { filterCats: new Set() }, theme: \x27light\x27, lang: \x27zh\x27 }\n',
    extractBalanced(src, 'var ZONE_COLORS = {') + '\n',
    extractBalanced(src, 'var ZONE_IDS_FALLBACK = [') + '\n',
    extractBalanced(src, 'function soloToggleFor(allCats, current, id) {') + '\n',
    extractBalanced(src, 'function hideAllCats(allCats) {') + '\n',
    extractBalanced(src, 'function showAllCats() {') + '\n',
    'function t(k) { return k }\n',
    'function paint() { PAINTS.push([].concat(Array.from(state.view.filterCats)).sort().join(\x27,\x27)) }\n',
    'function escText(el, s) { el.textContent = s == null ? \x27\x27 : String(s) }\n',
    'function catById() { var m = new Map(); (((state.graph && state.graph.categories) || []).forEach(function (c) { if (c && c.id != null) m.set(String(c.id), c) })); return m }\n',
    extractBalanced(src, 'function zoneTitle(catId) {') + '\n',
    extractBalanced(src, 'function allCatIds() {') + '\n',
    extractBalanced(src, 'function buildZoneChips() {') + '\n',
    'return { state: state, BOX: BOX, PAINTS: PAINTS, build: buildZoneChips }',
  ].join('')
  return new Function(body)()
}

test('V22b chip bar: click exclusion (V6) survives, dblclick solos, row-tail buttons show/hide all', () => {
  const dom2 = loadChipDom()
  dom2.state.graph = {
    categories: [
      { id: 'kernel', zh: 'Kernel', en: 'Kernel' },
      { id: 'tools', zh: 'Tools', en: 'Tools' },
      { id: 'plugin', zh: 'Plugin', en: 'Plugin' },
    ],
  }
  dom2.build()
  const kids = () => dom2.BOX.children
  assert.equal(kids().length, 5, 'three chips + the two row-tail buttons')
  assert.equal(kids()[3].text, 'chipShowAll')
  assert.equal(kids()[4].text, 'chipHideAll')
  // V6 semantics survive: single click excludes the chip zone, click again restores
  kids()[0].handlers.click()
  assert.deepEqual([...dom2.state.view.filterCats], ['kernel'], 'single click still EXCLUDES (R32)')
  kids()[0].handlers.click()
  assert.deepEqual([...dom2.state.view.filterCats], [], '…and the second click restores')
  // dblclick solos (the two co-fired clicks cancel out: kernel was toggled off then on)
  kids()[0].handlers.click(); kids()[0].handlers.click(); kids()[0].handlers.dblclick()
  assert.deepEqual([...dom2.state.view.filterCats].sort(), ['plugin', 'tools'], 'double-click kernel = every other zone hidden')
  const afterRebuild = kids()
  afterRebuild[0].handlers.click(); afterRebuild[0].handlers.click(); afterRebuild[0].handlers.dblclick()
  assert.deepEqual([...dom2.state.view.filterCats], [], 'the same chip again restores everything (solo is a toggle)')
  kids()[4].handlers.click()
  assert.deepEqual([...dom2.state.view.filterCats].sort(), ['kernel', 'plugin', 'tools'], 'hide-all excludes every zone')
  kids()[3].handlers.click()
  assert.deepEqual([...dom2.state.view.filterCats], [], 'show-all clears the exclude set')
  assert.ok(dom2.PAINTS.length >= 8, 'every mutation repaints')
})

// =========================================================================
// Task V2.3 — container member lists. The rows are DOM code wired straight into
// the reveal/focus chain, so they run for real: the row builders AND
// revealNode/expandPath/focusForId are extracted VERBATIM from app.js and
// executed against a fake document + fake cytoscape. A row click that merely
// "looks wired" fails here — state.focus has to end up rooted on the row.
// =========================================================================

function loadMembersDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const cap = /var GROUP_MEMBER_CAP = [^\n;]+/.exec(src)
  assert.ok(cap, 'app.js must still declare `var GROUP_MEMBER_CAP = …`')
  const body = [
    'var LOG = []\n',
    'var KEYS = { memberPkgsLabel: \x27MEMBERS({n})\x27, moreLabel: \x27+{n} MORE\x27, unsatLabel: \x27UNSAT\x27, brokenLabel: \x27BROKEN\x27 }\n',
    'function t(k) { return Object.prototype.hasOwnProperty.call(KEYS, k) ? KEYS[k] : k }\n',
    'function depthOfCtl() { return null }\n',
    'function paint() { LOG.push(\x27paint\x27 + (state.focus ? \x27:focus\x27 : \x27:nofocus\x27)) }\n',
    'function renderDetails() { LOG.push(\x27details\x27) }\n',
    'function syncFocusCtl() { LOG.push(\x27sync\x27) }\n',
    'function flashReveal(id) { LOG.push(\x27flash:\x27 + id) }\n',
    'function El(tag) {\n',
    '  this.tag = tag; this.children = []; this.className = \x27\x27; this.text = \x27\x27; this.handlers = {}; this.hidden = false\n',
    '  this.appendChild = function (c) { this.children.push(c); return c }\n',
    '  this.addEventListener = function (k, fn) { this.handlers[k] = fn }\n',
    '}\n',
    'Object.defineProperty(El.prototype, \x27textContent\x27, {\n',
    '  get: function () { return this.text },\n',
    '  set: function (v) { this.text = String(v); this.children.length = 0 },\n',
    '})\n',
    'var document = {\n',
    '  createElement: function (tag) { return new El(tag) },\n',
    '  createTextNode: function (s) { return { tag: \x27#text\x27, text: String(s), children: [], className: \x27\x27 } },\n',
    '}\n',
    // fake cytoscape: kept for the chain’s reach; R50: revealNode reads no viewport
    'var cy = {\n',
    '  pan: function () { return { x: 11, y: 22 } }, zoom: function () { return 1.25 },\n',
    '  animate: function () { LOG.push(\x27animate\x27) },\n',
    '  getElementById: function () { return { length: 0 } },\n',
    '}\n',
    'var state = {\n',
    '  graph: null, byId: new Map(), groupIds: new Set(), groupZone: new Map(), cy: cy, tableMode: false,\n',
    '  focus: null, selected: null, pathStack: [], lang: \x27zh\x27,\n',
    '  view: { collapsedCats: new Set(), collapsedGroups: null, filterCats: new Set(), granularity: \x27groups\x27, focus: null },\n',
    '}\n',
    cap[0] + '\n',
    extractBalanced(src, 'function escText(el, s) {') + '\n',
    extractBalanced(src, 'function kvRow(box, key, value) {') + '\n',
    extractBalanced(src, 'function secTitle(box, text) {') + '\n',
    extractBalanced(src, 'function groupZoneOf(graph, gid) {') + '\n',
    extractBalanced(src, 'function buildGroupMembers(sel, graph) {') + '\n',
    extractBalanced(src, 'function memberRow(box, row, onClick) {') + '\n',
    extractBalanced(src, 'function memberSection(box, sel) {') + '\n',
    extractBalanced(src, 'function gidOf(n) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    extractBalanced(src, 'function expandPath(n) {') + '\n',
    extractBalanced(src, 'function exitFocus() {') + '\n',
    extractBalanced(src, 'function revealNode(n) {') + '\n',
    'return { state: state, LOG: LOG, El: El, memberSection: memberSection, CAP: GROUP_MEMBER_CAP }',
  ].join('')
  return new Function(body)()
}

/** the member-list graph every V2.3 DOM test shares (attacker strings included) */
function membersGraph() {
  const evil = '<img src=x onerror=alert(1)>'
  return {
    evil: evil,
    graph: {
      categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }],
      groups: [{ id: 'bundle', kind: 'official', category: 'kernel', packageCount: 3 }],
      nodes: [
        { id: 'a@1', kind: 'package', name: 'alpha', version: '1.0.0', group: 'bundle', category: 'kernel', scope: 'official' },
        { id: evil, kind: 'package', name: evil, version: '<script>', group: 'bundle', category: 'kernel', scope: 'third-party' },
        { id: 'brk', kind: 'broken', name: 'pkg-broken', version: '-', group: 'bundle', category: 'kernel', scope: 'official' },
      ],
      edges: [{ from: evil, to: 'a@1', kind: 'dep', unsatisfied: true }],
    },
  }
}

function membersDom(fixture) {
  const dom = loadMembersDom()
  dom.state.graph = fixture.graph
  dom.state.byId = byIdMap(fixture.graph)
  dom.state.groupIds = new Set(['bundle'])
  dom.state.groupZone = new Map([['bundle', 'kernel']])
  dom.state.view.collapsedCats = new Set(['kernel'])
  dom.state.view.filterCats = new Set(['kernel'])
  return dom
}

test('V2.3 member rows: header count, badges and flags — every string via textContent', () => {
  const fx = membersGraph()
  const dom = membersDom(fx)
  const box = new dom.El('div')
  dom.memberSection(box, { kind: 'group', id: 'bundle' })
  // title + 3 rows (the unsatisfied edge touches a@1 AND the evil node)
  assert.equal(box.children.length, 4, 'title + one row per member')
  assert.equal(box.children[0].className, 'sec', 'section header via secTitle')
  assert.equal(box.children[0].text, 'MEMBERS(3)', 'the header count is the TRUE total through t(memberPkgsLabel)')
  const rows = box.children.filter((c) => c.className === 'jump')
  const rowOf = (label) => rows.find((c) => c.children[0].text === label)
  assert.deepEqual(rows.map((c) => c.children[0].text), [fx.evil + '@<script>', 'alpha@1.0.0', 'pkg-broken'],
    'rows sort by NAME (the attacker name sorts first: \x27<\x27 < \x27a\x27) — no input-order leak')
  const row = rowOf('alpha@1.0.0')
  assert.ok(row, 'the plain package row is there')
  assert.equal(row.children[0].text, 'alpha@1.0.0', 'name@version, verbatim')
  assert.deepEqual(row.children.filter((c) => c.className === 'badge').map((c) => c.text), [],
    'a plain official package is badge-free (quiet rows)')
  assert.deepEqual(row.children.filter((c) => c.className === 'unsat').map((c) => c.text), [' ⚠ UNSAT'],
    'the touched-by-an-unsatisfied-edge flag rides the existing .unsat span')
  const evilRow = rowOf(fx.evil + '@<script>')
  assert.equal(evilRow.children[0].text, fx.evil + '@<script>', 'attacker name@version survive VERBATIM as text')
  assert.deepEqual(evilRow.children.filter((c) => c.className === 'badge').map((c) => c.text), ['third-party'],
    'a third-party scope gets its badge (the interesting case), kind=package does not')
  const brkRow = rowOf('pkg-broken')
  assert.equal(brkRow.children[0].text, 'pkg-broken', 'version \x27-\x27 (the pseudo-node marker) never renders as @-')
  assert.deepEqual(brkRow.children.filter((c) => c.className === 'badge').map((c) => c.text), ['broken'],
    'the node kind badges only when it is not a plain package')
  assert.deepEqual(brkRow.children.filter((c) => c.className === 'brk').map((c) => c.text), [' ⚠ BROKEN'],
    'the broken flag has its own marker class (styled with .unsat in style.css)')
  const texts = domTexts(box)
  assert.equal(texts.filter((s) => s.includes(fx.evil)).length, 1,
    'the attacker string reaches the tree exactly once, as TEXT — never composed as markup')
  assert.equal(JSON.stringify(box).includes('innerHTML'), false, 'no innerHTML anywhere in the built tree')
})

test('V2.3 member list cap: 200 rows render, the +N tail reports what the header already counted', () => {
  const nodes = []
  for (let i = 0; i < 205; i++) {
    nodes.push({ id: 'p' + i + '@1', kind: 'package', name: 'pkg-' + String(i).padStart(4, '0'), version: '1.0.0', group: 'big', category: 'kernel', scope: 'official' })
  }
  const dom = loadMembersDom()
  const graph = { groups: [], nodes, edges: [] }
  dom.state.graph = graph
  dom.state.byId = byIdMap(graph)
  const box = new dom.El('div')
  dom.memberSection(box, { kind: 'group', id: 'big' })
  assert.equal(box.children[0].text, 'MEMBERS(205)', 'the header never under-reports a truncated list')
  assert.equal(box.children.filter((c) => c.className === 'jump').length, dom.CAP, 'exactly CAP rows')
  const tail = box.children[box.children.length - 1]
  assert.equal(tail.className, 'kv', 'the tail is the shared +N 更多 kv row')
  assert.equal(tail.children[1].text, '+5 MORE', 'the tail counts what it hid (205-200)')
})

test('V2.3 member row click REVEALS the package: ancestors open and state.focus roots on the row', () => {
  const fx = membersGraph()
  const dom = membersDom(fx)
  const box = new dom.El('div')
  dom.memberSection(box, { kind: 'group', id: 'bundle' })
  const rowOf = (label) => box.children.find((c) => c.className === 'jump' && c.children[0].text === label)
  const alphaRow = rowOf('alpha@1.0.0')
  assert.equal(alphaRow.handlers.click instanceof Function, true, 'rows are clickable')
  alphaRow.handlers.click()
  assert.equal(dom.state.selected, 'a@1', 'the reveal selects the row package')
  assert.deepEqual(dom.state.focus, { rootId: 'a@1', depth: null },
    'THE contract: a member-row click roots the path on the row (unlimited depth default)')
  assert.deepEqual([...dom.state.view.collapsedCats], [], 'expandPath: its zone is un-collapsed…')
  assert.deepEqual([...dom.state.view.filterCats], [], '…and un-filtered')
  assert.deepEqual([...dom.state.view.collapsedGroups], [], '…and its group materialized + expanded')
  assert.equal(dom.state.viewport, undefined, 'R50: no snapshot field exists for a reveal to arm')
  assert.deepEqual(dom.state.pathStack, [], 'a reveal is an authoritative re-root, not a walk')
  assert.deepEqual(dom.LOG, ['paint:focus', 'details', 'sync', 'flash:a@1'],
    'paint (viewport kept) → details → focus ctl → the flash centers+zooms the revealed node')
  // clicking a NON-package member (broken pseudo-node) is still a reveal, but R35
  // declines it as a root: the path exits — camera-free (R50).
  dom.LOG.length = 0
  const brkRow = rowOf('pkg-broken')
  brkRow.handlers.click()
  assert.equal(dom.state.selected, 'brk', 'the broken node is selected (its details open)')
  assert.equal(dom.state.focus, null, 'a broken node is not a legal path root — the path exits')
  assert.deepEqual(dom.LOG, ['paint:nofocus', 'details', 'sync', 'flash:brk'], 'the same chain, without a focus')
})

test('V2.3/R51 member rows: the ZONE detail groups them by GROUP, and the shared builder still resolves a zone', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const zone = src.slice(src.indexOf('function detailsZone(box, cid) {'), src.indexOf('function detailsGroup(box, gid) {'))
  const grp = src.slice(src.indexOf('function detailsGroup(box, gid) {'), src.indexOf('function detailsEdge(box, id) {'))
  assert.ok(zone.length > 0 && grp.length > 0, 'both container detail builders are still there')
  // V2.7 R51 MIGRATION: the zone detail lists BY GROUP now — a clickable header
  // (selectNode('g:'+gid), NO nav: cold select, in-focus walk) + capped rows.
  assert.match(zone, /buildGroupMembers\(\{ kind: 'group', id: gid \}, state\.graph\)/, 'zone detail = per-group sections (R51)')
  assert.match(zone, /ZONE_GROUP_CAP/, 'each section caps at ZONE_GROUP_CAP member rows')
  assert.match(zone, /groupMoreLabel/, 'a cut section tails with 还有 N')
  assert.doesNotMatch(zone, /memberSection/, 'the flat zone member section is retired (group keeps its own)')
  assert.match(grp, /memberSection\(box, \{ kind: 'group', id: gid \}\)/, 'group detail = its own member packages')
  assert.doesNotMatch(zone, /jumpButton/, 'the old group-name jump list is gone (one member surface, not two)')
  assert.doesNotMatch(grp, /kvRow\(box, t\(\x27membersLabel\x27\)/,
    'no duplicate count row — the 成员包（N） header IS the member count (V2.3)')
  assert.doesNotMatch(zone, /t\(\x27pkgsLabel\x27\)/, '…and the zone count row retired with it (the key is gone from both locales)')
  // the click target is the GRAPH NODE, not the row: revealNode needs group/category
  const ms = src.slice(src.indexOf('function memberSection(box, sel) {'), src.indexOf('function detailsZone(box, cid) {'))
  assert.match(ms, /state\.byId\.get\(String\(r\.id\)\)/, 'the row id is resolved back to its graph node')
  assert.match(ms, /if \(n\) revealNode\(n\)/, '…and only a real node is revealed (a vanished rescan target no-ops)')
  // the PURE builder still resolves a zone kind — the capability the R51 grouped
  // sections build on (memberSection stays the shared group renderer verbatim)
  const fx = membersGraph()
  const dom = membersDom(fx)
  dom.state.graph.groups = [{ id: 'bundle', kind: 'official', category: 'kernel' }]
  const zbox = new dom.El('div')
  dom.memberSection(zbox, { kind: 'zone', id: 'kernel' })
  assert.equal(zbox.children[0].text, 'MEMBERS(3)', 'a zone lists its packages, not its group names')
  assert.equal(zbox.children.filter((c) => c.className === 'jump').length, 3, 'one row per package in the zone')
  const empty = new dom.El('div')
  dom.memberSection(empty, { kind: 'zone', id: 'nowhere' })
  assert.equal(empty.children.length, 1, 'an empty zone still shows its honest zero header')
  assert.equal(empty.children[0].text, 'MEMBERS(0)')
})

// ---------- dbl-tap semantics through the REAL registered handlers ----------
function loadGestureWiring() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var LOG = []\n',
    'var document = { getElementById: function () { return null } }\n',
    'function t(k) { return k }\n',
    'function hidePeek() { LOG.push(\x27peek-off\x27) }\n',
    'function showPeek() {}\n',
    'function selectNode(id) { LOG.push(\x27select:\x27 + id) }\n',
    'function paint() { LOG.push(\x27paint\x27) }\n',
    'var PEEK_DEBOUNCE_MS = 250\n',
    'var menuSwallow = false\n',
    'var state = {\n',
    '  graph: {}, cy: null, byId: new Map(), groupIds: new Set([\x27fs\x27, \x27bundle\x27]),\n',
    '  groupZone: new Map([[\'fs\', \'tools\']]), focus: null, selected: null, tableMode: false,\n',
    '  view: { collapsedCats: new Set(), collapsedGroups: null, filterCats: new Set(), granularity: \x27groups\x27, focus: null },\n',
    '}\n',
    'function El(id, classes, data) {\n',
    '  this.isElement = true; this.idStr = id; this.classes = new Set(classes); this.dataObj = data\n',
    '}\n',
    'El.prototype.id = function () { return this.idStr }\n',
    'El.prototype.data = function (k) { return this.dataObj[k] }\n',
    'El.prototype.hasClass = function (c) { return this.classes.has(c) }\n',
    'var handlers = []\n',
    'var cy = {\n',
    '  on: function (evt, sel, fn) { if (typeof sel === \x27function\x27) { fn = sel; sel = null } handlers.push({ evt: evt, sel: sel, fn: fn }) },\n',
    '  zoom: function () { return 1 }, pan: function () { return { x: 0, y: 0 } },\n',
    '  animate: function () {},\n',
    '  trigger: function (evt, target) {\n',
    '    handlers.forEach(function (h) {\n',
    '      if (h.evt !== evt) return\n',
    '      if (h.sel == null) { if (target === cy) h.fn({ target: target }) }\n',
    '      else if (target && target.isElement) h.fn({ target: target })\n',
    '    })\n',
    '  },\n',
    '}\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function menuIsOpen() {') + '\n',
    extractBalanced(src, 'function closeMenu() {') + '\n',
    extractBalanced(src, 'function swallowMenuTap() {') + '\n',
    extractBalanced(src, 'function onCtxTap(evt) {') + '\n',
    extractBalanced(src, 'function onCtxTapBackground(evt) {') + '\n',
    extractBalanced(src, 'function onCanvasGesture() {') + '\n',
    extractBalanced(src, 'function onCanvasMouseDown() {') + '\n',
    extractBalanced(src, 'function toggleGroup(gid) {') + '\n',
    extractBalanced(src, 'function bindCy() {') + '\n',
    'state.cy = cy\n',
    'return { state: state, cy: cy, LOG: LOG, bind: function () { bindCy() },\n',
    '  trigger: function (evt, target) { cy.trigger(evt, target) },\n',
    '  groupCard: function (gid) { return new El(\x27g:\x27 + gid, [\x27group\x27, \x27collapsed\x27], { id: \x27g:\x27 + gid, name: gid }) },\n',
    '  zone: function (cid) { return new El(\x27cat:\x27 + cid, [\x27zone\x27], { id: \x27cat:\x27 + cid, name: cid }) },\n',
    '  blank: function () { return cy } }',
  ].join('')
  return new Function(body)()
}

test('V2.3 group dbl-tap: 组级 restores the expand/collapse toggle; 包级 and a live path stay inert', () => {
  const g = loadGestureWiring()
  g.bind() // the real cy.on('dbltap', …) registrations, no hand-poked handlers
  g.trigger('dbltap', g.groupCard('fs'))
  assert.deepEqual([...g.state.view.collapsedGroups].sort(), ['bundle'],
    'first dbl-tap materializes the all-collapsed default and opens THIS group (V2.2 inertness undone)')
  assert.deepEqual(g.LOG, ['paint'], 'the toggle repaints through paint() — the only structure path (V2.5: viewport kept)')
  g.LOG.length = 0
  g.trigger('dbltap', g.groupCard('fs'))
  assert.deepEqual([...g.state.view.collapsedGroups].sort(), ['bundle', 'fs'], 'the same card again collapses it back')
  // 包级: the model expands every group BY DEFINITION at that tier, so a fake
  // collapse would be a lie the next repaint contradicts.
  g.LOG.length = 0
  g.state.view.granularity = 'packages'
  g.trigger('dbltap', g.groupCard('fs'))
  assert.deepEqual(g.LOG, [], '包级: group dbl-tap is the documented no-op')
  assert.deepEqual([...g.state.view.collapsedGroups].sort(), ['bundle', 'fs'], '…and it touched no state')
  // a live path is inert at either tier (unchanged V2.2 rule)
  g.LOG.length = 0
  g.state.view.granularity = 'groups'
  g.state.focus = { rootId: 'a@1', depth: null }
  g.trigger('dbltap', g.groupCard('fs'))
  assert.deepEqual(g.LOG, [], 'inside a path a dbl-tap never re-cuts the structure under the reader')
  // zone shells keep their own, tier-independent gate
  g.state.focus = null
  g.LOG.length = 0
  g.trigger('dbltap', g.zone('tools'))
  assert.deepEqual([...g.state.view.collapsedCats], ['tools'], 'zone dbl-tap still collapses the whole zone')
  g.state.focus = { rootId: 'a@1', depth: null }
  g.LOG.length = 0
  g.trigger('dbltap', g.zone('tools'))
  assert.deepEqual(g.LOG, [], '…and is inert inside a path')
  // a single tap still selects (the dbl-tap handlers must not swallow it)
  g.state.focus = null
  g.LOG.length = 0
  g.trigger('tap', g.groupCard('fs'))
  assert.deepEqual(g.LOG, ['peek-off', 'select:g:fs'], 'tap = close the peek, then select')
})

// =========================================================================
// Task V2.4b — GROUP FOCUS UI: one-hop neighborhood on the group-card tap.
// The wiring doctrine of V2.2b applies without exception: every chain runs
// through the REAL registered cytoscape handlers / real state transitions,
// asserted on terminal side effects (state.focus, collapsedGroups, class sets,
// fake-DOM texts). Nothing mid-chain is stubbed.
// =========================================================================

/** One zone + a broken zone, groups gA(root)/gB(both)/gC(down)/gD(up). V24b matrix. */
function gfFixture() {
  const n = (id, group) => ({
    id, kind: 'package', name: id, version: '1.0.0', scope: 'official', group,
    category: group === 'gC' ? 'broken' : 'kernel',
    path: '$DSH_HOME\\x', description: null, servicesRequired: [], externalDeps: [],
    mountedBy: [], flags: { unreadable: false },
  })
  return {
    schema: 1, generatedAt: 'x', dshHome: '$DSH_HOME', warnings: [],
    categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }, { id: 'broken', zh: '断链', en: 'Broken' }],
    profiles: [],
    groups: [
      { id: 'gA', kind: 'official', category: 'kernel', packageCount: 2 },
      { id: 'gB', kind: 'official', category: 'kernel', packageCount: 1 },
      { id: 'gC', kind: 'official', category: 'broken', packageCount: 1 },
      { id: 'gD', kind: 'official', category: 'kernel', packageCount: 1 },
    ],
    nodes: [n('r1', 'gA'), n('r2', 'gA'), n('x', 'gB'), n('y', 'gC'), n('z', 'gD')],
    edges: [
      { from: 'r1', to: 'x', kind: 'dep' },   // down bucket gA→gB (two kinds)
      { from: 'r1', to: 'x', kind: 'peer' },
      { from: 'x', to: 'r1', kind: 'dep' },   // also up ⇒ gB/x land in BOTH
      { from: 'r2', to: 'y', kind: 'dep' },   // down gC (broken zone)
      { from: 'z', to: 'r1', kind: 'mount' }, // up gD (mount climbs)
      { from: 'r1', to: 'r2', kind: 'dep' },  // internal: never a neighborhood
      { from: 'r2', to: 'r1', kind: 'mount' },// mount-OUT of the root: never down
    ],
  }
}

// ---------- the focus funnel: tap semantics under R44 (menu entry lives below) ----------
// V2.5 MIGRATION (R44): V2.4b's "single group-card tap enters group focus" is
// retired — the TAP door closes, the RIGHT-CLICK menu + #node=g: deep link are
// the entry doors now. The same assertions that proved the ENTRY bookkeeping
// (snapshot once, depth 1, flag derivation) were moved to the V2.5 menu-command
// wiring test below; the walk semantics INSIDE a live focus survive verbatim.

test('V2.5 R44 tap matrix: plain-view group tap selects WITHOUT focus; inside a focus the tap WALKS (depth 1, packages flag = 包级档||该组已展开)', () => {
  const flow = loadFocusFlow()
  const byId = new Map([['a@1', PKG('a')]])
  const card = 'g:bundle'
  // --- the retired door: a plain-view group-card tap selects and does NOT root ---
  flow.reset({ byId })
  let act = flow.act(card)
  assert.equal(flow.state.focus, null, 'R35 doctrine back in place: a group is no longer a TAP focus root')
  assert.deepEqual([act.entered, act.walked, act.exited], [false, false, false], 'no transition of any kind')
  assert.deepEqual(flow.CALLS, [], '…and not one snapshot/glide side effect')
  assert.equal(flow.state.selected, card, 'the card is still the selection (details panel rides it)')
  // unknown gid: no focusable root → still no-op, at any door
  flow.reset({ byId })
  act = flow.act('g:nope')
  assert.equal(flow.state.focus, null, 'an unknown gid anchors nothing (focusable rule respected)')
  assert.deepEqual([act.entered, act.walked], [false, false])
  // --- the surviving door: walking INSIDE a live focus re-roots the group focus ---
  flow.reset({ byId })
  flow.state.focus = { rootId: card, depth: 1, packages: false } // already inside a group focus
  flow.act('g:fs')
  assert.deepEqual(flow.state.focus, { rootId: 'g:fs', depth: 1, packages: false },
    'inside the focus view a neighbor-card tap walks the root (fixed 1 hop)')
  flow.state.focus = { rootId: card, depth: 1, packages: false }
  flow.state.pathStack = []
  flow.act(card)
  assert.deepEqual(flow.state.pathStack, [], 'the SAME root re-tap is inert (no self-push)')
  // --- the packages flag rides the VIEW state (V2.4b matrix, now on the walk path) ---
  flow.reset({ byId })
  flow.state.focus = { rootId: card, depth: 1, packages: false }
  flow.state.view.collapsedGroups = new Set(['fs']) // materialized; bundle NOT in it → expanded
  flow.act('g:bundle')
  assert.deepEqual(flow.state.focus, { rootId: card, depth: 1, packages: true },
    'a collapsedGroups that omits the group ⇒ expanded ⇒ member shape')
  flow.state.focus = { rootId: card, depth: 1, packages: true }
  flow.state.view.collapsedGroups = new Set(['bundle', 'fs']) // bundle explicitly collapsed
  flow.act('g:bundle')
  assert.deepEqual(flow.state.focus, { rootId: card, depth: 1, packages: false },
    'explicitly collapsed ⇒ card shape')
  flow.state.focus = { rootId: card, depth: 1, packages: false }
  flow.state.view.granularity = 'packages'
  flow.state.view.collapsedGroups = new Set(['bundle', 'fs'])
  flow.act('g:bundle')
  assert.equal(flow.state.focus.packages, true, '包级档 forces the member shape regardless of collapsedGroups')
  // --- walk group → package (path mode), then package → group, then an edge tap ---
  flow.reset({ byId })
  flow.state.focus = { rootId: card, depth: 1, packages: false }
  flow.state.pathStack = []
  flow.act('a@1')
  assert.deepEqual(flow.state.focus, { rootId: 'a@1', depth: null }, 'walking to a package leaves group mode for path mode')
  assert.deepEqual(flow.state.pathStack, [card], 'the group root rode the stack')
  flow.act(card)
  assert.deepEqual([flow.state.focus.rootId, flow.state.focus.depth], ['g:bundle', 1], 'walking back to a group card re-roots group focus')
  flow.state.focus = { rootId: 'e:a@1|b@1|dep', depth: null }
  act = flow.act('e:a@1|b@1|dep')
  assert.deepEqual([act.entered, act.walked, act.exited], [false, false, false], 'an edge tap keeps the focus')
  assert.equal(flow.state.focus.rootId, 'e:a@1|b@1|dep', '…and never re-roots on the edge id')
})

// ---------- wiring: the REAL tap + dbltap handlers run the group-focus chain ----------

// ---------- wiring: the REAL cxttap/tap/dbltap handlers run the FULL menu chain ----------
// V2.5's richest harness: the registered cytoscape handlers (bindCy extracted
// VERBATIM), the menu DOM (fake document), buildContextMenu/runMenuCommand/
// focusTransition/afterFocusChange/toggleGroup/resetView/exitFocusCommand all
// REAL. Leaf stubs only: paint, details/ctl/chip chrome, the peek card.

function loadMenuWiring() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const stackCap = /var PATH_STACK_CAP = [^\n;]+/.exec(src)
  assert.ok(stackCap, 'app.js must still declare `var PATH_STACK_CAP = …`')
  const body = [
    'var LOG = [], ANIMS = [], CREATES = 0\n',
    'function depthOfCtl() { return null }\n',
    'function t(k) { return k }\n',
    'function hidePeek() { LOG.push("peek-off") }\n',
    'function showPeek() {}\n',
    'function renderDetails(id) { LOG.push("details") }\n',
    'function syncFocusCtl() { LOG.push("sync") }\n',
    'function buildZoneChips() { LOG.push("chips") }\n',
    'function paint() { LOG.push("paint" + (state.focus ? ":focus" : ":nofocus")) }\n',
    'var PEEK_DEBOUNCE_MS = 250\n',
    'var menuSwallow = false\n',
    'var GRAPH = { children: [], clientWidth: 400, clientHeight: 300,\n'
    + '  appendChild: function (c) { this.children.push(c); return c } }\n',
    'function El(tag) {\n'
    + '  this.id = ""; this.tag = tag; this.children = []; this.className = ""; this.text = "";\n'
    + '  this.handlers = {}; this.hidden = false; this.disabled = false; this.style = {};\n'
    + '  this.offsetWidth = 160; this.offsetHeight = 120; this.clientWidth = 0; this.clientHeight = 0\n'
    + '  var self = this\n'
    + '  this.appendChild = function (c) { this.children.push(c); return c }\n'
    + '  this.addEventListener = function (k, fn) { self.handlers[k] = fn }\n'
    + '}\n',
    'Object.defineProperty(El.prototype, "textContent", {\n'
    + '  get: function () { return this.text },\n'
    + '  set: function (v) { this.text = String(v); this.children.length = 0 },\n'
    + '})\n',
    'var document = {\n'
    + '  createElement: function (tag) { CREATES++; return new El(tag) },\n'
    + '  createTextNode: function (s) { return { tag: "#text", text: String(s) } },\n'
    + '  getElementById: function (id) {\n'
    + '    if (id === "graph") return GRAPH\n'
    + '    for (var i = 0; i < GRAPH.children.length; i++) { if (GRAPH.children[i].id === id) return GRAPH.children[i] }\n'
    + '    return null\n'
    + '  },\n'
    + '}\n',
    'function escText(el, s) { el.textContent = s == null ? "" : String(s) }\n',
    'var state = { graph: { categories: [{ id: "kernel" }, { id: "tools" }, { id: "plugin" }] },\n'
    + '  byId: new Map([["a@1", { id: "a@1", kind: "package", name: "a" }], ["brk", { id: "brk", kind: "broken", name: "brk" }]]),\n'
    + '  groupIds: new Set(["bundle", "fs"]), groupZone: new Map([["fs", "tools"]]),\n'
    + '  cy: null, focus: null, selected: null, pathStack: [],\n'
    + '  tableMode: false, lang: "zh", theme: "light", fitted: false,\n'
    + '  view: { collapsedCats: new Set(), collapsedGroups: null, filterCats: new Set(), granularity: "groups", focus: null } }\n',
    'function coll(items) {\n'
    + '  return { length: items.length, items: items, filter: function (f) { return coll(items.filter(f)) } }\n'
    + '}\n',
    'var GRAPH_NODES = [{ id: "a@1", kind: "pkg" }, { id: "cat:kernel", kind: "zone" }]\n'
    + '.map(function (n) { return { isElement: true, id: function () { return n.id },\n'
    + '    data: function (k) { return k === "kind" ? n.kind : n.id } } })\n',
    'var vp = { zoom: 1.35, pan: { x: -40, y: 90 } }\n',
    'var handlers = []\n',
    'var cy = {\n',
    '  on: function (evt, sel, fn) { if (typeof sel === "function") { fn = sel; sel = null } handlers.push({ evt: evt, sel: sel, fn: fn }) },\n',
    '  pan: function () { return { x: vp.pan.x, y: vp.pan.y } },\n',
    '  zoom: function () { return vp.zoom },\n',
    '  nodes: function () { return coll(GRAPH_NODES) },\n'
    + '  animate: function (o) { ANIMS.push(o); LOG.push("animate") },\n',
    '  trigger: function (evt, target, x, y) {\n',
    '    handlers.forEach(function (h) {\n',
    '      if (h.evt !== evt) return\n',
    '      var e = { target: target, renderedPosition: { x: x == null ? 100 : x, y: y == null ? 60 : y } }\n',
    '      if (h.sel == null) { if (target === cy) h.fn(e) }\n',
    '      else if (target && target.isElement) h.fn(e)\n',
    '    })\n',
    '  },\n',
    '}\n',
    'function El2(idStr, classList, data) {\n'
    + '  this.isElement = true; this.isNode = function () { return true }\n'
    + '  this.idStr = idStr; this.classes = new Set(classList); this.dataObj = data\n'
    + '}\n',
    'El2.prototype.id = function () { return this.idStr }\n',
    'El2.prototype.data = function (k) { return this.dataObj[k] }\n',
    'El2.prototype.hasClass = function (c) { return this.classes.has(c) }\n',
    stackCap[0] + '\n',
    extractBalanced(src, 'var ZONE_IDS_FALLBACK = [') + '\n',
    extractBalanced(src, 'function catById(graph) {') + '\n',
    extractBalanced(src, 'function zoneTitle(catId) {') + '\n',
    extractBalanced(src, 'function shortName(name, kind) {') + '\n',
    extractBalanced(src, 'function allCatIds() {') + '\n',
    extractBalanced(src, 'function soloToggleFor(allCats, current, id) {') + '\n',
    extractBalanced(src, 'function hideAllCats(allCats) {') + '\n',
    extractBalanced(src, 'function pushPathStack(stack, id, cap) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function focusTransition(next) {') + '\n',
    extractBalanced(src, 'function focusFlowAction(id, nav) {') + '\n',
    extractBalanced(src, 'function exitFocus() {') + '\n',
    extractBalanced(src, 'function exitFocusCommand() {') + '\n',
    extractBalanced(src, 'function afterFocusChange(act, id) {') + '\n',
    extractBalanced(src, 'function selectNode(id, nav) {') + '\n',
    extractBalanced(src, 'function toggleGroup(gid) {') + '\n',
    extractBalanced(src, 'function resetView() {') + '\n',
    extractBalanced(src, 'function buildContextMenu(target, state, lang) {') + '\n',
    extractBalanced(src, 'function ctxMenu() {') + '\n',
    extractBalanced(src, 'function menuIsOpen() {') + '\n',
    extractBalanced(src, 'function closeMenu() {') + '\n',
    extractBalanced(src, 'function swallowMenuTap() {') + '\n',
    extractBalanced(src, 'function menuHeader(target) {') + '\n',
    extractBalanced(src, 'function positionMenu(m, px, py) {') + '\n',
    extractBalanced(src, 'function openMenuAt(target, evt) {') + '\n',
    extractBalanced(src, 'function ctxTargetOf(el) {') + '\n',
    extractBalanced(src, 'function runMenuCommand(cmd, target) {') + '\n',
    extractBalanced(src, 'function onCtxTap(evt) {') + '\n',
    extractBalanced(src, 'function onCtxTapBackground(evt) {') + '\n',
    extractBalanced(src, 'function onCanvasGesture() {') + '\n',
    extractBalanced(src, 'function onCanvasMouseDown() {') + '\n',
    extractBalanced(src, 'function bindCy() {') + '\n',
    'state.cy = cy\n',
    'return { state: state, cy: cy, LOG: LOG, ANIMS: ANIMS, GRAPH: GRAPH, CREATES: function () { return CREATES },\n'
    + '  bind: function () { bindCy() },\n'
    + '  tap: function (t, x, y) { cy.trigger("tap", t, x, y) },\n'
    + '  dbltap: function (t) { cy.trigger("dbltap", t) },\n'
    + '  cxt: function (t, x, y) { cy.trigger("cxttap", t, x, y) },\n'
    + '  mousedown: function () { cy.trigger("mousedown", cy) },\n'
    + '  panstart: function () { cy.trigger("panstart", cy) },\n'
    + '  zoomg: function () { cy.trigger("zoom", cy) },\n'
    + '  card: function (gid) { return new El2("g:" + gid, ["group", "collapsed"], { id: "g:" + gid, name: gid }) },\n'
    + '  zone: function (cid) { return new El2("cat:" + cid, ["zone"], { id: "cat:" + cid, name: cid }) },\n'
    + '  pkg: function (id) { return new El2(id, ["pkg"], { id: id, name: id }) },\n'
    + '  blank: function () { return cy },\n'
    + '  close: function () { closeMenu() },\n'
    + '  menu: function () {\n'
    + '    for (var i = 0; i < GRAPH.children.length; i++) { if (GRAPH.children[i].id === "ctx-menu") return GRAPH.children[i] }\n'
    + '    return null },\n'
    + '  rows: function () { var m = this.menu(); return m ? m.children.slice(1) : [] },\n'
    + '  pkgFocus: function () { state.focus = { rootId: "a@1", depth: null } } }',
  ].join('')
  return new Function(body)()
}

// V2.7 R50 MIGRATION (from V2.5 R44): the choreography is UNCHANGED — menu-open
// → focus-item click → re-tap inert → dbltap toggles the root card → walks keep
// working — but the camera assertions REVERSED: entry, walk and toggles now
// glide nothing (ANIMS stays empty across the whole battery).

test('V2.7 R50 menu entry + dbl-tap sequence through the REAL handlers: menu focuses once with ZERO camera, re-tap inert, dbltap ends expanded in member shape', () => {
  const w = loadMenuWiring()
  w.bind() // the real cy.on('tap'|'dbltap'|'cxttap', …) registrations
  // --- cxttap the card, click 聚焦邻域: ENTRY through the command surface ---
  w.cxt(w.card('bundle'))
  const m = w.menu()
  assert.ok(m && !m.hidden, 'cxttap on a group card opens the menu')
  assert.equal(m.children[0].text, 'bundle', 'the header is the target display name (textContent)')
  assert.deepEqual(w.rows().map((b) => b.text), ['menuExpand', 'menuFocusGroup', 'menuSoloZone'],
    'collapsed card at 组级: expand / focus (card shape) / solo')
  assert.deepEqual(w.rows().map((b) => b.disabled), [false, false, false], 'all three commands are live in the plain view')
  w.LOG.length = 0 // the cxttap leg owns its peek-off; the COMMAND chain starts here
  w.rows()[1].handlers.click()
  assert.deepEqual(w.state.focus, { rootId: 'g:bundle', depth: 1, packages: false },
    'the menu command roots the group focus (card shape while collapsed)')
  assert.equal(w.state.selected, 'g:bundle', 'the card is the selection too (details panel rides it)')
  assert.equal(w.state.viewport, undefined, 'R50: state.viewport is retired — the entry arms no snapshot')
  assert.deepEqual(w.state.pathStack, [], 'a fresh root starts with an empty stack')
  assert.deepEqual(w.LOG, ['details', 'sync', 'paint:focus'],
    'details → ctl → ONE viewport-kept repaint — the entry glides NOTHING (R50)')
  assert.ok(w.menu().hidden, 'dispatching closes the menu')
  w.LOG.length = 0
  // --- a TAP on the same root (focus view active): walk-inert, zero side effects ---
  w.tap(w.card('bundle'))
  assert.deepEqual(w.state.focus, { rootId: 'g:bundle', depth: 1, packages: false })
  assert.deepEqual(w.state.pathStack, [], 'SAME-ROOT TAP PUSHES NOTHING (the brief pin)')
  assert.deepEqual(w.LOG, ['peek-off', 'details', 'sync', 'paint:focus'], 'repaints — and zero camera ops')
  w.LOG.length = 0
  // --- dbltap (the root card keeps the V2.4b toggle semantics): expand, focus STAYS ---
  w.dbltap(w.card('bundle'))
  assert.deepEqual([...w.state.view.collapsedGroups].sort(), ['fs'],
    'the materialized all-collapsed default opens ONLY the toggled group')
  assert.deepEqual(w.state.focus, { rootId: 'g:bundle', depth: 1, packages: true },
    'the focus survives and flips to the member shape (the group is now expanded)')
  assert.deepEqual(w.state.pathStack, [], 'the dbl-tap never touched the stack')
  assert.deepEqual(w.LOG, ['paint:focus'], 'the toggle repaints through paint() — the only structure path, viewport kept')
  // --- the menu now offers the MERGE label + the member-shape focus label ---
  w.LOG.length = 0
  w.cxt(w.card('bundle'))
  assert.deepEqual(w.rows().map((b) => b.text), ['menuMerge', 'menuFocusGroupPkgs', 'menuSoloZone'],
    'expanded card: merge / focus (packages shape) / solo')
  assert.deepEqual(w.rows().map((b) => b.disabled), [false, false, false],
    'the focus ROOT card stays toggleable inside its own group focus')
  w.rows()[0].handlers.click()
  assert.deepEqual([...w.state.view.collapsedGroups].sort(), ['bundle', 'fs'], 'the merge command collapses it back')
  assert.deepEqual(w.state.focus, { rootId: 'g:bundle', depth: 1, packages: false }, 'member shape inverts, focus stays')
  // --- a walk to the neighbor (a TAP still walks INSIDE the focus view) ---
  w.LOG.length = 0
  w.tap(w.card('fs'))
  assert.equal(w.state.focus.rootId, 'g:fs', 'walking to a neighbor card re-roots the group focus')
  assert.deepEqual(w.state.pathStack, ['g:bundle'], 'the previous group root entered the stack')
  w.dbltap(w.card('fs'))
  assert.equal(w.state.focus.packages, true, 'the focus root card toggles in every group focus')
  // a NON-root card stays the documented inert (no surprise layout re-cut under the reader)
  w.LOG.length = 0
  w.dbltap(w.card('bundle'))
  assert.deepEqual(w.LOG, [], 'dbltap on a non-root card inside a group focus is inert')
  // --- a live PACKAGE focus keeps the V2.2b full inertness, and disables the row ---
  w.pkgFocus()
  w.LOG.length = 0
  w.dbltap(w.card('bundle'))
  assert.deepEqual(w.LOG, [], 'inside a package path a dbl-tap never re-cuts the structure')
  w.cxt(w.card('bundle'))
  assert.equal(w.rows()[0].disabled, true, '…and the menu 展开/合并 row is greyed for a non-root target under focus (a real click cannot reach it)')
  assert.equal(w.menu().hidden, false, 'opening a fresh menu kept it open for the inspection')
  w.close()
  assert.equal(w.menu().hidden, true, 'closeMenu disarms the surface')
  assert.equal(w.ANIMS.length, 0, 'R50: across the whole battery — entry, re-taps, toggles, walks — cy.animate ran ZERO times')
})

// ---------- fake-cy: applyClasses on the group focus (the disjoint-both contract) ----------

test('V24b applyClasses (fake cy, groups mode): both-side card carries f-both and NEVER dim; aggs light by side', () => {
  const Model = loadModel()
  const graph = gfFixture()
  const view = { focus: { rootId: 'g:gA', depth: 1 } }
  const run = classesApplied(Model, graph, view, { rootId: 'g:gA', depth: 1 }, 'g:gA',
    { edgeKinds: null, granularity: 'groups' })
  const cls = (id) => run.fake.classesOf(id)
  // the controller ruling: groupFocusSets is DISJOINT — applyClasses must light the third side explicitly
  assert.ok(cls('g:gB').includes('f-both'), 'a both-side neighbor CARD (marked only via sets.both) carries f-both')
  assert.ok(!cls('g:gB').includes('dim'), '…and NOT dim (the V2.4a hand-over concern, groups mode)')
  assert.ok(cls('g:gC').includes('f-down') && !cls('g:gC').includes('f-up'), 'down-side card is amber only')
  assert.ok(cls('g:gD').includes('f-up') && !cls('g:gD').includes('f-down'), 'up-side card is teal only')
  const root = cls('g:gA')
  assert.ok(root.includes('in-focus') && root.includes('selected'), 'the root card keeps the gold rings')
  for (const f of ['f-down', 'f-up', 'f-both']) assert.ok(!root.includes(f), `the root card carries no ${f}`)
  assert.ok(!root.includes('dim'), 'the root card never dims')
  // aggregate edges light by DIRECTION OF THE BUCKET, not by the dominant kind:
  // the down bucket here is dep+peer (dep dominant) and the up side of gB is a dep too
  assert.ok(cls('agg:g:gA|g:gB').includes('f-e-down'), 'down-side agg (agg:root|neighbor)')
  assert.ok(!cls('agg:g:gA|g:gB').includes('f-e-up'), '…and only that side')
  assert.ok(cls('agg:g:gB|g:gA').includes('f-e-up'), 'up-side agg (agg:neighbor|root)')
  assert.ok(cls('agg:g:gA|g:gC').includes('f-e-down'))
  assert.ok(cls('agg:g:gD|g:gA').includes('f-e-up'))
  for (const e of ['agg:g:gA|g:gB', 'agg:g:gB|g:gA', 'agg:g:gA|g:gC', 'agg:g:gD|g:gA']) {
    assert.ok(cls(e).includes('in-focus') && !cls(e).includes('dim'), `${e}: rendered, kept, never dim`)
  }
  // the focus render set IS the neighborhood: nothing on screen dims
  for (const el of run.elements) {
    assert.ok(cls(el.data.id).includes('in-focus'), `${el.data.id}: in-focus`)
    assert.ok(!cls(el.data.id).includes('dim'), `${el.data.id}: nothing dims inside the groups-mode focus`)
  }
})

test('V24b applyClasses (fake cy, packages mode): both-side MEMBER carries f-both and never dim; root members stay neutral', () => {
  const Model = loadModel()
  const graph = gfFixture()
  const view = { focus: { rootId: 'g:gA', depth: 1, packages: true }, granularity: 'packages' }
  const run = classesApplied(Model, graph, view, { rootId: 'g:gA', depth: 1, packages: true }, 'g:gA',
    { edgeKinds: null, granularity: 'packages' })
  const cls = (id) => run.fake.classesOf(id)
  assert.ok(cls('x').includes('f-both') && !cls('x').includes('dim'),
    'the pkgsBoth member is marked ONLY via sets.pkgsBoth — the explicit third side must light it (packages mode)')
  assert.ok(cls('y').includes('f-down') && !cls('y').includes('dim'))
  assert.ok(cls('z').includes('f-up') && !cls('z').includes('dim'))
  for (const rid of ['r1', 'r2', 'g:gA']) {
    const c = cls(rid)
    assert.ok(c.includes('in-focus'), `${rid}: root-side element is in-focus`)
    for (const f of ['f-down', 'f-up', 'f-both']) assert.ok(!c.includes(f), `${rid}: root-side element carries no ${f}`)
    assert.ok(!c.includes('dim'), `${rid}: a ROOT MEMBER must never dim (packages mode)`)
  }
  assert.ok(cls('e:r1|x|dep').includes('f-e-down'), 'root-incident real edges ride downEdges/upEdges keys verbatim')
  assert.ok(cls('e:x|r1|dep').includes('f-e-up'))
  assert.ok(cls('e:z|r1|mount').includes('f-e-up'), 'the mount climb lights on the up side')
  for (const el of run.elements) assert.ok(!cls(el.data.id).includes('dim'), `${el.data.id}: nothing dims (render set = neighborhood)`)
})

// ---------- pure: buildRelatedGroups ----------

test('V24b buildRelatedGroups: dir/sort/count/kinds/brokenZone + junk defense, both tiers', () => {
  const Model = loadModel()
  const { buildRelatedGroups } = loadAppPure()
  const g = gfFixture()
  const sets = Model.groupFocusSets(g, 'gA')
  const meta = new Map([['gA', 'kernel'], ['gB', 'kernel'], ['gC', 'broken'], ['gD', 'kernel']])
  const rows = buildRelatedGroups(sets, g, meta, 'groups')
  assert.deepEqual(JSON.parse(JSON.stringify(rows)), [
    { gid: 'gC', name: 'gC', count: 1, kinds: ['dep'], dir: 'down', brokenZone: true },
    { gid: 'gD', name: 'gD', count: 1, kinds: ['mount'], dir: 'up', brokenZone: false },
    { gid: 'gB', name: 'gB', count: 3, kinds: ['dep', 'peer'], dir: 'both', brokenZone: false },
  ], 'dir(down,up,both)→name→gid; count = the A-side aggregate counts summed over the bucketed root-incident '
    + 'edge keys (gB: 2 down + 1 up); kinds are the deduped reaching kinds in EDGE_KINDS_ALL order; brokenZone = the neighbor zone')
  const prows = buildRelatedGroups(sets, g, meta, 'packages')
  assert.deepEqual(JSON.parse(JSON.stringify(prows.map((r) => [r.gid, r.dir, r.count]))),
    [['y', 'down', 1], ['z', 'up', 1], ['x', 'both', 3]],
    'the packages tier keys rows by package id (row click = path mode there)')
  assert.deepEqual(prows.map((r) => r.name), ['y', 'z', 'x'], 'package rows show the node name (fallback id)')
  assert.equal(prows[2].brokenZone, false, 'the both-side package sits in a kernel group — no broken flag')
  // junk battery: never throws, never invents rows
  assert.deepEqual(buildRelatedGroups(null, null, null, 'groups'), [], 'junk sets')
  assert.deepEqual(buildRelatedGroups({}, g, meta, 'groups'), [], 'an empty container (unknown gid degeneration)')
  const junk = { rootGid: 'gA', downEdges: new Set(['junk', 'e:x', 'e:zz@9|nothere@1|dep', 'e:x|y|dep']), upEdges: new Set() }
  assert.deepEqual(buildRelatedGroups(junk, g, meta, 'groups'),
    [{ gid: 'gC', name: 'gC', count: 1, kinds: ['dep'], dir: 'down', brokenZone: true }],
    'malformed keys drop; a key whose neighbor node is unknown drops; the down side keys on the TARGET node\'s group')
  // zero mutation on a frozen graph
  const frozen = deepFreeze(gfFixture())
  const fsets = Model.groupFocusSets(g, 'gA')
  const fr = buildRelatedGroups(fsets, frozen, meta, 'groups')
  assert.equal(fr.length, 3, 'a deep-frozen graph reads fine')
})

// ---------- DOM: the related sections of the details panel ----------

test('V24b related sections: header (N), sorted rows with badges + brokenZone, click walks (groups) / re-roots (packages)', () => {
  const dom = loadDetailsDom()
  const g = gfFixture()
  dom.state.graph = g
  dom.state.byId = byIdMap(g)
  dom.state.groupZone = zoneTable(g)
  dom.state.focus = { rootId: 'g:gA', depth: 1 }
  const box = new dom.El('div')
  dom.relatedSection(box, 'g:gA')
  assert.equal(box.children[0].text, 'RELGRP(3)', 'bilingual 相关组（N） header through t(relatedGroupsLabel)')
  const rows = box.children.filter((c) => c.className === 'jump')
  assert.equal(rows.length, 3)
  assert.deepEqual(rows.map((c) => c.children[0].text), ['\u2193 gC \u00d71', '\u2191 gD \u00d71', '\u2195 gB \u00d73'],
    'dir arrow + name + ×count (A-side count), down→up→both order')
  assert.deepEqual(rows[2].children.filter((c) => c.className === 'badge').map((c) => c.text), ['dep', 'peer'], 'kind badges')
  assert.deepEqual(rows[0].children.filter((c) => c.className === 'brk').map((c) => c.text), [' \u26a0 BROKEN'],
    'the broken-zone neighbor flags with the shared .brk treatment')
  assert.equal(rows[2].children.filter((c) => c.className === 'brk').length, 0)
  rows[0].handlers.click()
  rows[2].handlers.click()
  assert.deepEqual(dom.SELECTED, ['g:gC', 'g:gB'], 'a group row click = selectNode(g:gid) = the walk through focusFlowAction')
  // packages tier: 相关包（N）, rows re-root path mode
  dom.state.focus = { rootId: 'g:gA', depth: 1, packages: true }
  dom.SELECTED.length = 0
  const pbox = new dom.El('div')
  dom.relatedSection(pbox, 'g:gA')
  assert.equal(pbox.children[0].text, 'RELPKG(3)', 'bilingual 相关包（N） at the member tier')
  const prows = pbox.children.filter((c) => c.className === 'jump')
  prows[2].handlers.click()
  assert.deepEqual(dom.SELECTED, ['x'], 'a package row click = path mode there (selectNode(pkg id))')
})

test('V24b XSS: an attacker-controlled package NAME reaches the related rows as TEXT only', () => {
  const dom = loadDetailsDom()
  const g = gfFixture()
  const evil = '<img src=x onerror=alert(1)>'
  g.nodes.find((n) => n.id === 'x').name = evil
  dom.state.graph = g
  dom.state.byId = byIdMap(g)
  dom.state.groupZone = zoneTable(g)
  dom.state.focus = { rootId: 'g:gA', depth: 1, packages: true }
  const box = new dom.El('div')
  dom.relatedSection(box, 'g:gA')
  const texts = domTexts(box)
  assert.equal(texts.filter((s) => s.includes(evil)).length, 1,
    'the attacker string lands exactly once, through textContent (the fake setter WIPES children — markup composition would show)')
  assert.equal(JSON.stringify(box).includes('innerHTML'), false, 'no innerHTML anywhere in the built tree')
})

// ---------- pure: the assembled view (packages tier forces showRealCross) ----------

test('V24b assembleView: the packages tier forces showRealCross at view-assembly without touching the user view', () => {
  const { assembleView } = loadAppPure()
  const userView = { granularity: 'packages', showRealCross: false, focus: { rootId: 'g:gA', depth: 1, packages: true } }
  const built = assembleView(userView)
  assert.notEqual(built, userView, 'a forced build returns a COPY')
  assert.equal(built.showRealCross, true, '包级档 always assembles with real cross edges ON (R43 made the zero-edge LOD a UX regression; brief ruling)')
  assert.equal(userView.showRealCross, false, 'the user checkbox intent survives — the forcing is display-level, assembled per build')
})

test('V24b assembleView (continued): groups tier passes the view through untouched', () => {
  const { assembleView } = loadAppPure()
  const gv = { granularity: 'groups', showRealCross: false }
  assert.equal(assembleView(gv), gv, 'the 组级 tier is passed through by reference — zero behavior change')
  const on = { granularity: 'packages', showRealCross: true }
  assert.equal(assembleView(on), on, 'already-on forces nothing (no copy churn)')
  assert.deepEqual(assembleView(null), {}, 'junk arrives as an empty object at the model (which carries its own defense)')
})

// ---------- fake DOM: the depth select during a group focus ----------

test('V24b syncFocusCtl: the depth select disables with the 1-hop title hint during a group focus, re-enables on exit/walk', () => {
  const dom2 = loadFocusCtlDom()
  dom2.state.focus = { rootId: 'g:bundle', depth: 1 }
  dom2.sync()
  assert.equal(dom2.SEL.disabled, true, '组聚焦期间深度下拉 disabled')
  assert.equal(dom2.SEL.title, 'groupFocusDepth', 'the title hint explains why (fake t returns the key)')
  assert.equal(dom2.SEL.value, '1', 'the fixed 1 hop round-trips into the select')
  dom2.state.focus = { rootId: 'a@1', depth: null }
  dom2.sync()
  assert.equal(dom2.SEL.disabled, false, 'walked to a package root → re-enabled')
  assert.equal(dom2.SEL.title, '', 'and the hint is gone')
  dom2.state.focus = null
  dom2.sync()
  assert.equal(dom2.SEL.disabled, false, 'exit → re-enabled too')
})

test('V24b breadcrumb: group roots render their names through the existing id→label resolution', () => {
  const dom2 = loadFocusCtlDom()
  dom2.state.focus = { rootId: 'g:llm', depth: 1 }
  dom2.state.pathStack = ['g:bundle', 'a@1']
  dom2.state.byId = new Map([['a@1', { id: 'a@1', kind: 'package', name: '@deepseek-ai/a' }]])
  dom2.sync()
  assert.equal(dom2.BACK.textContent, '\u2190 BACK (bundle \u2192 a \u2192 llm)',
    'idToLabel already maps g: ids to the group name — the breadcrumb needs no new plumbing')
})

// ---------- wiring: focusNode as the authoritative group re-root ----------

function loadGroupRevealWiring() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var LOG = []\n',
    'function depthOfCtl() { return null }\n',
    'function t(k) { return k }\n',
    'function paint() { LOG.push("paint" + (state.focus ? ":focus" : ":nofocus")) }\n',
    'function renderDetails(id) { LOG.push("details:" + id) }\n',
    'function syncFocusCtl() { LOG.push("sync") }\n',
    'function flashReveal(id) { LOG.push("flash:" + id) }\n',
    'var state = {\n',
    '  graph: null, byId: new Map(), groupIds: new Set(["bundle"]), groupZone: new Map([["bundle", "kernel"]]),\n',
    '  cy: { pan: function () { return { x: 3, y: 4 } }, zoom: function () { return 1.1 },\n'
    + '    nodes: function () { return [{ data: function () { return "pkg" } }] },\n'
    + '    animate: function () { LOG.push("animate") } }, tableMode: false,\n',
    '  focus: null, selected: null, pathStack: [],\n',
    '  view: { collapsedCats: new Set(["kernel"]), collapsedGroups: null, filterCats: new Set(["kernel"]) },\n',
    '}\n',
    extractBalanced(src, 'function normalizeDepth(depth) {') + '\n',
    extractBalanced(src, 'function gidOf(n) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function expandPath(n) {') + '\n',
    extractBalanced(src, 'function focusNode(rootId, depth, selectId) {') + '\n',
    'return { state: state, LOG: LOG, focus: focusNode, reset: function (g) {\n'
    + '  state.graph = g; state.byId = new Map(g.nodes.map(function (n) { return [n.id, n] }));\n'
    + '  state.focus = null; state.selected = null; state.pathStack = [];\n'
    + '  state.view.collapsedCats = new Set(["kernel"]); state.view.collapsedGroups = null; state.view.filterCats = new Set(["kernel"]);\n'
    + '  LOG.length = 0 } }',
  ].join('')
  return new Function('AtlasModel', body)(loadModel())
}

// V2.7 R50 MIGRATION (from V2.5 R45): re-roots are ZERO-camera now — the
// moved-glide and the entry snapshot retired with the whole fit family.

test('V2.7 R50 focusNode: a g: re-root installs the group focus (packages flag derived) with ZERO camera ops', () => {
  const h = loadGroupRevealWiring()
  h.focus('g:bundle', null, 'g:bundle')
  assert.deepEqual(h.state.focus, { rootId: 'g:bundle', depth: 1, packages: false },
    'the deep-link/breadcrumb re-root keeps the group semantics (never a stale depth-only shape)')
  assert.deepEqual(h.state.pathStack, [], 'an authoritative re-root never touches the stack')
  assert.deepEqual(h.LOG, ['paint:focus', 'sync', 'details:g:bundle'],
    'ONE viewport-kept repaint → chrome → details — no glide, no flash (R50: re-roots are camera-free; the flash is revealNode\'s alone)')
  assert.equal(h.state.selected, 'g:bundle')
  assert.equal(h.state.viewport, undefined, 'R50: no snapshot field survives on state')
  // the package root keeps the old shape and the expandPath side effect verbatim
  const pkgGraph = { nodes: [{ id: 'a@1', kind: 'package', name: 'a', group: 'bundle', category: 'kernel' }], edges: [] }
  h.reset(pkgGraph)
  h.focus('a@1', 2, 'a@1')
  assert.deepEqual(h.state.focus, { rootId: 'a@1', depth: 2 })
  assert.deepEqual([...h.state.view.collapsedCats], [], 'expandPath still opens the zone for a package root')
  assert.deepEqual(h.LOG, ['paint:focus', 'sync', 'details:a@1'],
    'a package entry repaints and stops there — the moved-glide died with R50')
  // depth-slider re-cut: SAME root, no selection — nothing changes but the cut
  h.state.focus = { rootId: 'a@1', depth: 2 }
  h.LOG.length = 0
  h.focus('a@1', 1, null)
  assert.deepEqual(h.state.focus, { rootId: 'a@1', depth: 1 }, 'the depth re-cut lands')
  assert.deepEqual(h.LOG, ['paint:focus', 'sync'], 'no animate, no details, no flash — the lens stays where the user left it')
})

test('V24b deep-link #node=g:... is wired through the isFocusRoot gate and focuses the group', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const i = src.indexOf('/node=(.+)$/.exec(hash)')
  assert.ok(i >= 0, 'the #node= deep-link branch still exists')
  const block = src.slice(i, src.indexOf('paint()', i))
  assert.match(block, /isGroupRootId\(m\[1\]\)/, 'a g: anchor is branched before the byId lookup')
  assert.match(block, /isFocusRoot\(m\[1\]\)/, 'the group anchor passes the SAME gate a card tap uses')
  assert.match(block, /focusNode\(m\[1\], null, m\[1\]\)/, 'it re-roots authoritatively at the fixed depth, selecting the card')
  assert.match(block, /focusNode\(n\.id, null, n\.id\)/, 'the package branch survives verbatim (R35 gate intact)')
})

// ---------- grep guards: the paint assembly, the recalculation hooks, legend + README ----------

test('V24b wiring guards: assembled view in paint, group-focus fit guard, focus recalculation, details hook', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  assert.match(src, /window\.AtlasModel\.buildView\(state\.graph, assembleView\(state\.view\)\)/,
    'paint feeds the model ONLY the assembled view (the one structural path stays single)')
  // V2.5 (R44/R45): the group focus recalculates through groupFocusShape (the
  // tap-era focusForId needle migrated with the door), and the in-paint
  // groups-mode refit is GONE — paint fits nothing but the boot frame.
  assert.doesNotMatch(src, /if \(focusApplied && pathFitEles\(state\.cy\)\.length\)/,
    'the V2.4b in-paint refit fallback retired with the auto-refit')
  assert.match(src, /state\.focus = groupFocusShape\('g:' \+ gid\)/,
    'toggleGroup recalculates a group focus rooted on THIS card (the packages flag follows the expansion)')
  assert.match(src, /if \(state\.focus && isGroupRootId\(state\.focus\.rootId\)\) state\.focus = groupFocusShape\(state\.focus\.rootId\)/,
    'a tier switch re-derives a live group focus (packages flag vs granularity, never a stale shape)')
  const grp = src.slice(src.indexOf('function detailsGroup(box, gid) {'), src.indexOf('function detailsEdge(box, id) {'))
  assert.match(grp, /if \(state\.focus && String\(state\.focus\.rootId\) === 'g:' \+ gid\) relatedSection\(box, 'g:' \+ gid\)/,
    'the 相关组/相关包 section rides the ROOT group card only (the walk target shows ITS own neighborhood)')
  const rel = src.slice(src.indexOf('function relatedSection(box, rootCardId) {'))
  assert.match(rel, /t\('relatedPkgsLabel'\)/, 'the packages-tier header is a literal t() key (i18n parity scan reaches it)')
  assert.match(rel, /t\('relatedGroupsLabel'\)/, 'the groups-tier header is a literal t() key')
  assert.match(rel, /selectNode\(pkgs \? r\.gid : 'g:' \+ r\.gid\)/, 'rows walk (group) or re-root path mode (package) through selectNode')
  assert.match(src, /state\.groupIds && state\.groupIds\.has\(s\.slice\(2\)\)/,
    'isFocusRoot admits g: ids only for KNOWN groups (the applyGraph rescan guard keeps working)')
  // the depth select wiring
  assert.match(src, /sel\.disabled = !!gf/, 'syncFocusCtl writes the disabled state')
  assert.match(src, /gf \? t\('groupFocusDepth'\) : ''/, 'the hint title rides the same branch (bilingual)')
  // legend + README carry the group-focus story
  const I18N = new Function(extractBalanced(src, 'var I18N = {') + '\nreturn I18N')()
  assert.match(I18N.zh.egAgg, /组聚焦/, 'zh legend: the aggregate swatch says when it appears')
  assert.match(I18N.en.egAgg, /group focus/i, 'en legend: same story')
  const readme = readFileSync(join(WEB, '..', 'README.md'), 'utf8')
  assert.match(readme, /组聚焦/, 'README covers group focus (feature chapter)')
  assert.match(readme, /相关组/, 'README covers the related lists')
  assert.match(readme, /聚合边.{0,60}组聚焦|组聚焦.{0,60}聚合边/, 'README: aggregate edges live inside group focus (R43 story)')
})

// =========================================================================
// Task V2.5 — the right-click COMMAND SURFACE, lightweight taps, explicit view
// reset, and the retirement of the auto-refit (R44/R45). Doctrine unchanged
// from V2.2b: every chain runs through the REAL registered handlers and the
// REAL state machine; only leaf chrome (paint, details, chips) is stubbed.
// =========================================================================

// ---------- pure: buildContextMenu rows (5 targets × focus × expansion × lang) ----------

test('V2.5 buildContextMenu: row sets, shape-aware labels and enabled gates for every target state', () => {
  const { buildContextMenu } = loadAppPure()
  const mkState = (o) => Object.assign({
    view: { granularity: 'groups', collapsedGroups: null, collapsedCats: new Set(), filterCats: new Set() },
    focus: null, byId: new Map([['p@1', { id: 'p@1', kind: 'package' }], ['brk', { id: 'brk', kind: 'broken' }]]),
  }, o || {})
  const rows = (t, s) => buildContextMenu(t, s || mkState(), 'zh')
  const ids = (r) => r.map((x) => x.id)
  const keys = (r) => r.map((x) => x.labelKey)
  const en = (r) => r.map((x) => x.enabled)
  // group card, COLLAPSED (collapsedGroups null = all collapsed by default), plain view
  let r = rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' })
  assert.deepEqual(ids(r), ['toggle-group', 'focus-group', 'solo-zone'], '展开 / 聚焦邻域 / 只看该区')
  assert.deepEqual(keys(r), ['menuExpand', 'menuFocusGroup', 'menuSoloZone'])
  assert.deepEqual(en(r), [true, true, true])
  // group card, EXPANDED (materialized set without the gid) → merge + member-shape focus label
  r = rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' },
    mkState({ view: { granularity: 'groups', collapsedGroups: new Set(['fs']), collapsedCats: new Set(), filterCats: new Set() } }))
  assert.deepEqual(keys(r), ['menuMerge', 'menuFocusGroupPkgs', 'menuSoloZone'], '合并 / 聚焦邻域（包形态） / 只看该区')
  assert.deepEqual(en(r), [true, true, true])
  // 包级档: groups render expanded BY DEFINITION and the toggle is the documented inert
  r = rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' },
    mkState({ view: { granularity: 'packages', collapsedGroups: null, collapsedCats: new Set(), filterCats: new Set() } }))
  assert.deepEqual(keys(r), ['menuMerge', 'menuFocusGroupPkgs', 'menuSoloZone'])
  assert.deepEqual(en(r), [false, true, true], '包级档的「合并」inert — the enabled predicate pins what the dbl-tap gate enforces')
  // under a live PACKAGE focus a non-root group card cannot toggle (dbl-tap gate mirrored)
  r = rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' }, mkState({ focus: { rootId: 'p@1', depth: null } }))
  assert.deepEqual(en(r), [false, true, true])
  // under its OWN group focus the root card keeps the toggle (V2.4b rule survives the door change)
  r = rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' }, mkState({ focus: { rootId: 'g:bundle', depth: 1 } }))
  assert.equal(en(r)[0], true, 'focus ROOT card: 展开/合并 stays live')
  r = rows({ kind: 'group', id: 'g:fs', gid: 'fs' }, mkState({ focus: { rootId: 'g:bundle', depth: 1 } }))
  assert.equal(en(r)[0], false, 'another group under focus: inert')
  // zone shell: 折叠⇄展开 + 只看 + 隐藏; the label rides collapsedCats
  r = rows({ kind: 'zone', id: 'kernel' })
  assert.deepEqual(ids(r), ['toggle-zone', 'solo-zone', 'hide-zone'])
  assert.deepEqual(keys(r), ['menuCollapseZone', 'menuSoloZone', 'menuHideZone'])
  assert.deepEqual(en(r), [true, true, true])
  r = rows({ kind: 'zone', id: 'kernel' },
    mkState({ view: { granularity: 'groups', collapsedGroups: null, collapsedCats: new Set(['kernel']), filterCats: new Set() } }))
  assert.equal(keys(r)[0], 'menuExpandZone', 'a collapsed shell offers 展开区')
  r = rows({ kind: 'zone', id: 'kernel' }, mkState({ focus: { rootId: 'p@1', depth: null } }))
  assert.deepEqual(en(r), [false, true, true], 'zone collapse stays inert under a live focus; filters stay live')
  // package: the SINGLE path-mode command, enabled only for legal roots (R35)
  r = rows({ kind: 'pkg', id: 'p@1' })
  assert.deepEqual(ids(r), ['pkg-path'])
  assert.equal(r[0].labelKey, 'menuPkgPath')
  assert.equal(r[0].enabled, true)
  assert.equal(rows({ kind: 'pkg', id: 'brk' })[0].enabled, false, 'a broken node is not a path root → greyed, not hidden')
  assert.equal(rows({ kind: 'pkg', id: 'ghost@1' })[0].enabled, false, 'an unknown id greyed too')
  // blank canvas: 复位视图 always live, 退出聚焦 rides the focus
  r = rows({ kind: 'bg' })
  assert.deepEqual(ids(r), ['reset-view', 'exit-focus'])
  assert.deepEqual(keys(r), ['menuResetView', 'menuExitFocus'])
  assert.deepEqual(en(r), [true, false], 'no focus → 退出聚焦 greyed (one rule: disabled, never hidden)')
  assert.deepEqual(en(rows({ kind: 'bg' }, mkState({ focus: { rootId: 'p@1', depth: null } }))), [true, true])
  // lang does NOT change the rows (labels resolve via t(labelKey) at render time)
  assert.deepEqual(buildContextMenu({ kind: 'bg' }, mkState(), 'en'), buildContextMenu({ kind: 'bg' }, mkState(), 'zh'))
  // junk targets emit nothing; a group target with only the full id normalizes the gid
  assert.deepEqual(rows({ kind: 'edge', id: 'e:x|y|dep' }), [], 'an unknown kind opens no menu')
  assert.deepEqual(rows(null), [])
  assert.deepEqual(keys(rows({ kind: 'group', id: 'g:bundle' }))
    , ['menuExpand', 'menuFocusGroup', 'menuSoloZone'], 'gid derived from the full id when absent')
  // purity: the view state survives untouched
  const s = mkState({ view: { granularity: 'groups', collapsedGroups: new Set(['fs']), collapsedCats: new Set(), filterCats: new Set(['tools']) } })
  rows({ kind: 'group', id: 'g:bundle', gid: 'bundle' }, s)
  assert.deepEqual([...s.view.collapsedGroups], ['fs'], 'buildContextMenu reads, never writes')
  assert.deepEqual([...s.view.filterCats], ['tools'])
})

// ---------- wiring: the full cxttap → menu → command → terminal-effect chains ----------

test('V2.5 menu wiring: solo/hide/折叠区/展开合并 commands mutate the REAL state and repaint once', () => {
  const w = loadMenuWiring()
  w.bind()
  // 只看该区 from a ZONE target = the chip-dblclick solo predicate
  w.cxt(w.zone('kernel'))
  assert.deepEqual(w.LOG, ['peek-off'], 'cxttap closes the peek card first (one hover surface at a time)')
  assert.deepEqual(w.rows().map((b) => b.text), ['menuCollapseZone', 'menuSoloZone', 'menuHideZone'])
  w.LOG.length = 0
  w.rows()[1].handlers.click()
  assert.deepEqual([...w.state.view.filterCats].sort(), ['plugin', 'tools'], 'solo kernel = every other zone hidden (one predicate, two doors)')
  assert.deepEqual(w.LOG, ['chips', 'paint:nofocus'], 'chips re-derive, ONE viewport-kept repaint')
  assert.ok(w.menu().hidden, 'dispatching closes the menu')
  // 隐藏该区 = the chip single-click exclusion
  w.LOG.length = 0
  w.cxt(w.zone('kernel'))
  w.rows()[2].handlers.click()
  assert.deepEqual([...w.state.view.filterCats].sort(), ['kernel', 'plugin', 'tools'], 'hide-zone ADDS the exclusion (solo stays put)')
  // 折叠区⇄展开区 through collapsedCats
  w.LOG.length = 0
  w.cxt(w.zone('kernel'))
  assert.equal(w.rows()[0].text, 'menuCollapseZone')
  w.rows()[0].handlers.click()
  assert.deepEqual([...w.state.view.collapsedCats], ['kernel'], 'the zone collapse command rides the same set the dbl-tap writes')
  assert.deepEqual(w.LOG.slice(-1), ['paint:nofocus'], 'one repaint, viewport kept')
  // and from a GROUP card, 只看该区 resolves the zone through groupZone
  w.LOG.length = 0
  w.state.view.filterCats = new Set()
  w.cxt(w.card('fs'))
  w.rows()[2].handlers.click()
  assert.deepEqual([...w.state.view.filterCats].sort(), ['kernel', 'plugin'],
    'fs lives in tools (groupZone) → solo TOOLS excluded the rest — the resolution is model-side, not the caller guessing')
  // 展开/合并 from the plain view (focus null): the real toggleGroup chain
  w.LOG.length = 0
  w.cxt(w.card('bundle'))
  w.rows()[0].handlers.click()
  assert.deepEqual([...w.state.view.collapsedGroups].sort(), ['fs'], 'the materialized default opens ONLY the commanded group')
  assert.equal(w.state.focus, null, 'R44: a menu toggle carries NO focus side effect')
  assert.deepEqual(w.LOG.slice(-1), ['paint:nofocus'], 'toggle = one viewport-kept repaint')
})

test('V2.7 R50 menu wiring: 依赖图 rides the real zero-camera selectNode chain; 复位视图 glides padding-40 with ZERO state change; 退出聚焦 exits through the shared funnel', () => {
  const w = loadMenuWiring()
  w.bind()
  // package target: the same code path the V2.7 dbl-tap door takes
  w.cxt(w.pkg('a@1'))
  assert.deepEqual(w.rows().map((b) => b.text), ['menuPkgPath'])
  assert.equal(w.rows()[0].disabled, false)
  w.LOG.length = 0
  w.rows()[0].handlers.click()
  assert.deepEqual(w.state.focus, { rootId: 'a@1', depth: null }, 'the command roots the path through focusForId')
  assert.equal(w.state.viewport, undefined, 'R50: nothing snapshots the viewport on entry any more')
  assert.deepEqual(w.LOG, ['details', 'sync', 'paint:focus'], 'chrome → repaint — the entry glides NOTHING (V2.7 R50)')
  // 复位视图 from the blank canvas: camera ONLY — the ONE surviving user glide
  w.LOG.length = 0
  const anims0 = w.ANIMS.length // R50: zero so far — the entry animated nothing
  const before = { focus: w.state.focus, stack: w.state.pathStack.slice(), cats: [...w.state.view.filterCats] }
  assert.equal(anims0, 0, 'entry ran no camera op before ⌂ was even touched')
  w.cxt(w.blank())
  assert.deepEqual(w.rows().map((b) => b.text), ['menuResetView', 'menuExitFocus'])
  assert.equal(w.rows()[1].disabled, false, 'focus is live → 退出聚焦 offered')
  w.LOG.length = 0
  w.rows()[0].handlers.click()
  assert.equal(w.ANIMS.length, anims0 + 1, 'exactly one camera move — the sanctioned reset')
  assert.equal(w.ANIMS[anims0].fit.padding, 40, 'the sanctioned padding — the ⌂ resetView constant')
  assert.equal(w.ANIMS[anims0].fit.eles.length, 2, 'fit rides the CURRENT render set (cy.nodes())')
  assert.equal(w.ANIMS[anims0].duration, 250)
  assert.deepEqual(w.LOG, ['animate'], 'no paint, no chrome — zero structure work')
  assert.equal(w.state.focus, before.focus, 'focus untouched')
  assert.deepEqual(w.state.pathStack, before.stack, 'stack untouched')
  // 退出聚焦 through the SAME funnel as Esc/focus-clear
  w.cxt(w.blank())
  w.LOG.length = 0 // the cxttap leg owns its peek-off; the COMMAND chain starts here
  w.rows()[1].handlers.click()
  assert.equal(w.state.focus, null, 'focus exited')
  assert.deepEqual(w.LOG, ['details', 'sync', 'paint:nofocus'], 'exit → ONE viewport-kept repaint — the snapshot glide is retired (R50)')
  assert.equal(w.ANIMS.length, anims0 + 1, '⌂ stays the ONLY glide in the battery: entry and exit added nothing')
})

test('V2.5 menu lifecycle: open at the click point, edge flip/clamp, tap-SWALLOW, mousedown-then-tap swallow, pan/zoom dismiss, single reusable div, one XSS-safe header', () => {
  const w = loadMenuWiring()
  w.bind()
  // position from the rendered click point + the edge flips (container 400×300, menu 160×120)
  w.cxt(w.card('bundle'), 100, 60)
  assert.equal(w.menu().style.left, '100px')
  assert.equal(w.menu().style.top, '60px')
  w.cxt(w.card('bundle'), 350, 250)
  assert.deepEqual([w.menu().style.left, w.menu().style.top], ['190px', '130px'], 'bottom-right click FLIPS the menu up-left')
  w.cxt(w.card('bundle'), 395, 295)
  assert.deepEqual([w.menu().style.left, w.menu().style.top], ['235px', '175px'], 'corner flips stay inside the pane')
  w.cxt(w.card('bundle'), 0, 0)
  assert.deepEqual([w.menu().style.left, w.menu().style.top], ['2px', '2px'], 'the top-left clamp keeps a grab margin')
  // reuse: ONE menu div in #graph, rebuilt rows only
  assert.equal(w.GRAPH.children.length, 1, 'the reusable div is appended once (peek-card pattern)')
  // an edge (not a node) gets NO menu (no command exists for it)
  const edge = w.pkg('e:a@1|u@1|dep')
  edge.isNode = function () { return false }
  edge.classes = new Set(['edge'])
  w.close()
  w.cxt(edge)
  assert.equal(w.menu().hidden, true, 'cxttap on an edge opens nothing')
  // the SWALLOW: while the menu is open, the next tap closes it WITHOUT touching selection
  w.cxt(w.card('bundle'))
  w.LOG.length = 0
  w.tap(w.pkg('a@1'))
  assert.equal(w.menu().hidden, true, 'the tap closed the menu')
  assert.deepEqual(w.LOG, [], 'the tap was SWALLOWED — no peek-off, no selection, no focus change')
  assert.equal(w.state.selected, null, 'selection untouched by the swallowed tap')
  w.tap(w.pkg('a@1'))
  assert.deepEqual(w.LOG.slice(0, 2), ['peek-off', 'details'], 'the NEXT tap behaves normally')
  w.pkgFocus() // reset to a known plain-ish state for the mousedown leg
  w.state.focus = null
  // mousedown closes AND arms the swallow for the tap that completes the press
  w.cxt(w.card('bundle'))
  w.close()
  w.cxt(w.zone('kernel'))
  w.mousedown()
  assert.equal(w.menu().hidden, true, 'mousedown dismisses')
  w.LOG.length = 0
  w.tap(w.zone('plugin'))
  assert.deepEqual(w.LOG, [], '…and the completing tap is still swallowed (menu semantics, not selection semantics)')
  // re-opening disarms a stale swallow (press → reopen → first click still swallows via menu-open, second works)
  w.cxt(w.zone('kernel'))
  w.tap(w.zone('plugin')) // menu-open swallow
  w.LOG.length = 0
  w.tap(w.zone('plugin'))
  assert.ok(w.LOG.length > 0, 'no stale swallow survives the cycle')
  // camera gestures strand the menu → close
  w.cxt(w.zone('kernel'))
  w.panstart()
  assert.equal(w.menu().hidden, true, 'panstart closes')
  w.LOG.length = 0
  w.tap(w.zone('plugin'))
  assert.ok(w.LOG.length > 0, 'panstart also cleared the armed swallow (a drag never eats the next click)')
  w.cxt(w.zone('kernel'))
  w.zoomg()
  assert.equal(w.menu().hidden, true, 'zoom closes (the peek card had the same rule)')
  // XSS: a group named like an attack stays TEXT (header is the ONLY data sink in the menu)
  const evil = '<img src=x onerror=alert(1)>'
  w.close()
  w.cxt(w.card(evil))
  assert.equal(w.menu().children[0].text, evil, 'the header rides textContent verbatim')
  assert.equal(w.menu().children[0].innerHTML, undefined, 'no innerHTML materialized on the header element')
  assert.equal(w.menu().children[0].children.length, 0, 'no child nodes were parsed from the name')
})

// ---------- static audit: the R45 camera doctrine, per call site ----------

// V2.7 R50 MIGRATION: this replaces the V2.5 R45 camera audit — the "four
// sanctioned moves" shrank to THREE (boot fit / ⌂ reset / the named reveal flash)
// once the entry/walk/re-root glides and the exit restore retired. The audit now
// proves the RETIREMENT globally (executable lines; comments exempt) and pins the
// surviving camera surface to exactly ONE fit + TWO cy.animate call sites.
test('V2.7 R50 camera audit: the snapshot chain is deleted; ONE fit + TWO cy.animate sites (flash, ⌂); every transition zero-camera', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const code = stripJsComments(src)
  assert.doesNotMatch(code, /snapshotViewport|restoreViewport|animateFitPath|pathFitEles/,
    'the V2.2b viewport-snapshot + path-fit chain is deleted from every executable line')
  assert.doesNotMatch(code, /state\.viewport|viewport:\s*null/,
    'state.viewport is retired — no field, no writer, no reader')
  const paintBody = extractBalanced(src, 'function paint() {')
  assert.ok(paintBody.includes('if (!state.fitted)'), 'paint keeps the one-shot boot-fit gate')
  assert.ok(paintBody.includes('state.cy.fit(undefined, 24)'), 'the boot fit is the ONE fit call')
  assert.ok(paintBody.includes('closeMenu()'), 'paint closes an open menu before destroying elements (V2.5 pin survives)')
  assert.ok(!paintBody.includes('animate'), 'paint never animates — the camera lives outside the render path')
  assert.equal((src.match(/state\.cy\.fit\(/g) || []).length, 1, 'exactly ONE fit() call in the whole app (the boot gate)')
  assert.equal((src.match(/state\.cy\.animate\(/g) || []).length, 2,
    'exactly TWO cy.animate call sites: the named reveal flash + the explicit ⌂ reset')
  const after = extractBalanced(src, 'function afterFocusChange(act, id) {')
  assert.ok(!/animate|fit\(|restore|snapshot/i.test(stripJsComments(after)), 'afterFocusChange (entry/walk/exit tail) moves NO camera (R50)')
  assert.ok(after.includes('paint()'), 'its tail is the viewport-kept repaint')
  const fn = extractBalanced(src, 'function focusNode(rootId, depth, selectId) {')
  assert.ok(!/animate|fit\(|flashReveal|snapshot/i.test(stripJsComments(fn)), 're-roots (deep link / breadcrumb / 聚焦 button) fire ZERO camera ops — no glide, no flash')
  assert.ok(fn.includes('paint()'), 'focusNode repaints — that is the whole move')
  const ef = extractBalanced(src, 'function exitFocusCommand() {')
  assert.ok(!/animate|restore|snapshot/i.test(stripJsComments(ef)), 'the exit funnel animates nothing')
  assert.ok(ef.indexOf('exitFocus()') < ef.indexOf('paint()'), 'exitFocus → repaint, and nothing trails the repaint')
  // the surviving exceptions, exactly where the brief pins them:
  const reveal = extractBalanced(src, 'function revealNode(n) {')
  assert.ok(reveal.includes('flashReveal(n.id)'), 'reveal centers+zooms through the flash (named navigation)')
  assert.ok(!/animate|fit\(|snapshot|restore/i.test(stripJsComments(reveal)), 'reveal itself touches no other camera')
  const flash = extractBalanced(src, 'function flashReveal(id) {')
  assert.ok(flash.includes('state.cy.animate({ center'), 'the flash is the ONE named center+zoom animate site')
  const rv = extractBalanced(src, 'function resetView() {')
  assert.match(rv, /fit:\s*\{[^}]*padding:\s*40/, '⌂ keeps fit padding 40')
  assert.match(rv, /duration:\s*250/, '250ms, the surviving glide family')
  assert.doesNotMatch(rv, /state\.(view|focus|selected|pathStack|fitted)\s*=[^=]/, 'resetView writes no state (the R45 pin survives the audit rewrite)')
  assert.doesNotMatch(rv, /paint\(/, 'resetView never repaints (zero structure work)')
  assert.match(src, /cy\.on\('mousedown', onCanvasMouseDown\)/, 'mousedown closes the menu (and arms the swallow)')
  assert.match(src, /cy\.on\('panstart', onCanvasGesture\)/, 'panstart closes without eating the NEXT click')
  assert.match(src, /cy\.on\('zoom', closeMenu\)/, 'zoom closes (named — the anonymous-zoom guard stays honest)')
})

test('V2.5 chrome ships: the ⌂ reset-view button (i18n-title), the clickable #ctx-menu CSS, and every menu labelKey resolves in BOTH locales', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  assert.match(html, /<button id="reset-view"[^>]*data-i18n-title="menuResetView"[^>]*>⌂<\/button>/,
    'the ⌂ button rides the header with the shared menu label as title')
  assert.match(src, /getElementById\('reset-view'\)/, 'the binder wires the button')
  assert.match(src, /resetBtn\.addEventListener\('click', resetView\)/, 'click → the one resetView funnel')
  assert.match(src, /window\.addEventListener\('resize', closeMenu\)/, 'a pane resize cannot strand the menu')
  assert.match(css, /#ctx-menu \{[^}]*position: absolute/, 'the menu anchors inside #graph (position:relative)')
  assert.match(css, /#ctx-menu\[hidden\] \{ display: none/, 'the [hidden] rule pins the UA default (peek-card doctrine)')
  assert.match(css, /#ctx-menu \{[^}]*z-index: [4-9]\d*/, 'it floats above the canvas and the peek card')
  assert.doesNotMatch(css, /#ctx-menu[^{]*\{[^}]*pointer-events:\s*none/, 'CLICKABLE — the peek card\'s rule must not leak here')
  assert.match(css, /\.cm-title/, 'the header row is styled')
  // label keys ↔ locales: buildContextMenu ships labelKeys; the parity scan never SEES them (no t() literal)
  const menuSrc = extractBalanced(src, 'function buildContextMenu(target, state, lang) {')
  const I18N = new Function(extractBalanced(src, 'var I18N = {') + '\nreturn I18N')()
  const labelKeys = [...new Set([...menuSrc.matchAll(/labelKey: '[A-Za-z]+',?/g)].map((m) => m[0].replace(/labelKey: '|',?$/g, '')))]
  assert.ok(labelKeys.length >= 10, `the matrix emits ${labelKeys.length} distinct label keys`)
  for (const k of labelKeys) {
    assert.ok(I18N.zh[k] && I18N.en[k], `menu labelKey ${k} resolves in BOTH locales`)
  }
  assert.ok(I18N.zh.menuCanvas && I18N.en.menuCanvas, 'the blank-canvas header has a locale name too')
  assert.match(readFileSync(join(WEB, '..', 'README.md'), 'utf8'), /右键/, 'README covers the right-click command surface')
})

// =========================================================================
// Task V2.6 — R46 nav-surface audit + R47 toolbar segmentation guards.
// The terminal wiring of every nav door has its own call-site in the audit
// below; the semantic battery runs for real in test/ctx-menu-wiring.test.mjs
// (registered handlers over the REAL vendored cytoscape + bubbling fake DOM).
// =========================================================================

test('V2.6 R46 nav audit: the tap is the ONE nav-free selection door; menu/rows/jumps/table/reveal pass true; group doors never do', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const tapBody = extractBalanced(src, "cy.on('tap', 'node, edge', function (evt) {")
  assert.match(tapBody, /hidePeek\(\); selectNode\(evt\.target\.id\(\)\)/,
    'the canvas tap calls selectNode WITHOUT the nav flag — R46: a cold tap stays lightweight')
  assert.doesNotMatch(tapBody, /,\s*true\)/, '…and no nav argument can sneak into the tap door')
  assert.match(src, /hidePeek\(\); selectNode\(null\)/, 'the blank tap deselects plainly (no nav)')
  // the five explicit doors (brief-verified call sites)
  assert.match(src, /if \(cmd === 'pkg-path'\) \{ selectNode\(String\(target\.id\), true\); return \}/,
    'menu 依赖图 = explicit nav (the R46 door, V2.7 renamed)')
  // V2.7 R49: the package dbl-tap entered as a SECOND pkg door, same funnel
  assert.match(src, /cy\.on\('dbltap', 'node\.pkg', function \(evt\) \{[\s\S]{0,400}?if \(!evt\.target\.hasClass\('pkg'\)\) return[\s\S]*?selectNode\(evt\.target\.id\(\), true\)/,
    'R49: dbl-tapping a package enters the dependency graph through selectNode(id, true) — the SAME nav funnel')
  assert.match(src, /jumpButton\(box, t\('depsLabel'\) \+ ' ' \+ idToLabel\(src\), function \(\) \{ selectNode\(String\(src\), true\) \}\)/,
    '依赖 jump button = explicit nav')
  assert.match(src, /jumpButton\(box, idToLabel\(tgt\) \+ ' ' \+ t\('dependentsLabel'\), function \(\) \{ selectNode\(String\(tgt\), true\) \}\)/,
    '被依赖 jump button = explicit nav')
  assert.equal((src.match(/selectNode\(r\.id, true\)/g) || []).length, 2,
    'both path-list row kinds (tier rows + mount-out rows) pass nav')
  assert.match(src, /tr\.addEventListener\('click', function \(\) \{ selectNode\(n\.id, true\) \}\)/,
    'the table row passes nav (cold row click roots the path)')
  assert.match(src, /state\.focus = focusForId\(n\.id, true\)/,
    'revealNode (search reveal / member rows / non-package deep link) stays focus-following — R35 survives R46')
  // the group doors stay exactly R44: nav must NOT appear
  assert.doesNotMatch(src, /selectNode\('cat:' \+ z?id, true\)/, 'zone breadcrumbs never pass nav')
  assert.doesNotMatch(src, /selectNode\('g:' \+ gid, true\)/, 'the group breadcrumb never passes nav')
  assert.match(src, /relatedRow\(box, r, function \(\) \{ selectNode\(pkgs \? r\.gid : 'g:' \+ r\.gid\) \}\)/,
    'related-group rows stay nav-free (cold = select, in-focus = walk, R44 verbatim)')
  // the cold gate itself: the package branch mirrors the group branch
  assert.match(src, /if \(!state\.focus && !nav\) return null/,
    'focusForId package branch: no focus and no nav ⇒ null (the R46 gate)')
  // README interaction prose moved with the door (left-click semantics + entry list)
  const readme = readFileSync(join(WEB, '..', 'README.md'), 'utf8')
  assert.match(readme, /冷态下单击（左键）任何节点 = 纯选中/, 'README: cold left-click is plain selection for BOTH kinds')
  assert.match(readme, /依赖图/, 'README keeps the V2.7 renamed vocabulary (依赖图)')
})

// ---------- V2.6 R47: the segmented toolbar (display layer only) ----------

/** balanced <div> content of every .tb-seg wrapper, in document order */
function segBlocks(region) {
  const out = []
  const open = /<div class="tb-seg[^"]*">/g
  let m
  while ((m = open.exec(region))) {
    const tags = /<div\b[^>]*>|<\/div>/g
    tags.lastIndex = open.lastIndex
    let depth = 1, t
    while (depth > 0 && (t = tags.exec(region))) depth += t[0] === '</div>' ? -1 : 1
    assert.ok(depth === 0, 'segment wrappers are balanced')
    out.push(region.slice(open.lastIndex, t.index))
  }
  return out
}

test('V2.6 R47 toolbar segmentation: four .tb-seg segments, the brief membership per segment, every JS hook still inside the header', () => {
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const header = /<header>[\s\S]*?<\/header>/.exec(html)
  assert.ok(header, 'the header block exists')
  const segs = segBlocks(header[0])
  assert.equal(segs.length, 4, 'exactly four .tb-seg segments')
  // ① ⌂ 复位 + 粒度两段
  assert.ok(segs[0].includes('id="reset-view"') && segs[0].includes('id="lod-ctl"'), 'segment ①: ⌂ reset + the granularity segment')
  assert.ok(!segs[0].includes('id="search"'), 'segment ① owns only its two controls')
  // ② 聚焦控件 + 面包屑（聚焦时出现，无聚焦不占位 — focus-ctl ships hidden,
  //    and the V22b guard above pins #path-back INSIDE #focus-ctl）
  assert.ok(segs[1].includes('id="focus-ctl"'), 'segment ②: the focus control (+ its breadcrumb)')
  assert.match(segs[1], /id="focus-ctl"\s+hidden/, 'segment ② ships collapsed (no placeholder unfocused)')
  // ③ chips + 全显示/全隐藏 (the row-tail buttons are BUILT inside #zone-chips)
  assert.ok(segs[2].includes('id="zone-chips"'), 'segment ③: the zone chips (+ built-in show-all/hide-all)')
  // ④ 搜索 + 语言 + 主题跟随 + 重扫 (theme is prefers-color-scheme — no chrome hook,
  //    so segment ④ carries the three real controls the header has)
  assert.ok(segs[3].includes('id="search"') && segs[3].includes('id="lang-btn"') && segs[3].includes('id="refresh"'),
    'segment ④: search + language + rescan')
  // document order ① ② ③ ④ through the header
  const marks = ['reset-view', 'focus-ctl', 'zone-chips', 'search'].map((id) => header[0].indexOf(`id="${id}"`))
  assert.ok(marks.every((i) => i >= 0), 'every anchored control is in the header')
  assert.deepEqual(marks, [...marks].sort((a, b) => a - b), 'segments ship left→right: ① reset ② focus ③ chips ④ search')
  // ZERO hook loss: every id/class the JS binds must ship exactly once in the header
  for (const idOfIt of ['reset-view', 'lod-ctl', 'focus-ctl', 'path-back', 'focus-depth', 'focus-clear', 'zone-chips',
    'search', 'lang-btn', 'refresh', 'scope-filter', 'profile-filter', 'edge-kinds', 'show-real-cross', 'meta']) {
    assert.equal((header[0].match(new RegExp(`id="${idOfIt}"`, 'g')) || []).length, 1, `#${idOfIt} ships exactly once`)
  }
  assert.equal((header[0].match(/data-seg="/g) || []).length, 2, 'the two granularity buttons survived the wrap')
  // the CSS half: segmented flex, 1px separators + breathing gaps, wrapping pane
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  assert.match(header[0], /class="tb-seg tb-div"/, 'the separator variant ships on the inner segments')
  assert.match(css, /\.tb-seg \{[^}]*display:\s*inline-flex[^}]*align-items:\s*center[^}]*gap:\s*\d+px/, 'segments are centered inline-flex boxes with internal gaps')
  assert.match(css, /\.tb-seg\.tb-div \{[^}]*border-left:\s*1px solid/, '1px separator between segments')
  assert.match(css, /\.tb-seg\.tb-div \{[^}]*padding-left:\s*(1[0-9]|[6-9])px/, '…plus a breathing gap around it')
  assert.match(css, /header \{[^}]*flex-wrap:\s*wrap/, 'the header wraps → the chips segment moves to the next line whole on narrow panes')
  assert.match(css, /\.tb-seg \{[^}]*flex-wrap:\s*wrap/, 'and a segment lets its own controls wrap inside it')
})

// =========================================================================
// Task V2.6-fix — the three guard layers the review round asked for:
//   I2  the #focus-depth control must not survive a focus exit as residue
//   M1  the nav audit pinned by CALL SHAPE, not by call-site spelling
//   M2  the search popover anchored to its input
// (I1 renderTable lives in test/table-fallback.test.mjs — it needs a real DOM.)
// =========================================================================

// ---------- V2.6-fix I2: the depth control's residue ----------
//
// syncFocusCtl only ever wrote `sel.value` WHILE a focus was live. A GROUP focus
// is pinned at depth 1, so entering one wrote '1'; exiting hid the control and
// left the '1' sitting in it. The control is display:none while cold, so that
// value is unreachable to the user — but depthOfCtl() reads the DOM, not the
// screen, and the next cold nav entry (menu 路径模式, a row, the table) built
// `{ rootId, depth: 1 }` straight out of it: a path truncated by a number nobody
// set. The reset belongs on the cold branch.

function loadDepthCtlDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var CTL = { hidden: true }, SEL = { value: \x270\x27, disabled: false, title: \x27\x27 }, BACK = { hidden: true, textContent: \x27\x27 }\n',
    'var document = { getElementById: function (id) {\n',
    '  return id === \x27focus-ctl\x27 ? CTL : id === \x27focus-depth\x27 ? SEL : id === \x27path-back\x27 ? BACK : null\n',
    '} }\n',
    'function t(k) { return k }\n',
    'function escText(el, s) { el.textContent = s == null ? \x27\x27 : String(s) }\n',
    'var state = { focus: null, pathStack: [], byId: new Map([[\x27a@1\x27, { id: \x27a@1\x27, kind: \x27package\x27, name: \x27a\x27 }]]),\n'
    + '  groupIds: new Set([\x27bundle\x27]), view: { granularity: \x27groups\x27, collapsedGroups: null } }\n',
    extractBalanced(src, 'function shortName(name, kind) {') + '\n',
    extractBalanced(src, 'function isGroupRootId(id) {') + '\n',
    extractBalanced(src, 'function isFocusRoot(id) {') + '\n',
    extractBalanced(src, 'function pathChainText(labels, sep) {') + '\n',
    extractBalanced(src, 'function idToLabel(id) {') + '\n',
    extractBalanced(src, 'function groupFocusShape(rootId) {') + '\n',
    extractBalanced(src, 'function depthOfCtl() {') + '\n',
    extractBalanced(src, 'function syncFocusCtl() {') + '\n',
    extractBalanced(src, 'function focusForId(id, nav) {') + '\n',
    'return { state: state, CTL: CTL, SEL: SEL, sync: syncFocusCtl, depth: depthOfCtl, forId: focusForId, shape: groupFocusShape }',
  ].join('')
  return new Function(body)()
}

test('V2.6-fix I2 depth residue: exiting a focus resets the hidden select to the UNLIMITED default', () => {
  const d = loadDepthCtlDom()
  // cold: the shipped default is 不限 and depthOfCtl reads it as unlimited
  assert.equal(d.SEL.value, '0', 'the select ships at 0 = UNLIMITED')
  assert.equal(d.depth(), null, 'cold → unlimited')
  // 1. GROUP focus entry (the menu command is the only door; it builds the shape)
  d.state.focus = d.shape('g:bundle')
  assert.deepEqual({ rootId: d.state.focus.rootId, depth: d.state.focus.depth }, { rootId: 'g:bundle', depth: 1 },
    'a GROUP focus is fixed at 1 hop')
  d.sync()
  assert.equal(d.CTL.hidden, false, 'the control is visible while the focus is live')
  assert.equal(d.SEL.value, '1', '…and mirrors the group focus (disabled at 1)')
  assert.equal(d.SEL.disabled, true, 'the group focus pins the select disabled')
  // 2. EXIT — the control hides, and the '1' left inside it is invisible residue
  d.state.focus = null
  d.sync()
  assert.equal(d.CTL.hidden, true, 'cold again: the whole control is hidden')
  assert.equal(d.SEL.value, '0', 'the hidden control is RESET to the unlimited default — a stale value is pure residue')
  assert.equal(d.depth(), null, 'and the cold depth reading is UNLIMITED again')
  // 3. the next cold EXPLICIT-NAV entry (menu 路径模式 / a row / a table row) must
  //    therefore root an UNLIMITED path, not a 1-hop stub
  const f = d.forId('a@1', true)
  assert.deepEqual(f, { rootId: 'a@1', depth: null },
    'the next cold nav entry reads depth UNLIMITED, not the dead group focus\x27s 1')
})

test('V2.6-fix I2 depth residue: a package focus at 1-3 resets too, and a LIVE focus is never clobbered', () => {
  const d = loadDepthCtlDom()
  for (const dep of [1, 2, 3]) {
    d.SEL.value = '0'
    d.state.focus = { rootId: 'a@1', depth: dep }
    d.sync()
    assert.equal(d.SEL.value, String(dep), 'a live focus still mirrors its own depth into the control')
    assert.equal(d.depth(), dep, '…and reads back as that depth')
    d.state.focus = null
    d.sync()
    assert.equal(d.SEL.value, '0', `after exiting a depth-${dep} path the control is back at the default`)
    assert.deepEqual(d.forId('a@1', true), { rootId: 'a@1', depth: null }, 'the next cold entry is unlimited again')
  }
  // the cold branch is idempotent: no focus, already at the default, nothing to do
  d.state.focus = null
  d.sync()
  d.sync()
  assert.equal(d.SEL.value, '0', 'repeated cold syncs stay at the default')
})

// ---------- V2.6-fix M1: the nav audit, pinned by call SHAPE ----------
//
// The R46 audit pinned each door by its verbatim call text. That proves the seven
// known sites and nothing else: re-spell one (`selectNode(id,\n  true)`, a
// different argument expression, a new site) and the leak sails through while
// every guard stays green. What actually matters is a COUNT and a FORBIDDEN
// PATTERN, so this layer parses the call shape out of the source instead:
// comment-stripped (the doc comments literally quote `selectNode(id, true)` —
// prose must not count as code), whitespace-normalized, top-level args split on
// their own depth-1 commas.

const NAV_APP = process.env.ATLAS_NAV_APP || null

/** JS source with every comment removed (string/template bodies preserved) */
function stripJsComments(src) {
  let out = '', i = 0, inStr = null, inCom = null
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (inCom) {
      if (inCom === '//' && c === '\n') { inCom = null; out += c }
      else if (inCom === '/*' && c === '*' && d === '/') { i++; inCom = null }
      i++
      continue
    }
    if (inStr) {
      out += c
      if (c === '\\') { out += d == null ? '' : d; i += 2; continue }
      if (c === inStr) inStr = null
      i++
      continue
    }
    if (c === '/' && d === '/') { inCom = '//'; i += 2; continue }
    if (c === '/' && d === '*') { inCom = '/*'; i += 2; continue }
    if (c === '"' || c === "'" || c === '`') { inStr = c; out += c; i++; continue }
    out += c
    i++
  }
  return out
}

/**
 * Every selectNode()/focusForId() call site (declarations excluded) with its
 * top-level arguments, straight out of comment-stripped, whitespace-normalized
 * source — the shape a re-spelling cannot hide from.
 */
function callSites(srcText, fns) {
  const code = stripJsComments(srcText).replace(/\s+/g, ' ')
  const sites = []
  for (const fn of fns) {
    const re = new RegExp('(^|[^\\w$.])' + fn + '\\s*\\(', 'g')
    let m
    while ((m = re.exec(code))) {
      // m[0] may carry the preceding delimiter char, so the NAME starts after it
      const at = m.index + m[1].length
      if (code.slice(Math.max(0, at - 9), at).endsWith('function ')) continue // the declaration, not a call
      let i = re.lastIndex, depth = 1, cur = '', args = [], inStr = null
      for (; i < code.length; i++) {
        const c = code[i]
        if (inStr) {
          cur += c
          if (c === '\\') { cur += code[++i] } else if (c === inStr) inStr = null
          continue
        }
        if (c === '"' || c === "'" || c === '`') { inStr = c; cur += c; continue }
        if (c === '(' || c === '[') depth++
        else if (c === ')' || c === ']') { depth--; if (depth === 0) break }
        if (c === ',' && depth === 1) { args.push(cur.trim()); cur = ''; continue }
        cur += c
      }
      if (cur.trim()) args.push(cur.trim())
      sites.push({ fn, args, text: fn + '(' + args.join(', ') + ')' })
    }
  }
  return sites
}

/**
 * The audit itself: expected nav-carrying COUNT + the group/zone door ban.
 * Returns violations (empty ⇒ green), so a mutated copy can be proved RED
 * without an assert() hiding inside the helper.
 */
function navAudit(srcText) {
  const sites = callSites(srcText, ['selectNode', 'focusForId'])
  const isNav = (s) => s.args.length >= 2 && s.args[s.args.length - 1] === 'true'
  const nav = sites.filter(isNav)
  const navSelect = nav.filter((s) => s.fn === 'selectNode')
  const navFocus = nav.filter((s) => s.fn === 'focusForId')
  const v = []
  if (navSelect.length !== 7) v.push(`nav-carrying selectNode sites: expected 7, found ${navSelect.length} [${navSelect.map((s) => s.text).join(' | ')}]`)
  if (navFocus.length !== 1) v.push(`nav-carrying focusForId sites: expected 1, found ${navFocus.length} [${navFocus.map((s) => s.text).join(' | ')}]`)
  // every GROUP/ZONE-shaped selection is a navigation-free door by R44/R46 rule:
  // 'cat:' zone breadcrumbs, 'g:' group breadcrumbs, the related-group row, and
  // (V2.7 R51) the zone-details group-header button.
  const groupDoors = sites.filter((s) => /['"](?:cat|g):/.test(s.args[0] || ''))
  const leaky = groupDoors.filter(isNav)
  if (leaky.length) v.push(`group/zone doors carry nav: [${leaky.map((s) => s.text).join(' | ')}]`)
  if (groupDoors.length !== 5) v.push(`group/zone-shaped selectNode doors: expected 5, found ${groupDoors.length} [${groupDoors.map((s) => s.text).join(' | ')}]`)
  // the bare shape now feeds THREE doors: the nav-free node tap, the nav-free
  // blank deselect, and (V2.7 R49) the package dbl-tap selectNode(evt.target.id(),
  // true) — exactly ONE of them may carry nav, and it must be that dbl-tap shape;
  // a nav flag sneaking into the plain tap is still the R46 regression.
  const bare = sites.filter((s) => /evt\.target\.id\(\)|^null$/.test(s.args[0] || ''))
  const dblDoors = bare.filter(isNav)
  const bareTaps = bare.filter((s) => !isNav(s))
  if (bareTaps.length !== 2) v.push(`nav-free tap doors: expected 2 (node tap + blank deselect), found ${bareTaps.length}`)
  if (dblDoors.length !== 1) v.push(`nav-carrying bare-shape doors: expected 1 (the R49 dbl-tap funnel), found ${dblDoors.length} [${dblDoors.map((s) => s.text).join(' | ')}]`)
  if (!dblDoors.some((s) => /evt\.target\.id\(\)/.test(s.args[0] || ''))) v.push('the single nav-carrying bare door is not the dbl-tap evt.target.id() shape')
  return v
}

test('V2.6-fix M1 (+V2.7 R49/R51) nav audit by shape: 7+1 nav sites exactly, every group/zone door nav-free, mutation-proven teeth', () => {
  const src = readFileSync(NAV_APP || join(WEB, 'app.js'), 'utf8')
  const v = navAudit(src)
  assert.deepEqual(v, [], 'the shape audit found: ' + v.join('; '))
  // TEETH 1: a nav flag added to the GROUP details zone-crumb (the exact leak the
  // call-site regexes could not see — it matches no known needle) must redden.
  const crumb = "crumbButton(box, zoneTitle(zone), function () { selectNode('cat:' + zone) })"
  assert.equal((src.match(new RegExp(crumb.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1,
    'the zone-crumb call site the mutation is aimed at is still there verbatim')
  const mutated = src.replace(crumb, crumb.replace("selectNode('cat:' + zone)", "selectNode('cat:' + zone, true)"))
  assert.notEqual(mutated, src, 'the mutation applied')
  const vm1 = navAudit(mutated)
  assert.ok(vm1.length > 0, 'MUTATION NOT CAUGHT: a `, true` on the zone breadcrumb slipped past the shape audit')
  assert.ok(vm1.some((x) => /group\/zone doors carry nav/.test(x)), 'and it is caught by the group-door ban: ' + vm1.join('; '))
  assert.ok(vm1.some((x) => /expected 7, found 8/.test(x)), '…and by the count: ' + vm1.join('; '))
  // TEETH 2: a re-spelling the old regexes are blind to (whitespace + different
  // argument expression, SAME door) must redden the count, not stay green.
  const respelled = src.replace("selectNode(String(target.id), true)", "selectNode(\n        String(target.id),\n        true\n      )")
  assert.notEqual(respelled, src, 'the re-spelling applied')
  assert.deepEqual(navAudit(respelled), [], 'the audit is whitespace-blind: re-spelling the SAME door changes nothing')
  // TEETH 3: a brand-new nav door (the leak class the brief names) reddens.
  const extra = src.replace("selectNode('g:' + gid)", "selectNode('g:' + gid, true)")
  assert.notEqual(extra, src, 'the new nav door applied')
  assert.ok(navAudit(extra).length > 0, 'a group door given the nav flag is caught')
})

test('V2.6-fix M1 the strip+parse layer itself is sound (no prose counted, no site missed)', () => {
  const src = readFileSync(NAV_APP || join(WEB, 'app.js'), 'utf8')
  // the doc comments literally quote the API — they must NOT be counted as calls
  assert.match(src, /^\s*\/\/.*selectNode\(id, true\)/m, 'the source really does quote selectNode(id, true) in a comment')
  const raw = (stripJsComments(src).match(/selectNode/g) || []).length
  assert.ok(raw < (src.match(/selectNode/g) || []).length, 'comment stripping removed the prose occurrences')
  const sites = callSites(src, ['selectNode', 'focusForId'])
  const kinds = sites.filter((s) => s.fn === 'selectNode').length
  assert.equal(kinds, 14, 'every selectNode CALL (declarations excluded) is in the audit set — V2.7 adds the dbl-tap door + the zone group-header door: ' + kinds)
  assert.ok(sites.every((s) => s.args.length >= 1), 'each site parsed to at least one argument')
  assert.deepEqual(sites.filter((s) => s.fn === 'focusForId').map((s) => s.args.join(',')).sort(),
    ['id,nav', 'n.id,true'], 'focusForId: the funnel pass-through + the one reveal nav site')
})

// ---------- V2.6-fix M2: the search popover is anchored to its input ----------
//
// #search-results carried a hard-coded top/left pair from the pre-R47 toolbar.
// The input moved to segment ④, so the list sprang up somewhere to the left of
// the thing the user was typing into. The input's own rect is the only honest
// anchor; the box is clamped so it can never hang off-screen.

function loadSearchDom(rect, box, vp) {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    'var HITS = [{ id: \x27a@1\x27, name: \x27alpha\x27, kind: \x27package\x27, description: \x27first\x27 },\n'
    + '  { id: \x27b@1\x27, name: \x27beta\x27, kind: \x27package\x27, description: null }]\n',
    'var REVEALED = []\n',
    'var RECT = ' + JSON.stringify(rect) + '\n',
    'var INPUT = { value: \x27\x27, handlers: {}, addEventListener: function (t, f) { this.handlers[t] = f },\n'
    + '  getBoundingClientRect: function () { return RECT } }\n',
    'var BOX = { hidden: true, style: {}, children: [], offsetWidth: ' + box.w + ', offsetHeight: ' + box.h + ',\n'
    + '  get textContent() { return \x27\x27 }, set textContent(v) { this.children = [] },\n'
    + '  appendChild: function (c) { c.parentNode = this; this.children.push(c); return c } }\n',
    'var document = { getElementById: function (id) { return id === \x27search\x27 ? INPUT : id === \x27search-results\x27 ? BOX : null },\n'
    + '  createElement: function (tag) { return { tagName: tag, className: \x27\x27, style: {}, children: [],\n'
    + '    handlers: {}, addEventListener: function (t2, f) { this.handlers[t2] = f },\n'
    + '    appendChild: function (c) { this.children.push(c); return c } } } }\n',
    'var window = { innerWidth: ' + vp.w + ', innerHeight: ' + vp.h + ' }\n',
    'function escText(el, s) { el.textContent = s == null ? \x27\x27 : String(s) }\n',
    'function t(k) { return k }\n',
    'function shortName(name, kind) { return String(name) }\n',
    'function matchNodes(g, q, cap) { return q ? HITS.slice(0, cap) : [] }\n',
    'function revealNode(n) { REVEALED.push(n.id) }\n',
    'var state = { graph: { nodes: [] } }\n',
    extractBalanced(src, 'function positionSearchBox(input, box) {') + '\n',
    extractBalanced(src, 'function bindSearch() {') + '\n',
    'return { INPUT: INPUT, BOX: BOX, RECT: RECT, REVEALED: REVEALED, bind: bindSearch }',
  ].join('')
  return new Function(body)()
}
const SEARCH_RECT = { left: 320, top: 8, right: 560, bottom: 36, width: 240, height: 28, x: 320, y: 8 }
const SEARCH_BOX = { w: 460, h: 120 }
const SEARCH_VP = { w: 1200, h: 800 }
const settle = (ms) => new Promise((r) => setTimeout(r, ms))

/** drive the debounced search once (the ctl's own 150ms timer is left in place) */
async function searchOnce(d, q) {
  d.INPUT.value = q
  d.INPUT.handlers.input()
  await settle(240)
  return d
}

test('V2.6-fix M2 the search popover anchors under the input, not at a fixed top/left', async () => {
  const d = loadSearchDom(SEARCH_RECT, SEARCH_BOX, SEARCH_VP)
  d.bind()
  await searchOnce(d, 'a')
  assert.equal(d.BOX.hidden, false, 'a hit list opened')
  assert.equal(d.BOX.children.length, 2, 'two rows rendered')
  assert.equal(d.BOX.style.left, '320px', 'left is aligned to the INPUT\x27S left edge (rect.left)')
  assert.equal(d.BOX.style.top, '40px', 'top is the input\x27s bottom edge + 4 (36 + 4)')
  // the anchor is LIVE, not a one-shot: move the input (the segment wraps on a
  // narrow pane) and the list follows it
  d.RECT.left = 860; d.RECT.right = 1100; d.RECT.x = 860
  d.RECT.top = 52; d.RECT.bottom = 80; d.RECT.y = 52
  await searchOnce(d, 'al')
  assert.equal(d.BOX.style.left, '740px', 'clamped to innerWidth - box width (1200 - 460) instead of hanging off 860+460')
  assert.equal(d.BOX.style.top, '84px', 'and it followed the input down to 80 + 4')
})

test('V2.6-fix M2 the anchored popover stays inside the viewport and keeps the [hidden] toggle', async () => {
  // a short pane: the list cannot fit below the input → it flips above it
  const d = loadSearchDom({ left: 20, top: 700, right: 260, bottom: 728, width: 240, height: 28, x: 20, y: 700 },
    SEARCH_BOX, { w: 1200, h: 800 })
  d.bind()
  await searchOnce(d, 'a')
  assert.equal(d.BOX.hidden, false, 'opened')
  assert.equal(d.BOX.style.left, '20px', 'left untouched (it fits)')
  assert.equal(d.BOX.style.top, '576px', '700 - 120 - 4: flipped ABOVE the input rather than running past the pane')
  assert.ok(Number(d.BOX.style.top.replace('px', '')) + SEARCH_BOX.h <= 800, 'the box bottom is inside the viewport')
  // an input further right than the box can be: clamp, never a negative overflow
  const e = loadSearchDom({ left: 1150, top: 8, right: 1190, bottom: 36, width: 40, height: 28, x: 1150, y: 8 },
    SEARCH_BOX, { w: 1200, h: 800 })
  e.bind()
  await searchOnce(e, 'a')
  assert.equal(e.BOX.style.left, '740px', 'clamped flush right (1200 - 460)')
  assert.ok(Number(e.BOX.style.left.replace('px', '')) >= 0, 'never negative off the left edge')
  // the [hidden] toggle is UNCHANGED: empty query ⇒ closed, no hits ⇒ closed
  await searchOnce(e, '')
  assert.equal(e.BOX.hidden, true, 'an empty query closes the list')
  const g = loadSearchDom(SEARCH_RECT, SEARCH_BOX, SEARCH_VP)
  assert.equal(g.BOX.hidden, true, 'the popover ships hidden before any search runs')
  g.bind()
  assert.equal(g.BOX.hidden, true, 'binding alone never opens it')
})

test('V2.6-fix M2 anchors by rect + style only: no HTML sink, no magic offsets, [hidden] intact', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  const pos = extractBalanced(src, 'function positionSearchBox(input, box) {')
  assert.match(pos, /getBoundingClientRect\(\)/, 'the input rect is the single anchor')
  assert.match(pos, /box\.style\.left\s*=/, 'positioned through style.left')
  assert.match(pos, /box\.style\.top\s*=/, '…and style.top')
  assert.doesNotMatch(pos, /innerHTML|insertAdjacentHTML|outerHTML|document\.write/, 'no HTML sink in the positioner')
  assert.doesNotMatch(pos, /\bt\(/, 'the positioner is chrome-only: zero i18n surface')
  // No new i18n key for the popover. Scoped to the DICTIONARY (a whole-source
  // regex would match the fix's own prose): the V6 parity test above already fails
  // the moment any t('key') lacks a zh or en entry, so this pins that the fix round
  // did not reach for one.
  const dict = extractBalanced(src, 'var I18N = {')
  assert.doesNotMatch(dict, /popover|searchResults|anchor|popoverAnchor/i,
    'the i18n dictionaries gained no search-popover key for this fix')
  assert.match(dict, /\bsearch:/, 'the pre-existing search placeholder key is still the only search string')
  // the CSS half: the hard-coded pair is GONE (it was the detachment)
  const rule = /#search-results \{[^}]*\}/.exec(css)
  assert.ok(rule, 'the #search-results rule still exists')
  assert.doesNotMatch(rule[0], /\btop:\s*\d+px/, 'no fixed top any more — JS owns it now')
  assert.doesNotMatch(rule[0], /\bleft:\s*\d+px/, 'no fixed left any more')
  assert.doesNotMatch(rule[0], /position:\s*absolute/, 'fixed positioning: viewport coordinates are the input rect\x27s own space')
  assert.match(rule[0], /position:\s*fixed/, '…and it is position:fixed')
  assert.doesNotMatch(rule[0], /display:/, 'the rule declares no display ⇒ the UA [hidden] toggle keeps working')
  assert.match(src, /box\.hidden = searchHits\.length === 0/, 'the JS still toggles hidden off the hit count')
  assert.match(src, /function bindSearch\(\) \{[\s\S]*?if \(!box\.hidden\) positionSearchBox\(input, box\)/,
    'positioning runs on OPEN (after the rows exist, so the real height is measurable)')
})



// =========================================================================
// Task V2.7 — the dependency-graph rename (R48), dbl-tap entry (R49),
// zero-camera transitions (R50), the leveled details panel (R51) and the
// legend move (R52). R49/R50 ride the camera migrations above (every
// entry/walk/re-root/exit matrix REVERSED to zero-camera) plus the real-
// handler dbl matrices in test/ctx-menu-wiring.test.mjs. Below: the rename
// guards, the leveled-panel source/CSS guards, and a fake-DOM test that
// drives the REAL grouped zone-details builder end to end.
// =========================================================================

test('V2.7 R48 rename guards: 依赖图 ships in every locale; no dictionary value says 路径模式 again; path-list labels untouched', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const html = readFileSync(join(WEB, 'index.html'), 'utf8')
  const I18N = new Function(extractBalanced(src, 'var I18N = {') + '\nreturn I18N')()
  assert.equal(I18N.zh.menuPkgPath, '依赖图', 'zh package menu command renamed')
  assert.equal(I18N.en.menuPkgPath, 'dependency graph', 'en package menu command renamed')
  assert.ok(I18N.zh.focusOff.includes('依赖图'), 'zh exit button names the graph it exits')
  assert.ok(I18N.en.focusOff.includes('dependency graph'), 'en exit button too')
  assert.equal(I18N.zh.legendFocus, '依赖图配色', 'zh legend section renamed')
  assert.equal(I18N.en.legendFocus, 'dependency graph colors', 'en legend section renamed')
  // the guard the brief asks for: the old mode name is gone from EVERY value,
  // in EVERY locale (ids, keys and internal names are deliberately untouched)
  for (const loc of ['zh', 'en']) {
    for (const [k, v] of Object.entries(I18N[loc])) {
      assert.ok(!String(v).includes('路径模式'), `${loc}.${k} still says 路径模式`)
    }
  }
  // the untouched neighbors (R48 renamed the MODE, not the path LIST labels)
  assert.equal(I18N.zh.pathDownLabel, '依赖路径 ↓', 'path-list label untouched')
  assert.equal(I18N.zh.pathUpLabel, '被依赖路径 ↑', 'path-list label untouched')
  assert.equal(I18N.zh.menuFocusGroup, '聚焦邻域（1 跳）', 'group-focus command untouched')
  assert.match(html, /id="focus-clear" data-i18n="focusOff">退出依赖图</, 'the static chrome ships the renamed exit button')
})

test('V2.7 R51 source guards: level classes on the details container, chip in the h2, the group-header door stays nav-free', () => {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const rd = extractBalanced(src, 'function renderDetails(id) {')
  assert.match(rd, /box\.className = 'lvl-zone'/, 'zone details carry lvl-zone')
  assert.match(rd, /box\.setAttribute\('data-zone', s\.slice\(4\)\)/, 'the zone band keys off data-zone (a palette zone id, never free text)')
  assert.match(rd, /box\.className = ''/, 'every render RESETS the level first')
  assert.match(rd, /box\.setAttribute\('data-zone', ''\)/, '…and the zone key with it')
  assert.match(rd, /box\.className = 'lvl-group'/, 'group details carry lvl-group')
  assert.match(rd, /box\.className = 'lvl-pkg'/, 'package details carry lvl-pkg')
  const edge = src.slice(src.indexOf('function detailsEdge(box, id) {'), src.indexOf('function pathListSection'))
  assert.ok(!/lvl-/.test(edge), 'the EDGE detail builder never touches a level class — neutral container')
  const edgeDispatch = rd.slice(rd.indexOf('agg:'))
  assert.match(edgeDispatch, /detailsEdge\(box, s\); return/, 'edges dispatch BEFORE any lvl assignment')
  const chip = extractBalanced(src, 'function lvlChip(h, label) {')
  assert.match(chip, /escText\(c, label\)/, 'chip text is escText-only (dictionary strings, no HTML surface)')
  assert.match(chip, /h\.insertBefore\(c, h\.firstChild\)/, 'the chip rides INSIDE the header h2')
  assert.match(src, /lvlChip\(head\(box, zoneTitle\(cid\)\), t\('lvlZone'\)\)/, 'zone header gets the 区 chip')
  assert.match(src, /lvlChip\(head\(box, gid\), t\('lvlGroup'\)\)/, 'group header gets the 组 chip')
  assert.match(src, /lvlChip\(head\(box, String\(n\.name == null \? n\.id : n\.name\)\), t\('lvlPkg'\)\)/, 'package header gets the 包 chip')
  const zd = src.slice(src.indexOf('function detailsZone(box, cid) {'), src.indexOf('function detailsGroup(box, gid) {'))
  assert.match(zd, /hb\.className = 'jump ghead'/, 'group headers are buttons riding the shared .jump row class')
  assert.match(zd, /escText\(hb, gid \+ ' \\u00d7' \+ res\.total\)/, 'header text is escText(gid ×TRUE total)')
  assert.match(zd, /hb\.addEventListener\('click', function \(\) \{ selectNode\('g:' \+ gid\) \}\)/, 'the header click IS the plain group door')
  assert.doesNotMatch(zd, /selectNode\([^\n]*true\)/, 'the group-header door carries NO nav flag (cold select, in-focus walk)')
  assert.match(zd, /var rows = document\.createElement\('div'\); rows\.className = 'gmem'/, 'member rows sit in an indented .gmem wrapper')
  assert.match(zd, /res\.rows\.slice\(0, ZONE_GROUP_CAP\)/, 'members capped per section')
  assert.match(zd, /kvRow\(box, '', t\('groupMoreLabel'\)\.replace\('\{n\}', res\.total - ZONE_GROUP_CAP\)\)/, '还有 N tail counts exactly what the cap hid')
  assert.match(zd, /if \(!res\.total\) return/, 'zero-member groups stay invisible')
})

test('V2.7 R51 CSS guards: accent bands per level, the fixed 13-zone palette bands, chip and indent rules', () => {
  const css = readFileSync(join(WEB, 'style.css'), 'utf8')
  assert.match(css, /#details\.lvl-zone \{ border-left: 4px solid #8a94a0; \}/, 'zone level: 4px band, ungrouped-grey fallback')
  assert.match(css, /#details\.lvl-group \{ border-left: 4px solid #4f6b8a; \}/, 'group level: slate blue')
  assert.match(css, /#details\.lvl-pkg \{ border-left: 4px solid #3f9d6d; \}/, 'package level: green')
  assert.match(css, /#details\.lvl-zone h2 \{ font-size: 16px; \}/, 'zone title 16px')
  assert.match(css, /#details\.lvl-group h2 \{ font-size: 14px; \}/, 'group title 14px')
  assert.match(css, /#details\.lvl-pkg h2 \{ font-size: 13px; font-family: ui-monospace, Consolas, monospace; \}/, 'package title 13px + monospace name')
  // the zone bands are FIXED light-palette hexes (brief-sanctioned), one per zone
  const bands = {
    kernel: '#4a5fd0', session: '#2f81c2', llm: '#12a5a5', tools: '#55a630',
    orchestration: '#7f9e1c', integration: '#c9971b', ui: '#d1417c', platform: '#4f6b8a',
    infra: '#0f7d64', plugin: '#9a6ac2', profiles: '#d9a441', broken: '#d0433f', ungrouped: '#8a94a0',
  }
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  for (const [zid, hex] of Object.entries(bands)) {
    // the band color must EQUAL ZONE_COLORS.light[id].line — one palette, two readers
    assert.ok(src.includes(zid + ": { line: '" + hex + "' }"), `app.js ZONE_COLORS light ${zid} = ${hex}`)
    assert.ok(css.includes(`#details.lvl-zone[data-zone="${zid}"] { border-left-color: ${hex}; }`), `zone band ${zid} → ${hex} ships`)
  }
  assert.match(css, /#details h2 \.lvl/, 'the badge chip is styled')
  assert.match(css, /#details \.ghead \{ font-weight: 700; \}/, 'group-header buttons read as section heads')
  assert.match(css, /#details \.gmem \{ padding-left: 14px; \}/, 'member rows indent under their header')
})

// ---------- R51: the grouped zone details render through the REAL builders ----------
// Same doctrine as every V2.x harness: extractBalanced pulls the REAL details
// chain (detailsZone → zoneGroupSections → buildGroupMembers → memberRow) into
// a fake DOM; only the doors (selectNode/revealNode) and the dictionary are
// stubs. Nothing mid-chain is faked.

function loadZoneDetailsDom() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const cap = /var ZONE_GROUP_CAP = [^\n;]+/.exec(src)
  assert.ok(cap, 'app.js must still declare `var ZONE_GROUP_CAP = …`')
  const body = [
    'var LOG = []\n',
    'var KEYS = { lvlZone: \x27区\x27, lvlGroup: \x27组\x27, lvlPkg: \x27包\x27, groupsLabel: \x27GROUPS\x27, memberPkgsLabel: \x27MEMBERS({n})\x27, groupMoreLabel: \x27MORE:{n}\x27, unsatLabel: \x27UNSAT\x27, brokenLabel: \x27BROKEN\x27 }\n',
    'function t(k) { return Object.prototype.hasOwnProperty.call(KEYS, k) ? KEYS[k] : k }\n',
    'function selectNode(id, nav) { LOG.push(\x27select:\x27 + id + (nav ? \x27:nav\x27 : \x27:bare\x27)) }\n',
    'function revealNode(n) { LOG.push(\x27reveal:\x27 + n.id) }\n',
    'function El(tag) {\n',
    '  this.tag = tag; this.children = []; this.className = \x27\x27; this.text = \x27\x27; this.handlers = {}; this.hidden = false\n',
    '  var self = this\n',
    '  this.appendChild = function (c) { c.parentNode = self; this.children.push(c); return c }\n',
    '  this.insertBefore = function (n, ref) { var i = this.children.indexOf(ref); if (i < 0) return this.appendChild(n); n.parentNode = self; this.children.splice(i, 0, n); return n }\n',
    '  this.addEventListener = function (k, fn) { self.handlers[k] = fn }\n',
    '}\n',
    'Object.defineProperty(El.prototype, \x27textContent\x27, {\n',
    '  get: function () { return this.text },\n',
    '  set: function (v) { this.text = String(v); this.children.length = 0 },\n',
    '})\n',
    'var document = { createElement: function (tag) { return new El(tag) },\n',
    '  createTextNode: function (s) { return { tag: \x27#text\x27, text: String(s), children: [], className: \x27\x27 } } }\n',
    'var state = { graph: null, byId: new Map(), groupIds: new Set(), groupZone: new Map(), lang: \x27zh\x27, selected: null, focus: null }\n',
    cap[0] + '\n',
    extractBalanced(src, 'function escText(el, s) {') + '\n',
    extractBalanced(src, 'function catById(graph) {') + '\n',
    extractBalanced(src, 'function zoneTitle(catId) {') + '\n',
    extractBalanced(src, 'function head(box, text) {') + '\n',
    extractBalanced(src, 'function kvRow(box, key, value) {') + '\n',
    extractBalanced(src, 'function secTitle(box, text) {') + '\n',
    extractBalanced(src, 'function lvlChip(h, label) {') + '\n',
    extractBalanced(src, 'function groupZoneOf(graph, gid) {') + '\n',
    extractBalanced(src, 'function buildGroupMembers(sel, graph) {') + '\n',
    extractBalanced(src, 'function memberRow(box, row, onClick) {') + '\n',
    extractBalanced(src, 'function detailsZone(box, cid) {') + '\n',
    extractBalanced(src, 'function zoneGroupSections(box, groups) {') + '\n',
    'return { state: state, LOG: LOG, El: El, CAP: ZONE_GROUP_CAP, detailsZone: detailsZone }',
  ].join('')
  return new Function(body)()
}

/** one tools zone: alpha(2) + beta(13, over the cap) + zeta(1) + an EMPTY group */
function zoneDetailsGraph() {
  const mk = (id, group) => ({ id, kind: 'package', name: id.replace(/@.*$/, ''), version: '1.0.0', group, category: 'tools', scope: 'official' })
  const nodes = []
  for (let i = 1; i <= 13; i++) nodes.push(mk('b' + i + '@1', 'beta'))
  nodes.push(mk('a1@1', 'alpha'), mk('a2@1', 'alpha'), mk('z1@1', 'zeta'))
  return {
    categories: [{ id: 'tools', zh: '工具', en: 'Tools' }],
    groups: [{ id: 'zeta', kind: 'official', category: 'tools' }, { id: 'alpha', kind: 'official', category: 'tools' },
      { id: 'beta', kind: 'official', category: 'tools' }, { id: 'empty', kind: 'official', category: 'tools' }],
    nodes,
    edges: [],
  }
}

test('V2.7 R51 zone details list BY GROUP through the real builders: chip, alphabetical sections, capped members, nav-free header door', () => {
  const dom = loadZoneDetailsDom()
  const graph = zoneDetailsGraph()
  dom.state.graph = graph
  dom.state.byId = new Map(graph.nodes.map((n) => [n.id, n]))
  dom.state.groupIds = new Set(['alpha', 'beta', 'empty', 'zeta'])
  dom.state.groupZone = new Map([['alpha', 'tools'], ['beta', 'tools'], ['empty', 'tools'], ['zeta', 'tools']])
  assert.equal(dom.CAP, 10, 'ten member rows per group section')
  const box = new dom.El('div')
  dom.detailsZone(box, 'tools')
  assert.equal(box.children[0].tag, 'h2', 'the panel opens with the header')
  assert.equal(box.children[0].children[0].className, 'lvl', 'the 区 chip rides INSIDE the h2 (R51)')
  assert.equal(box.children[0].children[0].text, '区', 'chip text is the zh dictionary label')
  assert.equal(box.children[0].text, '工具', 'the h2 title is the zone title')
  const kv = (key) => box.children.find((c) => c.className === 'kv' && c.children[0].text === key)
  assert.equal(kv('GROUPS').children[1].text, '4', 'the GROUPS row counts every group in the zone…')
  const heads = box.children.filter((c) => (c.className || '').split(' ').includes('ghead'))
  assert.deepEqual(heads.map((h) => h.text), ['alpha ×2', 'beta ×13', 'zeta ×1'], 'sections are alphabetical with TRUE totals…')
  assert.equal(heads.some((h) => h.text.startsWith('empty')), false, '…and the zero-member group is invisible (the flat list showed nothing for it either)')
  const gmems = box.children.filter((c) => c.className === 'gmem')
  assert.deepEqual(gmems.map((g) => g.children.length), [2, dom.CAP, 1], 'each section lists AT MOST CAP indented rows')
  const more = box.children.filter((c) => c.className === 'kv' && c.children[1].text === 'MORE:3')
  assert.equal(more.length, 1, 'the cut beta section tails with 还有 3 (13-10, exactly what the cap hid)')
  // the header door: the REAL click → selectNode('g:'+gid) with NO nav flag
  heads[1].handlers.click()
  assert.deepEqual(dom.LOG, ['select:g:beta:bare'], 'the group header opens the group WITHOUT nav (cold = select, in-focus = walk)')
  // member rows reveal through the shared reveal contract
  gmems[2].children[0].handlers.click()
  assert.deepEqual(dom.LOG, ['select:g:beta:bare', 'reveal:z1@1'], 'an indented member row is the shared reveal (the fake stub stands in for the REAL revealNode chain, itself pinned by its own suite)')
  // an empty zone keeps its honest zero header
  const emptyBox = new dom.El('div')
  dom.state.groupIds = new Set()
  dom.state.groupZone = new Map()
  dom.detailsZone(emptyBox, 'tools')
  assert.equal(emptyBox.children.filter((c) => c.className === 'ghead' || c.className === 'gmem').length, 0, 'no sections at all')
  assert.equal(emptyBox.children[emptyBox.children.length - 1].text, 'MEMBERS(0)', '…just the honest zero header')
})
