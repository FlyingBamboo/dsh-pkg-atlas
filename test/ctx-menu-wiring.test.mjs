/**
 * V2.5 C1 — the context-menu DOM-WIRING test (see task-V25-report.md §C1).
 *
 * The V2.5 menu suite in render-smoke.test.mjs is extraction-level: it extracts
 * bindCy/menu functions and pokes row.handlers.click() directly. That is blind to
 * the one thing a real browser enforces: #ctx-menu lives INSIDE #graph, and the
 * frozen cytoscape dist processes ANY DOM mouse event whose target chains to the
 * container (eventInContainer walks parentNodes — there is no canvas-only filter,
 * verified against web/vendor/cytoscape.min.js). A real press on a row therefore
 * leaked mousedown into cytoscape → core 'mousedown' → closeMenu()+swallow BEFORE
 * the click could land → the button was display:none at mouseup, DOM click
 * semantics retargeted the click to the container, and runMenuCommand never ran.
 *
 * This file boots the REAL web/app.js (one read-only tail exposure of `state`,
 * no function is stubbed or replaced) over the REAL vendored cytoscape with a
 * fake DOM whose dispatch bubbles target→ancestors→document→window and honours
 * stopPropagation. Gestures enter through DOM events, so cytoscape's own
 * hit-test and tap/cxttap synthesis run. The press helper models browser click
 * semantics honestly: a row press whose mousedown CLOSED the menu delivers the
 * mouseup+click to the CONTAINER (display:none cannot be hit-tested), exactly
 * like a real browser — the command only fires if the menu SURVIVES the press.
 *
 * Mutation-proof hook: ATLAS_WIRING_APP may point at a mutated app.js copy
 * (report §C1); default is the real web/app.js.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const WEB = join(HERE, '..', 'web')
const APP = process.env.ATLAS_WIRING_APP || join(WEB, 'app.js')

// ---------------- fake DOM (bubbling, stopPropagation, id registry) ----------------
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
    this._id = ''
    this.offsetWidth = 160
    this.offsetHeight = 120
    this.clientWidth = 800
    this.clientHeight = 600
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
  insertBefore(n, ref) {
    const i = this.children.indexOf(ref)
    if (i < 0) return this.appendChild(n)
    n.parentNode = this
    this.children.splice(i, 0, n)
    return n
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
  getBoundingClientRect() {
    return { left: 0, top: 0, right: this.clientWidth, bottom: this.clientHeight, width: this.clientWidth, height: this.clientHeight, x: 0, y: 0 }
  }
  blur() {}
  focus() {}
  getRootNode() { return this._doc || this }
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
  _matchOne(el, token) {
    const m = /^(?:#([\w-]+))?([a-zA-Z][\w-]*)?(?:\[([\w-]+)(?:=(['"])([^'"]*)\5)?\])?(?:\.([\w.-]+))?/.exec(token)
    if (!m) throw new Error('fake selector unsupported: ' + token)
    const [, id, tag, attr, , attrv, cls] = m
    if (id && el.id !== id) return false
    if (tag && el.tagName !== tag.toUpperCase()) return false
    if (attr && !(el.attrs && attr in el.attrs)) return false
    if (attr && attrv !== undefined && el.attrs[attr] !== attrv) return false
    if (cls && !el.classList.contains(cls)) return false
    return true
  }
  _walk(out) { for (const c of this.children) { out.push(c); if (c._walk) c._walk(out) } }
  _desc() { const out = []; this._walk(out); return out }
  querySelectorAll(sel) {
    const parts = String(sel).trim().split(/\s+/)
    if (parts.length === 1) return this._desc().filter((el) => this._matchOne(el, parts[0]))
    const root = (parts[0].startsWith('#') && this._doc && this._doc._ids.get(parts[0].slice(1))) || this
    return root._desc().filter((el) => this._matchOne(el, parts[1]))
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null }
}

class FDoc extends FEl {
  constructor() {
    super('document', null)
    this._ids = new Map()
    this.activeElement = null
    this.documentElement = new FEl('html', this)
    this.documentElement.ownerDocument = this
    this.appendChild(this.documentElement)
    this.head = new FEl('head', this)
    this.head.ownerDocument = this
    this.documentElement.appendChild(this.head)
    this.body = new FEl('body', this)
    this.body.ownerDocument = this
    this.documentElement.appendChild(this.body)
    this.defaultView = null
  }
  createElement(tag) {
    const el = new FEl(tag, this)
    el.ownerDocument = this
    if (String(tag).toLowerCase() === 'canvas') {
      const ctx = new Proxy({ __c: el }, {
        get(t, k) {
          if (k === 'canvas') return t.__c
          if (k === 'measureText') return () => ({ width: 0 })
          if (k === 'getImageData') return () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 })
          if (k === 'createLinearGradient' || k === 'createPattern') return () => ({ addColorStop() {} })
          if (k === 'isPointInPath' || k === 'isPointInStroke') return () => false
          if (typeof k === 'symbol') return undefined
          if (k in t) return t[k]
          return () => {}
        },
        set(t, k, v) { t[k] = v; return true },
      })
      el.getContext = () => ctx
      el.toDataURL = () => 'data:,'
      el.width = 800
      el.height = 600
    }
    return el
  }
  createTextNode(s) { return { text: String(s), parentNode: null, nodeType: 3 } }
  getElementById(id) { return this._ids.get(id) || null }
}

const doc = new FDoc()
const mk = (id, tag, parent) => {
  const el = doc.createElement(tag || 'div')
  el.id = id
  ;(parent || doc.body).appendChild(el)
  return el
}
const graphEl = mk('graph')
graphEl.clientWidth = 800
graphEl.clientHeight = 600
mk('legend')
mk('table-fallback')
mk('zone-chips')
mk('details')
mk('search', 'input').value = ''
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
const segG = mk('seg-groups', 'button', lod)
segG.setAttribute('data-seg', 'groups')
const segP = mk('seg-pkgs', 'button', lod)
segP.setAttribute('data-seg', 'packages')
const ek = mk('edge-kinds')
for (const k of ['dep', 'mount', 'peer', 'peer-optional']) {
  const cb = mk('ek-' + k, 'input', ek)
  cb.setAttribute('data-kind', k)
  cb.checked = true
}

const W = new FEl('window', null)
W.document = doc
doc.defaultView = W
W.navigator = { language: 'zh-CN', userAgent: 'Mozilla/5.0 (wiring-harness)' }
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
W.getComputedStyle = () => ({
  backgroundColor: 'rgb(247, 248, 250)',
  position: 'relative',
  getPropertyValue: (k) => (k === 'position' ? 'relative' : k === 'background-color' ? 'rgb(247, 248, 250)' : '0px'),
})
W.location = { hash: '' }

globalThis.window = W
globalThis.document = doc
try { Object.defineProperty(globalThis, 'navigator', { value: W.navigator, configurable: true, writable: true }) } catch {}
try { Object.defineProperty(globalThis, 'location', { value: W.location, configurable: true, writable: true }) } catch {}
globalThis.getComputedStyle = W.getComputedStyle
globalThis.requestAnimationFrame = W.requestAnimationFrame
globalThis.cancelAnimationFrame = W.cancelAnimationFrame
globalThis.self = W

// ---------------- dispatch (bubble: target → ancestors → document → window) ----------------
function fire(target, type, props) {
  const ev = Object.assign({
    type,
    target,
    bubbles: true,
    preventDefault() {},
    stopPropagation() { this.__stop = true },
    which: 1, button: 0, clientX: 0, clientY: 0, deltaY: 0, deltaMode: 0,
    timeStamp: Date.now(), shiftKey: false, ctrlKey: false, altKey: false, metaKey: false,
  }, props || {})
  const chain = []
  let n = target
  while (n) { chain.push(n); n = n.parentNode }
  if (chain[chain.length - 1] !== doc) chain.push(doc)
  if (chain[chain.length - 1] !== W) chain.push(W)
  for (const node of chain) {
    for (const fn of (node._listeners[type] || []).slice()) fn(ev)
    if (ev.__stop) break
  }
  return ev
}

// ---------------- fixture graph ----------------
const n = (id, name, group, category) => ({
  id, kind: 'package', name, version: '1.0.0', scope: 'official', group, category,
  path: '$DSH_HOME/x', description: null, servicesRequired: [], externalDeps: [],
  mountedBy: [], flags: { unreadable: false },
})
const GRAPH = {
  schema: 1, generatedAt: 'wiring', dshHome: '$DSH_HOME', warnings: [],
  categories: [{ id: 'kernel', zh: '内核', en: 'Kernel' }, { id: 'tools', zh: '工具', en: 'Tools' }],
  profiles: [],
  groups: [
    { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 2 },
    { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
    { id: 'db', kind: 'official', category: 'tools', packageCount: 1 },
  ],
  nodes: [n('r1@1', 'r1', 'bundle', 'kernel'), n('r2@1', 'r2', 'bundle', 'kernel'),
    n('x@1', 'x', 'fs', 'tools'), n('d1@1', 'd1', 'db', 'tools')],
  edges: [
    { from: 'r1@1', to: 'x@1', kind: 'dep' },
    { from: 'd1@1', to: 'r1@1', kind: 'dep' },
    { from: 'x@1', to: 'd1@1', kind: 'peer' },
  ],
}
globalThis.fetch = (url) => {
  const u = String(url)
  if (u.endsWith('/api/status')) return Promise.resolve({ ok: true, json: async () => ({ state: 'ready', phase: 'done' }) })
  if (u.includes('/api/readme')) return Promise.resolve({ ok: true, text: async () => 'readme' })
  return Promise.resolve({ ok: true, json: async () => JSON.parse(JSON.stringify(GRAPH)) })
}

// ---------------- real vendored cytoscape + real model + real app ----------------
const cyMod = { exports: {} }
new Function('module', 'exports', readFileSync(join(WEB, 'vendor', 'cytoscape.min.js'), 'utf8'))(cyMod, cyMod.exports)
if (typeof cyMod.exports !== 'function') throw new Error('vendored cytoscape failed to load')
W.cytoscape = (opts) => cyMod.exports(opts)

new Function(readFileSync(join(WEB, 'graph-model.js'), 'utf8'))()
W.AtlasModel = globalThis.AtlasModel

let appSrc = readFileSync(APP, 'utf8')
const tail = '  boot()\n})()'
if (!appSrc.endsWith(tail + '\n') && !appSrc.endsWith(tail)) throw new Error('app.js tail anchor moved: ' + APP)
appSrc = appSrc.slice(0, appSrc.length - tail.length)
  + '  boot()\n  window.__w = { state: state }\n})()\n' // read-only exposure — no function is stubbed
new Function(appSrc)()

const WARNS = []
const w0 = console.warn
console.warn = (...a) => { WARNS.push(a.map((x) => (x && x.stack ? x.stack : String(x))).join(' ')) }
const REJECTIONS = []
process.on('unhandledRejection', (e) => REJECTIONS.push(String(e && e.stack ? e.stack : e)))

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const S = () => W.__w.state
async function ready() {
  for (let i = 0; i < 200; i++) {
    if (S() && S().cy && S().fitted) return
    await sleep(25)
  }
  throw new Error('app never booted: tableMode=' + (S() && S().tableMode) + ' warns=' + WARNS.slice(0, 3).join(' // '))
}
await ready()
const CORE_DOWN = { n: 0 }
S().cy.on('mousedown', () => { CORE_DOWN.n++ }) // observation only
// V2.6 (R46): the camera audit — EVERY cy.animate flows through here. Wrapping
// the real animate (never replacing it) is observation-only, same pattern as
// CORE_DOWN above; the matrix tests count what each gesture does to the camera.
const ANIMS = []
const CY_ANIMATE = S().cy.animate.bind(S().cy)
S().cy.animate = function (opts) { ANIMS.push(opts); return CY_ANIMATE(opts) }

// ---------------- gesture helpers (all DOM-level) ----------------
const canvas = graphEl._desc().find((c) => c.getContext) || graphEl
const menuEl = () => doc.getElementById('ctx-menu')
const rows = () => (menuEl() ? menuEl().children.slice(1) : [])
const rp = (id) => {
  const el = S().cy.getElementById(id)
  if (!el.length) return null
  const bb = el.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
  return { x: Math.round((bb.x1 + bb.x2) / 2), y: Math.round((bb.y1 + bb.y2) / 2) }
}
const leftAt = (x, y) => { fire(canvas, 'mousedown', { clientX: x, clientY: y, which: 1, button: 0 }); fire(canvas, 'mouseup', { clientX: x, clientY: y, which: 1, button: 0 }) }
const rightAt = (x, y) => { fire(canvas, 'mousedown', { clientX: x, clientY: y, which: 3, button: 2 }); fire(canvas, 'mouseup', { clientX: x, clientY: y, which: 3, button: 2 }) }

/**
 * A real press on a menu row. The browser delivers mousedown to the button, then
 * (in a separate hit test) mouseup and the synthesized click — and an element
 * hidden by display:none cannot be hit-tested. So: if the press itself closed
 * the menu, the mouseup+click land on the CONTAINER under it, NOT the button.
 * Returns what the press did to the menu BEFORE the completing events.
 */
