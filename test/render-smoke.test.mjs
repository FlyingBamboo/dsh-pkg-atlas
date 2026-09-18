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

function loadAppPure() {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    extractBalanced(src, 'var EDGE_KINDS_ALL = [') + '\n',
    extractBalanced(src, 'var DOWN_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'var UP_EDGE_KINDS = [') + '\n',
    extractBalanced(src, 'function normalizeDepth(depth) {') + '\n',
    extractBalanced(src, 'function pathSets(graph, rootId, depth) {') + '\n',
    extractBalanced(src, 'function buildPathLists(sets, graph, byId) {') + '\n',
    extractBalanced(src, 'function matchNodes(graph, query, limit) {') + '\n',
    extractBalanced(src, 'function progressFor(status) {') + '\n',
    extractBalanced(src, 'function edgeKindsFor(checked) {') + '\n',
    'return { EDGE_KINDS_ALL, normalizeDepth, pathSets, buildPathLists, matchNodes, progressFor, edgeKindsFor }',
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
    extractBalanced(src, 'function normalizeDepth(depth) {') + '\n',
    extractBalanced(src, 'function pathSets(graph, rootId, depth) {') + '\n',
    extractBalanced(src, 'function gidOf(n) {') + '\n',
    extractBalanced(src, 'function renderIdOf(id) {') + '\n',
    extractBalanced(src, 'function applyClasses() {') + '\n',
    'var state = { cy: null, graph: null, byId: new Map(), groupZone: new Map(), focus: null, selected: null }\n',
    'return { pathSets: pathSets, apply: function (o) { Object.assign(state, o); applyClasses() } }',
  ].join('')
  return new Function(body)()
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
    'var KEYS = { pathCountLabel: \x27{n}·{d}\x27, pathNoneLabel: \x27NONE\x27, pathDistLabel: \x27d{n}\x27, unsatLabel: \x27UNSAT\x27, mountsLabel: \x27MOUNTS\x27, moreLabel: \x27+{n} MORE\x27 }\n',
    'function t(k) { return Object.prototype.hasOwnProperty.call(KEYS, k) ? KEYS[k] : k }\n',
    'function selectNode(id) { SELECTED.push(id) }\n',
    'function El(tag) {\n',
    '  this.tag = tag; this.children = []; this.className = \x27\x27; this.text = \x27\x27; this.handlers = {}\n',
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
    'var state = { graph: null, byId: new Map() }\n',
    capDecl[0] + '\n',
    extractBalanced(src, 'function escText(el, s) {') + '\n',
    extractBalanced(src, 'function kvRow(box, key, value) {') + '\n',
    extractBalanced(src, 'function secTitle(box, text) {') + '\n',
    extractBalanced(src, 'function pathRow(box, row, onClick) {') + '\n',
    extractBalanced(src, 'function pathListSection(box, title, rows) {') + '\n',
    extractBalanced(src, 'function mountOutSection(box, id) {') + '\n',
    'return { El: El, state: state, CLICKS: CLICKS, SELECTED: SELECTED, t: t,\n',
    '  pathListSection: pathListSection, mountOutSection: mountOutSection, CAP: PATH_ROW_CAP }',
  ].join('')
  return new Function(body)()
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
  assert.equal(box.children.length, 4, 'title + one row per member')
  assert.equal(box.children[0].className, 'sec', 'title row')
  assert.equal(box.children[0].text, 'DOWN · 3·2', 'header = title · {n} rows · deepest {d} layer')
  const row = box.children[1]
  assert.equal(row.className, 'jump', 'rows reuse the .jump row class (no new CSS surface)')
  assert.equal(row.children[0].text, evil + '@<script>', 'attacker name@version survive VERBATIM as text')
  assert.equal(row.children[1].className, 'dist')
  assert.equal(row.children[1].text, ' · d1', 'the BFS layer token renders through t(pathDistLabel)')
  assert.deepEqual(row.children.filter((c) => c.className === 'badge').map((c) => c.text), ['dep'], 'kind badge')
  assert.deepEqual(box.children[2].children.filter((c) => c.className === 'badge').map((c) => c.text),
    ['dep', 'peer'], 'a second kind reaches the same row as its own badge, in EDGE_KINDS order')
  assert.equal(box.children[2].children.slice(2).map((c) => [c.className, c.text]).slice(-1)[0][1], ' ⚠ UNSAT',
    'the unsatisfied flag rides the existing .unsat span')

  const texts = domTexts(box)
  assert.equal(texts.filter((s) => s.includes(evil)).length, 1,
    'the attacker string reaches the tree exactly once, as TEXT — never composed as markup')
  assert.equal(JSON.stringify(box).includes('innerHTML'), false, 'no innerHTML anywhere in the built tree')

  const betaBtn = box.children[2]
  assert.equal(betaBtn.handlers.click instanceof Function, true, 'rows are clickable')
  betaBtn.handlers.click()
  assert.deepEqual(dom.SELECTED, ['b'], 'clicking a row calls selectNode(row.id) → the focus re-roots there')

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
  assert.equal(bigBox.children.length, dom.CAP + 2, 'title + capped rows + the +N 更多 tail')
  assert.equal(bigBox.children[bigBox.children.length - 1].children[1].text, '+1 MORE',
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
  assert.doesNotMatch(src, /\.innerHTML|insertAdjacentHTML|createContextualFragment|document\.write/,
    'DOM writes go through textContent/createTextNode only (front-end XSS discipline)')
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
function classesApplied(Model, graph, view, focus, selected) {
  const logic = loadFocusLogic()
  const els = paintElements(Model, graph, view)
  const fake = makeFakeCy(els)
  logic.apply({
    cy: fake, graph, byId: byIdMap(graph), groupZone: zoneTable(graph), focus, selected,
  })
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
  // R35 tap wiring: a package tap focuses, anything else clears — one shared decision fn
  assert.match(src, /function focusForId\(id\) \{/, 'R35 routes focus through selectNode/revealNode')
  assert.match(src, /n\.kind === 'package'/, 'only kind=package nodes can be a focus root')
  assert.match(src, /state\.focus = focusForId\(id\)/, 'selectNode installs the focus')
  // rescan guard: a focus root that vanished OR stopped being a package is dropped
  assert.match(src, /state\.focus && \!isFocusRoot\(state\.focus\.rootId\)\) state\.focus = null/,
    'applyGraph prunes a stale focus root')
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
