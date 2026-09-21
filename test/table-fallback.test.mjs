/**
 * Task V2.6-fix I1 — the renderTable DOM guard (table-fallback boot harness).
 *
 * renderTable() is the ENTIRE UI when cytoscape is unavailable, and until V2.6-fix
 * nothing in the suite ever let it run: every boot harness shipped the vendored
 * cytoscape, so the fallback branch was dark. That darkness hid a live ASI trap —
 *
 *   var hr = document.createElement('tr')      // ← no semicolon
 *   ['group', 'name', …].forEach(…)             // ← parses as hr['mountedBy']
 *
 * `[` cannot start a new statement after an expression, so ASI never fires: the
 * two lines are ONE statement, the bracket is a member access, the comma operator
 * leaves 'mountedBy', and `hr['mountedBy']` is undefined. `.forEach` throws, the
 * throw escapes paint()'s own catch (renderTable is called FROM that catch),
 * escapes applyGraph, and lands in loadGraph's `.catch` → the table paints ZERO
 * rows and the error bar shows, on EVERY load. The sibling tbody loop at :2424
 * already wears the leading-`;` defense; the header row did not.
 *
 * So this harness boots the REAL web/app.js with cytoscape DELIBERATELY ABSENT
 * (no window.cytoscape) and a bubbling fake DOM, which is exactly the real-world
 * condition the fallback exists for: paint() takes its catch, sets tableMode, and
 * calls renderTable(). Everything below asserts what a user would see.
 *
 * Mutation-proof hook: ATLAS_TABLE_APP may point at a mutated app.js copy.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', 'web')
const APP = process.env.ATLAS_TABLE_APP || join(WEB, 'app.js')

// ---------------- minimal fake DOM (tree + id registry + click dispatch) ----------------
class FEl {
  constructor(tag, doc) {
    this.tagName = String(tag).toUpperCase()
    this._doc = doc || null
    this.children = []
    this.parentNode = null
    this.className = ''
    this.hidden = false
    this.disabled = false
    this.style = {}
    this.text = ''
    this.attrs = {}
    this.value = ''
    this.checked = false
    this.placeholder = ''
    this.title = ''
    this._id = ''
    this._listeners = {}
  }
  get nodeType() { return 1 }
  get nodeName() { return this.tagName }
  get id() { return this._id }
  set id(v) { this._id = String(v); if (this._doc && this._id) this._doc._ids.set(this._id, this) }
  get textContent() { return this.text }
  set textContent(v) {
    this.text = v == null ? '' : String(v)
    this.children.forEach((c) => { c.parentNode = null })
    this.children = []
  }
  appendChild(c) {
    c.parentNode = this
    this.children.push(c)
    if (c.id && this._doc) this._doc._ids.set(c.id, c)
    return c
  }
  removeChild(c) {
    const i = this.children.indexOf(c)
    if (i >= 0) { this.children.splice(i, 1); c.parentNode = null }
    return c
  }
  addEventListener(t, fn) { (this._listeners[t] = this._listeners[t] || []).push(fn) }
  removeEventListener(t, fn) {
    const a = this._listeners[t] || []
    const i = a.indexOf(fn)
    if (i >= 0) a.splice(i, 1)
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null }
  /** one simple selector token, evaluated against this element's subtree */
  querySelector(sel) { return this._desc().find((c) => matchToken(c, String(sel).trim())) || null }
  getBoundingClientRect() {
    return { left: 320, top: 8, right: 560, bottom: 36, width: 240, height: 28, x: 320, y: 8 }
  }
  blur() {}
  focus() {}
  get classList() {
    const self = this
    const setOf = () => new Set(String(self.className).split(/\s+/).filter(Boolean))
    const write = (s) => { self.className = [...s].join(' ') }
    return {
      add(...c) { const s = setOf(); c.forEach((x) => s.add(x)); write(s) },
      remove(...c) { const s = setOf(); c.forEach((x) => s.delete(x)); write(s) },
      contains(c) { return setOf().has(c) },
      toggle(c, on) {
        const s = setOf()
        if (on === undefined) { s.has(c) ? s.delete(c) : s.add(c) } else if (on) s.add(c); else s.delete(c)
        write(s)
        return s.has(c)
      },
    }
  }
  /** descendants in document order (self excluded) */
  _desc() {
    const out = []
    const walk = (n) => { n.children.forEach((c) => { if (c instanceof FEl) { out.push(c); walk(c) } }) }
    walk(this)
    return out
  }
}