function pressRow(row, pos) {
  fire(row, 'mousemove', pos)
  fire(row, 'mousedown', Object.assign({ which: 1, button: 0 }, pos))
  const openAfterDown = !menuEl().hidden
  const down = openAfterDown ? row : canvas
  fire(down, 'mouseup', Object.assign({ which: 1, button: 0 }, pos))
  fire(down, 'click', Object.assign({}, pos))
  return openAfterDown
}

test('wiring boot: real app + real cytoscape, menu div lands inside #graph', async () => {
  assert.ok(S().cy, 'cytoscape booted (no table fallback)', 'tableMode=' + S().tableMode)
  assert.equal(S().tableMode, false, 'no table fallback — WARNS: ' + WARNS.slice(0, 2).join(' // '))
  const g = rp('g:bundle')
  assert.ok(g, 'g:bundle is rendered')
  rightAt(g.x, g.y)
  await sleep(60)
  assert.ok(menuEl(), 'cxttap created the menu div')
  assert.equal(menuEl().hidden, false, 'cxttap opened it')
  assert.equal(menuEl().parentNode, graphEl, 'the menu lives INSIDE the cytoscape container (the hazard)')
  assert.equal(rows().length, 3, 'collapsed group rows: 展开 / 聚焦邻域 / 只看该区')
})

