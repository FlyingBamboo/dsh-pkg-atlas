/**
 * Task V5 — headless render smoke (+ fix round 1: dist-validity guards).
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
 * (ZONE_COLORS, ZONE_IDS_FALLBACK, state). styleFor() reads state.graph for the
 * per-zone selectors, so the caller hands it the SAME graph the model rendered.
 */
function loadAppStyle(graph) {
  const src = readFileSync(join(WEB, 'app.js'), 'utf8')
  const body = [
    extractBalanced(src, 'var ZONE_COLORS = {') + '\n',
    extractBalanced(src, 'var ZONE_IDS_FALLBACK = [') + '\n',
    extractBalanced(src, 'function styleFor(theme) {') + '\n',
    'var state = { graph: null }\n',
    'return { setGraph: function (g) { state.graph = g },\n'
    + '  styleFor: function (theme) { return styleFor(theme) },\n'
    + '  ZONE_COLORS: ZONE_COLORS, ZONE_IDS: ZONE_IDS_FALLBACK }',
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