/** one simple selector token: `#id`? `tag`? `[attr]`? `.class`? — all optional, in order */
function matchToken(el, token) {
  const m = /^(?:#([\w-]+))?([a-zA-Z][\w-]*)?(?:\[([\w-]+)(?:=(['"])([^'"]*)\5)?\])?(?:\.([\w.-]+))?/.exec(token)
  if (!m) throw new Error('fake selector unsupported: ' + token)
  const [, id, tag, attr, , attrv, cls] = m
  if (id && el.id !== id) return false
  if (tag && el.tagName !== tag.toUpperCase()) return false
  if (attr && !(attr in el.attrs)) return false
  if (attr && attrv != null && el.attrs[attr] !== attrv) return false
  if (cls && !String(el.className).split(/\s+/).includes(cls)) return false
  return true
}

class FDoc {
  constructor() {
    this._ids = new Map()
    this.documentElement = new FEl('html', this)
    this.documentElement.ownerDocument = this
    this.head = new FEl('head', this)
    this.head.ownerDocument = this
    this.documentElement.appendChild(this.head)
    this.body = new FEl('body', this)
    this.body.ownerDocument = this
    this.documentElement.appendChild(this.body)
  }
  createElement(tag) {
    const el = new FEl(tag, this)
    el.ownerDocument = this
    return el
  }
  createTextNode(s) { return { text: String(s), parentNode: null, nodeType: 3 } }
  getElementById(id) { return this._ids.get(id) || null }
  /** descendant-compound subset: `A B` where each part is a simple token */
  querySelectorAll(sel) {
    const parts = String(sel).trim().split(/\s+/)
    const all = this.documentElement._desc()
    return all.filter((el) => {
      if (!matchToken(el, parts[parts.length - 1])) return false
      let i = parts.length - 2
      let n = el.parentNode
      while (i >= 0 && n) {
        if (matchToken(n, parts[i])) i--
        n = n.parentNode
      }
      return i < 0
    })
  }
}

const doc = new FDoc()
const mk = (id, tag, parent) => {
  const el = doc.createElement(tag || 'div')
  el.id = id
  ;(parent || doc.body).appendChild(el)
  return el
}
mk('graph')
mk('legend')
mk('table-fallback')
mk('zone-chips')
mk('details')
mk('search', 'input')
mk('search-results')
const pbar = mk('progress-bar')
pbar.hidden = true
mk('progress-fill', 'div', pbar).className = 'progress-fill'
mk('progress-text', 'div', pbar).className = 'progress-text'
mk('error-bar')
mk('error-msg')
mk('meta')
mk('warning-bar')
mk('focus-ctl')
mk('focus-depth', 'select').value = '0'
mk('focus-clear')
mk('path-back')
mk('reset-view', 'button')
mk('retry')
mk('refresh')
mk('lang-btn')
mk('scope-filter', 'select').value = 'all'
mk('profile-filter', 'select').value = ''
mk('show-real-cross', 'input').checked = false
const lod = mk('lod-ctl')
for (const seg of ['groups', 'packages']) {
  const b = mk('seg-' + seg, 'button', lod)
  b.setAttribute('data-seg', seg)
}
const ek = mk('edge-kinds')
for (const k of ['dep', 'mount', 'peer', 'peer-optional']) {
  const cb = mk('ek-' + k, 'input', ek)
  cb.setAttribute('data-kind', k)
  cb.checked = true
}

const W = { document: doc }
W.navigator = { language: 'zh-CN', userAgent: 'Mozilla/5.0 (table-fallback-harness)' }
W.devicePixelRatio = 1
W.scrollX = 0
W.scrollY = 0
W.pageXOffset = 0
W.pageYOffset = 0
W.innerWidth = 1200
W.innerHeight = 800
W.requestAnimationFrame = (fn) => setTimeout(() => fn(Date.now()), 16)
W.cancelAnimationFrame = (h) => clearTimeout(h)
W.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
W.getComputedStyle = () => ({ getPropertyValue: () => '0px' })
W.location = { hash: '' }
W.addEventListener = () => {}
// THE HAZARD THIS HARNESS IS BUILT AROUND: no cytoscape, on purpose. paint() must
// take its catch and hand the whole UI to renderTable().
if ('cytoscape' in W) throw new Error('the table harness must boot WITHOUT cytoscape')

globalThis.window = W
globalThis.document = doc
try { Object.defineProperty(globalThis, 'navigator', { value: W.navigator, configurable: true, writable: true }) } catch {}
try { Object.defineProperty(globalThis, 'location', { value: W.location, configurable: true, writable: true }) } catch {}
globalThis.getComputedStyle = W.getComputedStyle
globalThis.requestAnimationFrame = W.requestAnimationFrame
globalThis.cancelAnimationFrame = W.cancelAnimationFrame
globalThis.self = W

/** deliver a DOM event to a target and bubble it to every ancestor */
function fire(target, type, props) {
  const ev = Object.assign({ type, target, bubbles: true, preventDefault() {}, stopPropagation() { this.__stop = true } }, props || {})
  let n = target
  while (n) {
    const a = (n._listeners && n._listeners[type]) || []
    for (const fn of a.slice()) fn(ev)
    if (ev.__stop || !ev.bubbles) break
    n = n.parentNode
  }
  return ev
}

// ---------------- graph fixture (4 packages: counts are asserted, not assumed) ----------------
function pkg(id, name, group, category, scope, mountedBy) {
  return {
    id, kind: 'package', name, version: '1.0.0', scope, group, category,
    path: '$DSH_HOME\\' + name, description: null, servicesRequired: [], externalDeps: [],
    mountedBy: mountedBy || [], flags: { unreadable: false },
  }
}
const GRAPH = {
  schema: 1,
  generatedAt: '2026-09-17T00:00:00.000Z',
  dshHome: '$DSH_HOME',
  warnings: [],
  categories: [{ id: 'kernel' }, { id: 'tools' }],
  profiles: [],
  groups: [
    { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 2 },
    { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
  ],
  nodes: [
    pkg('r1@1', '@deepseek-ai/core', 'bundle', 'kernel', 'official', []),
    pkg('r2@1', '@deepseek-ai/util', 'bundle', 'kernel', 'official', ['web']),
    pkg('x@1', 'fs-watcher', 'fs', 'tools', 'third-party', []),
    pkg('d1@1', 'db-driver', 'fs', 'tools', 'third-party', []),
  ],
  edges: [
    { from: 'r1@1', to: 'x@1', kind: 'dep' },
    { from: 'd1@1', to: 'r1@1', kind: 'dep' },
  ],
}
globalThis.fetch = (url) => {
  const u = String(url)
  if (u.endsWith('/api/status')) return Promise.resolve({ ok: true, json: async () => ({ state: 'ready', phase: 'done' }) })
  if (u.includes('/api/readme')) return Promise.resolve({ ok: true, text: async () => 'readme' })
  return Promise.resolve({ ok: true, json: async () => JSON.parse(JSON.stringify(GRAPH)) })
}

// ---------------- boot the real app.js (cytoscape absent) ----------------
// index.html ships graph-model.js BEFORE app.js, and app.js reads it as a plain
// global (the details panel's pure helpers ride it even in table mode) — so the
// harness loads the real, UNMODIFIED file the same way.
new Function(readFileSync(join(WEB, 'graph-model.js'), 'utf8'))()
if (!globalThis.AtlasModel) throw new Error('graph-model.js must define globalThis.AtlasModel')
W.AtlasModel = globalThis.AtlasModel

const WARNS = []
const w0 = console.warn
console.warn = (...a) => { WARNS.push(a.map((x) => (x && x.stack ? x.stack : String(x))).join(' ')) }

let appSrc = readFileSync(APP, 'utf8')
const tail = '  boot()\n})()'
if (!appSrc.endsWith(tail + '\n') && !appSrc.endsWith(tail)) throw new Error('app.js tail anchor moved: ' + APP)
appSrc = appSrc.slice(0, appSrc.length - tail.length)
  + '  boot()\n  window.__t = { state: state }\n})()\n' // read-only exposure — nothing stubbed
new Function(appSrc)()

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const S = () => W.__t.state
for (let i = 0; i < 200 && !(S() && S().graph); i++) await sleep(20)

// ================= the guards =================
test('V2.6-fix I1 boot: with cytoscape absent the app really lands in table fallback', () => {
  assert.ok(S().graph, 'the graph fetched (the harness itself works)')
  assert.equal(S().tableMode, true, 'paint() took its catch → tableMode (WARNS: ' + WARNS.slice(0, 2).join(' // ') + ')')
  assert.equal(doc.getElementById('graph').hidden, true, '#graph hidden')
  assert.equal(doc.getElementById('table-fallback').hidden, false, '#table-fallback shown — the table IS the UI here')
})

test('V2.6-fix I1 renderTable paints a complete table (5 header cells, one row per node) and shows NO error bar', () => {
  const bar = doc.getElementById('error-bar')
  assert.equal(bar.hidden, true,
    'zero thrown error: a throw inside renderTable escapes paint()+applyGraph into loadGraph.catch and opens the error bar '
    + '(error-msg=' + JSON.stringify(doc.getElementById('error-msg').textContent) + ')')
  const box = doc.getElementById('table-fallback')
  const table = box.children.find((c) => c.tagName === 'TABLE')
  assert.ok(table, 'renderTable appended a <table> to #table-fallback')
  const thead = table.children.find((c) => c.tagName === 'THEAD')
  const tbody = table.children.find((c) => c.tagName === 'TBODY')
  assert.ok(thead && tbody, 'the table has BOTH a thead and a tbody (the header row is the ASI trap)')
  const headerRow = thead.children.find((c) => c.tagName === 'TR')
  assert.ok(headerRow, 'the thead carries its <tr>')
  assert.equal(headerRow.children.length, 5, 'thead row has exactly 5 <th> (group/name/version/scope/mountedBy)')
  assert.deepEqual(headerRow.children.map((th) => th.textContent),
    ['group', 'name', 'version', 'scope', 'mountedBy'], 'the five columns, in order')
  assert.deepEqual(thead.children.filter((c) => c.tagName === 'TR').length, 1, 'one header row')
  assert.equal(tbody.children.length, GRAPH.nodes.length,
    `tbody row count == node count (${GRAPH.nodes.length}) — a header-row throw leaves 0 rows behind`)
  // row = group | name | version | scope | mountedBy — every cell via escText
  assert.deepEqual(tbody.children.map((tr) => tr.children.map((td) => td.textContent).join('|')).sort(),
    [
      'bundle|@deepseek-ai/core|1.0.0|official|',
      'bundle|@deepseek-ai/util|1.0.0|official|web',
      'fs|db-driver|1.0.0|third-party|',
      'fs|fs-watcher|1.0.0|third-party|',
    ].sort(), 'the five columns carry the node data, one row per node')
  assert.ok(tbody.children.every((tr) => tr.children.length === 5), 'every body row has 5 cells too')
})

test('V2.6-fix I1 a table row click is EXPLICIT NAV: it selects and roots the path', () => {
  const tbody = doc.getElementById('table-fallback').children.find((c) => c.tagName === 'TABLE')
    .children.find((c) => c.tagName === 'TBODY')
  const row = tbody.children.find((tr) => tr.children.map((td) => td.textContent).includes('@deepseek-ai/core'))
  assert.ok(row, 'the @deepseek-ai/core row is in the table')
  assert.equal(S().focus, null, 'cold state before the click (R46: nothing has rooted a path yet)')
  fire(row, 'click')
  assert.equal(S().selected, 'r1@1', 'the row click selected its node')
  assert.ok(S().focus, '…and the table row passes nav=true, so path mode ENGAGED from the cold state')
  assert.equal(S().focus.rootId, 'r1@1', 'the row click roots the path at its own node')
  assert.equal(S().focus.depth, null, 'at the UNLIMITED default (this is also the I2 regression: no stale depth)')
})

test('V2.6-fix I1 re-painting the table stays clean (the fallback repaint on a lang switch too)', () => {
  const warnsBefore = WARNS.length
  doc.getElementById('lang-btn') && fire(doc.getElementById('lang-btn'), 'click') // applyI18n → renderTable again
  assert.equal(doc.getElementById('error-bar').hidden, true, 'no error bar after a fallback repaint')
  const table = doc.getElementById('table-fallback').children.find((c) => c.tagName === 'TABLE')
  assert.ok(table, 'exactly one table rebuilt')
  assert.equal(doc.getElementById('table-fallback').children.filter((c) => c.tagName === 'TABLE').length, 1,
    'the box is cleared before each rebuild (no stacking)')
  assert.ok(table.children.some((c) => c.tagName === 'TBODY') && table.children.find((c) => c.tagName === 'TBODY').children.length === GRAPH.nodes.length,
    'and it still carries one row per node')
  assert.equal(WARNS.length, warnsBefore, 'the fallback repaint warned nothing new')
})

console.warn = w0