test('C1(a)/(d): a real bubbling press on a row never reaches cytoscape — menu survives the press, no grab, no core mousedown', async () => {
  const g = rp('g:bundle')
  rightAt(g.x, g.y)
  await sleep(60)
  assert.equal(menuEl().hidden, false, 'menu open before the press')
  const down0 = CORE_DOWN.n
  const pos = { clientX: g.x, clientY: g.y }
  const row = rows()[0]
  fire(row, 'mousemove', pos)
  fire(row, 'mousedown', Object.assign({ which: 1, button: 0 }, pos))
  // Observe all three leak signals BEFORE asserting — a leaky run reports them
  // together (mutation proof, report §C1).
  const hiddenAfterDown = menuEl().hidden
  const leaks = CORE_DOWN.n - down0
  const grabbed = S().cy.$(':active').length
  if (process.env.ATLAS_WIRING_DIAG) console.log('OBS row-press: hiddenAfterDown=' + hiddenAfterDown + ' coreMousedownLeaks=' + leaks + ' grabbed=' + grabbed)
  fire(row, 'mouseup', Object.assign({ which: 1, button: 0 }, pos))
  const hiddenAfterUp = menuEl().hidden
  assert.equal(hiddenAfterDown, false, 'menu survived the mousedown — the press must not close it (close-on-press is the bug)')
  assert.equal(leaks, 0, 'cytoscape never saw a mousedown: the menu-root stopper keeps container listeners deaf (core mousedown leaks=' + leaks + ')')
  assert.equal(grabbed, 0, 'no node grabbed under the menu — a press on a row cannot arm node-grab (grabbed=' + grabbed + ')')
  assert.equal(hiddenAfterUp, false, 'menu STILL OPEN right after mouseup (the press never disarmed it)')
  assert.equal(CORE_DOWN.n - down0, 0, 'still no core mousedown after mouseup')
})

test('C1(b): the click reaches the row handler and its terminal effect runs, then the menu is closed', async () => {
  const g = rp('g:bundle')
  rightAt(g.x, g.y)
  await sleep(60)
  const row = rows()[0] // 展开 (toggle-group → toggleGroup → paint)
  assert.equal(row.disabled, false, 'row enabled')
  const openAfterDown = pressRow(row, { clientX: g.x, clientY: g.y })
  await sleep(60)
  assert.ok(openAfterDown, 'the press did not close the menu (the command was reachable at all)')
  const cg = S().view.collapsedGroups
  assert.ok(cg && !cg.has('bundle'), '展开 RAN: collapsedGroups opened the bundle (' + JSON.stringify(cg && [...cg]) + ')')
  assert.equal(S().cy.getElementById('r1@1').length, 1, 'REPAINT happened through the real paint(): member r1@1 now renders')
  assert.equal(menuEl().hidden, true, 'the menu closed within the command dispatch, after the effect')
  // V2.6 MIGRATION (R46): this asserted the RETIRED cold-tap-enters-focus door.
  // The pin here is the SWALLOW lifecycle — the next tap must behave NORMALLY,
  // and "normal" now means the lightweight R46 tap: selection, zero focus.
  const r = rp('r1@1')
  leftAt(r.x, r.y)
  await sleep(350)
  assert.equal(S().selected, 'r1@1', 'no stale swallow: the next tap selected normally')
  assert.equal(S().focus, null, '…and stayed lightweight (R46: the cold tap roots nothing)')
  leftAt(6, 6) // back to plain view for the next test
  await sleep(350)
})

test('C1(b2): the same wiring drives the FOCUS command — real focus change + repaint', async () => {
  const g = rp('g:bundle')
  rightAt(g.x, g.y)
  await sleep(60)
  const row = rows()[1] // 聚焦邻域（1 跳） → focusTransition + afterFocusChange
  const openAfterDown = pressRow(row, { clientX: g.x, clientY: g.y })
  await sleep(350)
  assert.ok(openAfterDown, 'the press did not close the menu')
  assert.ok(S().focus && S().focus.rootId === 'g:bundle' && S().focus.depth === 1,
    '聚焦邻域 RAN: state.focus is the 1-hop group shape (' + JSON.stringify(S().focus) + ')')
  assert.equal(S().cy.getElementById('g:fs').length, 1, 'repaint flipped the render: neighbor g:fs is on screen')
  assert.equal(menuEl().hidden, true, 'menu closed after the command')
  leftAt(6, 6) // exit focus
  await sleep(350)
  assert.equal(S().focus, null, 'focus exited by the blank tap (lifecycle intact)')
})

test('C1(c): menu-EXTERNAL lifecycle unchanged — a bubbling container press still closes + arms the swallow', async () => {
  const g0 = rp('g:bundle')
  leftAt(g0.x, g0.y) // select g:bundle first: the swallowed tap must not clear it
  await sleep(60)
  assert.equal(S().selected, 'g:bundle', 'selection established')
  const g = rp('g:bundle')
  rightAt(g.x, g.y)
  await sleep(60)
  assert.equal(menuEl().hidden, false, 'menu open')
  // A press OUTSIDE the menu, ON the container surface (the canvas it owns — the
  // only surface a real press can hit): bubbles to cytoscape's container binding.
  fire(canvas, 'mousedown', { clientX: 770, clientY: 570, which: 1, button: 0 })
  assert.equal(menuEl().hidden, true, 'the container press still closes (shipped rule, untouched)')
  fire(canvas, 'mouseup', { clientX: 770, clientY: 570, which: 1, button: 0 })
  await sleep(60)
  assert.equal(S().selected, 'g:bundle', 'the completing tap was SWALLOWED — closes, does not select')
  const f = rp('g:fs')
  leftAt(f.x, f.y) // and the NEXT tap is normal again
  await sleep(60)
  assert.equal(S().selected, 'g:fs', 'no stale swallow after the container-press dismissal')
})

// =========================================================================
// V2.6 R46 — the SEMANTIC MATRIX, wired. Cold left-click is lightweight for
// BOTH node kinds (the v2.1 auto-highlight door is retired for real); path
// mode enters through the explicit doors only. Gestures run through the real
// registered handlers on the real vendored cytoscape; camera ops are counted
// on the wrapped cy.animate (observation only).
// =========================================================================

const jumpRows = () => {
  const det = doc.getElementById('details')
  return det._desc().filter((el) => el.className === 'jump')
}
const waitFocus = async (pred, ms = 200) => {
  for (let i = 0; i < ms / 25; i++) {
    if (pred()) return true
    await sleep(25)
  }
  return false
}

test('R46 matrix 1: COLD package tap = select + details, ZERO focus, ZERO camera ops', async () => {
  assert.equal(S().focus, null, 'cold start (previous tests left the plain view)')
  const anims0 = ANIMS.length
  const r = rp('r1@1')
  assert.ok(r, 'r1@1 renders (its group was expanded by the C1(b) toggle command)')
  leftAt(r.x, r.y)
  await sleep(120)
  assert.equal(S().selected, 'r1@1', 'the tap selected the package')
  assert.equal(S().focus, null, 'R46: the cold tap roots NOTHING')
  assert.deepEqual(S().pathStack, [], 'no walk stack was started')
  assert.equal(ANIMS.length - anims0, 0, 'the tap moved the camera ZERO times — no fit, no glide, no flash')
  const det = doc.getElementById('details')
  assert.ok(!det.hidden && det.children.length > 0, 'the details panel opened through the real renderDetails chain')
})

test('R46 matrix 2: menu 路径模式 enters from the cold state (+fit glide); INSIDE the focus a package tap re-roots AND pushes the stack', async () => {
  // The depth slider is a genuine user control — the C1(b2) group focus wrote
  // '1' through syncFocusCtl (V2.2b mapping). Flip it back to 不限 exactly the
  // way the user would: control state, not a stubbed function.
  doc.getElementById('focus-depth').value = '0'
  const anims0 = ANIMS.length
  const p = rp('r1@1')
  rightAt(p.x, p.y)
  await sleep(60)
  assert.deepEqual(rows().map((b) => b.text), ['路径模式'], 'package menu = the one command')
  pressRow(rows()[0], { clientX: p.x, clientY: p.y })
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'r1@1', depth: null }, 'the menu command ENTERS path mode from the cold state')
  assert.equal(ANIMS.length - anims0, 1, 'entry glides exactly once')
  assert.equal(ANIMS[ANIMS.length - 1].fit.padding, 40, '…as the animateFitPath fit (padding 40), not a snapshot glide')
  assert.deepEqual(S().pathStack, [], 'entry starts a fresh stack')
  // INSIDE the live focus, a package tap still WALKS (the R46 rule only closed the COLD door)
  const walkAnims = ANIMS.length
  const d = rp('d1@1')
  assert.ok(d, 'd1@1 renders inside the r1@1 focus (its dependent — collapse dims cannot hide a path member)')
  leftAt(d.x, d.y)
  await sleep(350)
  assert.equal(S().focus && S().focus.rootId, 'd1@1', 'in-focus tap RE-ROOTS on the tapped package')
  assert.deepEqual(S().pathStack, ['r1@1'], '…and PUSHES the previous root onto the stack')
  assert.equal(ANIMS.length - walkAnims, 1, 'the walk glides once (entry snapshot NOT re-taken)')
  assert.deepEqual(S().viewport, { zoom: S().viewport.zoom, pan: S().viewport.pan }, 'walk keeps the entry snapshot armed for the exit')
  // leave the way every path ends: the blank tap + its one-shot restore glide
  const exitAnims = ANIMS.length
  leftAt(6, 6)
  await sleep(350)
  assert.equal(S().focus, null, 'blank tap exits the focus')
  assert.equal(ANIMS.length - exitAnims, 1, 'the exit spends the armed snapshot: exactly one restore glide')
  assert.equal(ANIMS[ANIMS.length - 1].fit, undefined, '…a zoom/pan restore, not a fit')
})

test('R46 matrix 3: a details path-row click from the cold state ENTERS path mode (explicit navigation)', async () => {
  doc.getElementById('focus-depth').value = '0' // same control-state note as matrix 2
  const anims0 = ANIMS.length
  const r = rp('r1@1')
  leftAt(r.x, r.y)
  await sleep(120)
  assert.equal(S().focus, null, 'the tap that opened the details stayed lightweight')
  const row = jumpRows().find((b) => b.children[0] && b.children[0].text.startsWith('d1'))
  assert.ok(row, 'the real renderDetails painted the path lists — a d1@1 row exists in #details')
  fire(row, 'click')
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'd1@1', depth: null }, 'the row click ROOTED path mode from the cold state (nav=true)')
  assert.deepEqual(S().pathStack, [], 'an entry, not a walk')
  assert.equal(ANIMS.length - anims0, 1, 'exactly the entry glide — nothing extra')
  leftAt(6, 6) // back to the plain view
  await sleep(350)
  assert.equal(S().focus, null, 'exit intact after the row-driven entry')
})

test('R46 matrix 4: the #node= deep link still focuses from the cold state (retry re-runs the real boot path)', async () => {
  W.location.hash = '#node=x@1'
  const retry = doc.getElementById('retry')
  fire(retry, 'click') // the real loadGraph(false, false) → applyGraph boot branch
  const ok = await waitFocus(() => S().focus && S().focus.rootId === 'x@1')
  await sleep(350)
  W.location.hash = ''
  assert.ok(ok, 'the deep link focused through the untouched focusNode path')
  assert.deepEqual(S().focus, { rootId: 'x@1', depth: null }, '…at UNLIMITED depth, the R35 default')
  assert.equal(S().selected, 'x@1', 'and it selected the anchored node')
})

test('R46 matrix 5: the cold GROUP tap stays lightweight (R44 doctrine, untouched by R46)', async () => {
  const exitAnims = ANIMS.length
  leftAt(6, 6) // the deep-link focus is live: end it the standard way
  await waitFocus(() => S().focus === null, 600)
  await sleep(350) // let the restore glide settle before counting
  assert.equal(S().focus, null, 'back to the cold state (boot path re-defaulted: all groups collapsed)')
  void exitAnims
  const anims0 = ANIMS.length
  const g = rp('g:bundle')
  assert.ok(g, 'the group card renders in the plain view')
  leftAt(g.x, g.y)
  await sleep(120)
  assert.equal(S().selected, 'g:bundle', 'the card is the selection (details panel rides it)')
  assert.equal(S().focus, null, 'a cold group tap roots NOTHING (R44, re-pinned under R46)')
  assert.equal(ANIMS.length - anims0, 0, 'zero camera ops')
})

test('C1 hygiene: no unhandled rejections, boot warnings clean', () => {
  console.warn = w0
  assert.deepEqual(REJECTIONS, [], 'no unhandled rejections')
  assert.equal(WARNS.filter((w) => /invalid|Error|failed/i.test(w)).length, 0, 'clean boot: ' + WARNS.slice(0, 3).join(' // '))
})

// The cytoscape renderer keeps timer/rAF machinery alive after the last event —
// without a full destroy(), the runner process would never go idle.
import { after } from 'node:test'
after(() => {
  if (process.env.ATLAS_WIRING_DIAG) console.log('ACTIVE=' + JSON.stringify(process.getActiveResourcesInfo()))
  try { if (S() && S().cy) S().cy.destroy() } catch (e) { /* already down */ }
  if (process.env.ATLAS_WIRING_DIAG) console.log('ACTIVE2=' + JSON.stringify(process.getActiveResourcesInfo()))
})
