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
mk('arrange-view', 'button')
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
    { id: 'bundle', kind: 'official', category: 'kernel', packageCount: 13 },
    { id: 'fs', kind: 'official', category: 'tools', packageCount: 1 },
    { id: 'db', kind: 'official', category: 'tools', packageCount: 1 },
  ],
  nodes: [n('r1@1', 'r1', 'bundle', 'kernel'), n('r2@1', 'r2', 'bundle', 'kernel'),
    n('x@1', 'x', 'fs', 'tools'), n('d1@1', 'd1', 'db', 'tools'),
    // v27-fix: bundle (kernel zone) grows to 13 members so the zone details'
    // GROUP section exceeds ZONE_GROUP_CAP=10 and MUST print its 还有 N tail —
    // the cap-row structure test needs a real capped section. The additions
    // carry NO edges (path lists, focus sets, every existing assertion keep
    // their fixtures), and the group stays collapsed by default, so the
    // render sets the untouched matrices assert on are untouched.
    ...['b3', 'b4', 'b5', 'b6', 'b7', 'b8', 'b9', 'b10', 'b11', 'b12', 'b13']
      .map((nm) => n(nm + '@1', nm, 'bundle', 'kernel'))],
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
 * V2.8 R53/R54: details labels are COMPOSED out of spans (name / .cnt / .ver)
 * now — this is the scalar read-out: own text + descendants, concatenated.
 * (Scalar-only doctrine: never a node list into assert.)
 */
const elText = (el) => (el.text || '') + (el.children || []).map(elText).join('')
/** A point on the ZONE SHELL's own surface: just inside its top edge, inside
 *  the label strip + ZONE_PAD(28) band the model reserves above the first card
 *  (graph-model.js ZONE_PAD; labels are never hit-tested in cytoscape). */
const zonePt = (id) => {
  const el = S().cy.getElementById(id)
  if (!el.length) throw new Error('zonePt: ' + id + ' is not rendered')
  const bb = el.renderedBoundingBox({ includeLabels: false, includeOverlays: false })
  return { x: Math.round((bb.x1 + bb.x2) / 2), y: Math.round(bb.y1 + 4) }
}
/**
 * 时间钉（deflake，V28+）：把 Date.now() 冻成一个常量跑完 fn，finally 立刻还原。
 *
 * 为什么钉 Date.now 是对症的机制：双击门有两把时钟，它们读的是同一个 Date.now()。
 *   · 冻结的 dist 用 `evt.timeStamp` 合成 dbltap（cytoscape.min.js IDX ~294099：
 *     `t.timeStamp - w <= multiClickDebounceTime()`，250ms），而本 harness 的
 *     timeStamp 就是 fire() 里的 `timeStamp: Date.now()`（见上方 fire()）；
 *   · app 的刻意对门 noteTap() 读的也是 Date.now()（web/app.js，DBL_TAP_WINDOW_MS=300）。
 * dblAt 在两次按压之间还要重算一次 renderedBoundingBox（首按会重绘），满载机器上
 * 这一段的墙钟差能超过 300ms：一对真双击既不被 dist 合成、也不被门判为刻意对。
 * 实测（8 逻辑核 + 24 个 CPU 忙等进程 ≈3x 超订阅）`v27-fix 2 case C` 5 次红 2 次，
 * actual focus=null——门根本没被敲到。BASE 与 HEAD 同红 ⇒ 环境噪声，非发货代码缺陷。
 *
 * 钉住的是 harness 的墙钟读数，不是门的逻辑：dist 的 250ms 与门的 300ms 两个阈值
 * 一字未改，只是把"同一 tick 内的两次按压"变成确定量（真实浏览器里一次双击的两下
 * 本来就必须落在同一个 250ms 窗口内）。能不能成对仍由门的语义决定：同 id + 两次都是
 * 真按压。跨目标对（id 不等）与含吞按对（sw 标记）照旧被拒——而且钉住后 dist 必定
 * 合成 dbltap、门必定被敲到，负例不再可能因"机器太慢没合成出 dbltap"而假绿。
 *
 * 约束：fn 必须同步——钉内不许有 await，否则整个进程的墙钟源都被冻住。vendor 在本
 * harness 下的动画时钟只在 rAF/setTimeout 回调里取时间，回调必然跑在还原之后；
 * cytoscape.min.js 里 4 处 Date.now 分别是 lodash now / 合成事件 timeStamp /
 * 图片背景时间戳，没有一处同步忙等依赖它推进。
 */
const pinned = (fn) => {
  const realNow = Date.now
  const t0 = realNow.call(Date)
  Date.now = () => t0
  try { return fn() } finally { Date.now = realNow }
}

/**
 * V2.7 R49: TWO DOM presses with NO sleep between them. The frozen dist fires
 * dbltap on the target hit-tested at the SECOND mouseup when it lands inside
 * multiClickDebounceTime (verified at cytoscape.min.js IDX ~294099). Positions
 * are re-derived between the presses: the first tap repaints, and a repaint
 * can shift a node when its render set changed underneath.
 * V28+ deflake: the whole press pair runs inside the time pin above, so the
 * same-tick fact the gesture physically encodes is deterministic on a loaded box.
 */
const dblAt = (id) => {
  const a = rp(id)
  if (!a) throw new Error('dblAt: ' + id + ' is not rendered')
  pinned(() => {
    leftAt(a.x, a.y)
    const b = rp(id) || a
    leftAt(b.x, b.y)
  })
}

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
  await sleep(300) // V2.7 R49: cytoscape fires dbltap when ANY mouseup lands within 250ms of the
  // last one (verified in the frozen dist: the debounce is not target-pinned). Settle out of
  // the previous test's canvas click so this gesture is unambiguously ONE tap.
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

test('R46+R50 matrix 2: menu 依赖图 enters from the cold state with ZERO camera ops; INSIDE the focus a package tap re-roots AND pushes the stack', async () => {
  // The depth slider is a genuine user control — the C1(b2) group focus wrote
  // '1' through syncFocusCtl (V2.2b mapping). Flip it back to 不限 exactly the
  // way the user would: control state, not a stubbed function.
  doc.getElementById('focus-depth').value = '0'
  const anims0 = ANIMS.length
  const p = rp('r1@1')
  rightAt(p.x, p.y)
  await sleep(60)
  assert.deepEqual(rows().map((b) => b.text), ['依赖图'], 'package menu = the one command (V2.7 R48 name)')
  pressRow(rows()[0], { clientX: p.x, clientY: p.y })
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'r1@1', depth: null }, 'the menu command ENTERS the dependency graph from the cold state')
  assert.equal(ANIMS.length - anims0, 0, 'V2.7 R50: the entry glides NOTHING — zero camera ops')
  assert.deepEqual(S().pathStack, [], 'entry starts a fresh stack')
  // INSIDE the live focus, a package tap still WALKS (the R46 rule only closed the COLD door)
  const walkAnims = ANIMS.length
  const d = rp('d1@1')
  assert.ok(d, 'd1@1 renders inside the r1@1 focus (its dependent — collapse dims cannot hide a path member)')
  leftAt(d.x, d.y)
  await sleep(350)
  assert.equal(S().focus && S().focus.rootId, 'd1@1', 'in-focus tap RE-ROOTS on the tapped package')
  assert.deepEqual(S().pathStack, ['r1@1'], '…and PUSHES the previous root onto the stack')
  assert.equal(ANIMS.length - walkAnims, 0, 'the walk is camera-free (R50)')
  assert.equal(S().viewport, undefined, 'R50: the viewport-snapshot FIELD is deleted — nothing is left to arm')
  // leave the way every path ends: the blank tap — and NO restore glide follows it (R50)
  const exitAnims = ANIMS.length
  leftAt(6, 6)
  await sleep(350)
  assert.equal(S().focus, null, 'blank tap exits the focus')
  assert.equal(ANIMS.length - exitAnims, 0, 'the exit restores NOTHING — the snapshot glide is retired (R50)')
})

test('R46+R50 matrix 3: a details path-row click from the cold state ENTERS the dependency graph (explicit navigation, zero camera)', async () => {
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
  assert.deepEqual(S().focus, { rootId: 'd1@1', depth: null }, 'the row click ROOTED the dependency graph from the cold state (nav=true)')
  assert.deepEqual(S().pathStack, [], 'an entry, not a walk')
  assert.equal(ANIMS.length - anims0, 0, 'zero camera ops — the row-driven entry glides nothing (R50)')
  leftAt(6, 6) // back to the plain view
  await sleep(350)
  assert.equal(S().focus, null, 'exit intact after the row-driven entry')
})

test('R46 matrix 4: the #node= deep link still focuses from the cold state (retry re-runs the real boot path)', async () => {
  W.location.hash = '#node=x@1'
  const anims0 = ANIMS.length
  const retry = doc.getElementById('retry')
  fire(retry, 'click') // the real loadGraph(false, false) → applyGraph boot branch
  const ok = await waitFocus(() => S().focus && S().focus.rootId === 'x@1')
  await sleep(350)
  W.location.hash = ''
  assert.ok(ok, 'the deep link focused through the untouched focusNode path')
  assert.deepEqual(S().focus, { rootId: 'x@1', depth: null }, '…at UNLIMITED depth, the R35 default')
  assert.equal(S().selected, 'x@1', 'and it selected the anchored node')
  assert.equal(ANIMS.length - anims0, 0, 'V2.7 R50: the deep-link re-root fired ZERO camera ops (the focusNode glide is retired)')
})

test('R46 matrix 5: the cold GROUP tap stays lightweight (R44 doctrine, untouched by R46)', async () => {
  const exitAnims = ANIMS.length
  leftAt(6, 6) // the deep-link focus is live: end it the standard way
  await waitFocus(() => S().focus === null, 600)
  await sleep(350) // let the exit repaint settle before counting (R50: there is no restore glide)
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

// =========================================================================
// V2.7 R49/R50/R51 — the DOUBLE-TAP door, the zero-camera transitions and the
// leveled details panel, all through the REAL registered handlers over the
// REAL vendored cytoscape. (The R51 source/CSS/i18n guards live in
// render-smoke.test.mjs; here the panel is asserted through its real DOM.)
// =========================================================================

test('R49+R50 matrix: dbl-tapping a package ENTERS the dependency graph with ZERO camera ops; a lit package dbl-walks; the group-card dbl gesture stays a toggle', async () => {
  await sleep(300) // settle out of matrix 5's canvas click (dbl debounce, see matrix 1)
  // Normalize through the SAME real ⌫-retry boot matrix 4 uses: freshView
  // re-defaults the base view (collapsedGroups null = ALL collapsed). Matrix 4's
  // #node= deep link had legitimately EXPANDED every path group — focusNode's
  // expandPath walk over the path sets, shipped V2.6 behavior.
  fire(doc.getElementById('retry'), 'click')
  await sleep(250)
  assert.equal(S().focus, null, 'cold start after the real boot')
  assert.equal(S().view.collapsedGroups, null, 'freshView re-defaulted: collapsedGroups null (ALL collapsed)')
  assert.ok(!rp('d1@1'), 'db collapsed → d1@1 is not in the render set yet')
  // open the db group through the REAL menu expand command (state moves ONLY
  // through registered handlers — no state pokes in this matrix)
  const g = rp('g:db')
  assert.ok(g, 'the db group card renders in the plain view')
  rightAt(g.x, g.y)
  await sleep(60)
  const expand = rows().find((b) => b.text === '展开')
  assert.ok(expand, 'the cold collapsed group card offers 展开')
  pressRow(expand, { clientX: g.x, clientY: g.y })
  await sleep(150)
  assert.equal(S().focus, null, 'a menu toggle carries no focus')
  // --- DOUBLE-TAP d1@1: the V2.7 R49 entry door (two mouseups, same ms → the
  // REAL cytoscape dbltap synthesis on the SAME target) ---
  const anims0 = ANIMS.length
  assert.ok(rp('d1@1'), 'd1@1 renders after the expand (the db card became a container)')
  dblAt('d1@1')
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'd1@1', depth: null }, 'the dbl-tap ENTERED the dependency graph (the menu\'s nav funnel, not a second implementation)')
  assert.equal(S().selected, 'd1@1', 'the two taps selected it on the way')
  assert.deepEqual(S().pathStack, [], 'entry starts a fresh walk stack')
  assert.equal(ANIMS.length - anims0, 0, 'R50: the dbl-tap door fires ZERO camera ops')
  assert.equal(S().viewport, undefined, 'R50: the viewport-snapshot field no longer exists on state')
  // --- dbl-tap a LIT path package = the documented WALK/re-root, camera-free ---
  const walkAnims = ANIMS.length
  assert.ok(rp('r1@1'), 'r1@1 is a lit path member of the d1@1 focus (d1 depends on it)')
  dblAt('r1@1')
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'r1@1', depth: null }, 'the lit-package dbl-tap re-rooted (walk semantics unchanged; the dbl door is the SAME selectNode nav funnel)')
  assert.deepEqual(S().pathStack, ['d1@1'], '…pushing the previous root (the first tap walked; the dbltap leg is idempotent on the same root)')
  assert.equal(ANIMS.length - walkAnims, 0, 'the walk stays camera-free')
  // --- exit: still zero ---
  const exitAnims = ANIMS.length
  leftAt(6, 6)
  await sleep(350)
  assert.equal(S().focus, null, 'the blank tap exits')
  assert.equal(ANIMS.length - exitAnims, 0, 'the exit glides nothing back (R50)')
  // --- control: the GROUP card keeps its OWN dbl gesture (V2.4b toggle) — the
  // package door did NOT leak onto cards ---
  assert.ok(rp('g:fs'), 'the fs CARD renders (bundle and fs are still collapsed; only db was opened by the menu)')
  dblAt('g:fs')
  await sleep(350)
  assert.equal(S().focus, null, 'a group-card dbl-tap roots NOTHING')
  assert.equal(S().selected, 'g:fs', 'the taps selected the card')
  const cg = S().view.collapsedGroups
  assert.ok(cg && cg.has('bundle') && !cg.has('fs'), '…and the dbl-tap EXPANDED the fs card (the V2.4b collapse gesture is intact: db expanded by the menu, fs by the dbl-tap, bundle still collapsed)')
})

test('R51 leveled details wiring: package panel levels with its 包 chip, the zone panel lists BY GROUP, the header door carries no nav', async () => {
  await sleep(300) // single-tap guarantee (see matrix 1 note)
  const p = rp('x@1')
  assert.ok(p, 'x@1 renders (the fs group is expanded by the matrix above)')
  leftAt(p.x, p.y)
  await sleep(120)
  const det = doc.getElementById('details')
  assert.ok(String(det.className).split(' ').includes('lvl-pkg'), 'the package container carries lvl-pkg (the CSS accent source)')
  const h2 = det.children.find((c) => c.tagName === 'H2')
  assert.ok(h2, 'the panel opens with the h2')
  assert.ok(h2.children[0] && h2.children[0].className === 'lvl' && h2.children[0].text === '包', 'the header chip names the level (zh UI, escText-only)')
  const crumb = det._desc().find((el) => el.className === 'crumb' && el.text === '工具')
  assert.ok(crumb, 'the zone crumb rides the package breadcrumb (x@1 lives in 工具)')
  fire(crumb, 'click')
  await sleep(120)
  assert.equal(S().focus, null, 'the zone crumb is a NAV-free door (it always was)')
  assert.equal(S().selected, 'cat:tools', '…it selects the zone')
  assert.equal(det.getAttribute('data-zone'), 'tools', 'the zone band keys off data-zone (a palette id, never free text)')
  assert.ok(String(det.className).split(' ').includes('lvl-zone'), 'the zone container carries lvl-zone')
  const heads = det._desc().filter((el) => String(el.className).split(' ').includes('ghead'))
  // V2.8 R54: every fixture member is version 1.0.0 → each section hoists it
  assert.deepEqual(heads.map(elText), ['db ×1 · 1.0.0', 'fs ×1 · 1.0.0'], 'GROUPED sections, alphabetical, TRUE counts (the zone holds exactly db + fs here), hoisted versions')
  const mems = det._desc().filter((el) => el.className === 'gmem')
  assert.deepEqual(mems.map((m) => m.children.length), [1, 1], 'each section holds its member rows, indented in a .gmem wrapper')
  const before = S().selected
  assert.equal(before, 'cat:tools')
  fire(heads[1], 'click') // the REAL group-header door
  await sleep(120)
  assert.equal(S().selected, 'g:fs', 'clicking the fs header opened the group details through the plain selectNode door')
  assert.equal(S().focus, null, '…carrying NO nav flag (selectNode(\'g:\' + gid), full stop — cold select, in-focus walk)')
  assert.ok(String(det.className).split(' ').includes('lvl-group'), 'the group container carries lvl-group')
  const gh2 = det.children.find((c) => c.tagName === 'H2')
  assert.ok(gh2.children[0] && gh2.children[0].className === 'lvl' && gh2.children[0].text === '组', 'the group header chip names its level')
})

// =========================================================================
// V2.7 FIX ROUND — two micro fixes, pinned through the real handlers:
// (1) the zone section's 还有 N cap row lives INSIDE its .gmem wrapper (the
//     R51 indent must wrap the tail too — structure assertion on real DOM);
// (2) the dependency-graph dbltap door is GATED at the app level. Frozen-dist
//     premises, probe-proven on this exact harness (report §v27-fix): the
//     250ms debounce is time-only and the dbltap target is the hit-test at the
//     SECOND press — `tap:a | tap:b | dbltap:b` fires on cross-target pairs;
//     only LEFT mouseups feed the dbl clock (the which===3 branch never sets
//     it), so the reachable menu-dismiss shape is tap → right-click (menu) →
//     dismissing tap, and the trailing dbltap lands ON the package.
// =========================================================================

test('v27-fix 1: the 还有 N cap row nests INSIDE its section .gmem wrapper', async () => {
  await sleep(300) // clear the dbl window of any previous gesture
  assert.equal(S().focus, null, 'cold start')
  // open bundle through the REAL menu command (kernel holds only bundle)
  const g = rp('g:bundle')
  assert.ok(g, 'the bundle card renders in the plain view')
  rightAt(g.x, g.y)
  await sleep(60)
  const expand = rows().find((b) => b.text === '展开')
  assert.ok(expand, 'the cold collapsed card offers 展开')
  pressRow(expand, { clientX: g.x, clientY: g.y })
  await sleep(150)
  // reach the kernel zone panel through the REAL crumb route: pkg details → 内核
  const r = rp('r1@1')
  assert.ok(r, 'r1@1 renders after the expand')
  leftAt(r.x, r.y)
  await sleep(120)
  const det = doc.getElementById('details')
  const crumb = det._desc().find((el) => el.className === 'crumb' && el.text === '内核')
  assert.ok(crumb, 'the 内核 crumb rides r1@1 details')
  fire(crumb, 'click')
  await sleep(120)
  assert.equal(S().selected, 'cat:kernel', 'the zone details are open')
  const heads = det._desc().filter((el) => String(el.className).split(' ').includes('ghead'))
  assert.deepEqual(heads.map(elText), ['bundle \u00d713 \u00b7 1.0.0'], 'fixture: bundle now carries 13 members (11 added over the cap), all on 1.0.0 → hoisted (V2.8 R54)')
  // Scalars only, deliberately: an assert on an array of FEl DOM nodes sends
  // node:assert's myersDiff into recursive inspection of the whole element
  // graph (circular parentNode chains) — a 3-minute GC death spiral instead of
  // a clean red (found the hard way during this round).
  const mems = det._desc().filter((el) => el.className === 'gmem')
  assert.equal(mems.length, 1, 'kernel is exactly one section')
  const caps = det._desc().filter((el) => el.className === 'kv' && el.children[1] && /还有/.test(el.children[1].text))
  assert.equal(caps.length, 1, 'the section is capped exactly once')
  assert.equal(caps[0].children[1].text, '还有 3', 'the tail names the hidden count (13-10)')
  assert.equal(String(caps[0].parentNode.className), 'gmem', 'the cap row lives INSIDE the .gmem wrapper — the indent wraps the tail too (BASE leak: parent is the panel box, class ' + String(caps[0].parentNode.className) + ')')
  assert.equal(caps[0].parentNode === mems[0], true, 'and it is THE section wrapper, not a sibling section')
  assert.equal(mems[0].children.length, 11, 'wrapper = the 10 member rows + the cap tail as its last child')
  assert.equal(mems[0].children[10] === caps[0], true, 'the cap row is the wrapper last child')
  assert.ok(mems[0].children.slice(0, 10).every((c) => c.className === 'jump'), 'the first ten children are member rows')
})

test('v27-fix 2 case A: two quick taps on DIFFERENT packages stay lightweight — the cross-target dbltap must not enter', async () => {
  await sleep(300) // settle out of the previous gesture's dbl window
  assert.equal(S().focus, null, 'cold start')
  const a = rp('d1@1'), b0 = rp('x@1')
  assert.ok(a && b0, 'd1@1 and x@1 both render (db and fs are expanded)')
  // The pair runs on the pinned clock: the dist MUST synthesize the trailing
  // dbltap (see `pinned`), so the gate is provably consulted and the refusal
  // below is a refusal, not a "the box was too slow to fire a dbltap" false green.
  pinned(() => {
    leftAt(a.x, a.y)
    const b = rp('x@1') || b0
    leftAt(b.x, b.y) // same ms: the frozen dist now synthesizes a dbltap ON x@1 (probe S[cross-target])
  })
  await sleep(350)
  assert.equal(S().focus, null, 'A: the cross-target pair must NOT open the dependency graph (BASE lands at focus=' + JSON.stringify(S().focus) + ')')
  assert.equal(S().selected, 'x@1', 'the second tap just selected — plain lightweight R46 semantics')
  assert.deepEqual(S().pathStack, [], 'no walk stack was started')
})

test('v27-fix 2 case B: a menu-dismissing press pair on the SAME package never enters (real tap, right-click opens the menu, swallowing tap)', async () => {
  await sleep(300)
  if (S().focus) { leftAt(6, 6); await sleep(350) } // self-normalize: the cold precondition is MINE, not the predecessor's
  assert.equal(S().focus, null, 'cold start')
  const x1 = rp('x@1')
  // Pinned for the whole dismiss shape: the dist's dbl clock MUST see the two
  // left mouseups inside its 250ms bound (up3-up1), i.e. the trailing dbltap on
  // x@1 is guaranteed and the gate's refusal of a swallow-bearing pair is real.
  pinned(() => {
    leftAt(x1.x, x1.y) // tap 1: a real lightweight tap — it arms the dist dbl clock
    assert.equal(S().selected, 'x@1', 'tap 1 selected normally (nothing swallowed yet)')
    const x2 = rp('x@1') || x1
    rightAt(x2.x, x2.y) // the menu opens ON x@1 (cxttap is a right press — the dbl clock is untouched)
    assert.equal(menuEl().hidden, false, 'the menu is open before the dismissing press')
    const x3 = rp('x@1') || x2
    leftAt(x3.x, x3.y) // tap 2: the mousedown closes + arms the swallow; the tap is EATEN —
  })
  await sleep(350)   // …yet the dist still emits a dbltap here (probe + IDX 294099: up3-up1 < 250ms)
  assert.equal(menuEl().hidden, true, 'the press dismissed the menu')
  assert.equal(S().focus, null, 'B: a pair containing a swallowed tap NEVER enters (BASE lands at focus=' + JSON.stringify(S().focus) + ')')
  assert.equal(S().selected, 'x@1', 'the swallow is intact: the dismissing tap stole no selection')
})

test('v27-fix 2 case C: a true same-target double-click still ENTERS with zero camera (the gate keeps the door)', async () => {
  await sleep(300)
  if (S().focus) { leftAt(6, 6); await sleep(350) } // self-normalize (see case B)
  doc.getElementById('focus-depth').value = '0' // unlimited — the user-control default
  assert.equal(S().focus, null, 'cold start')
  const anims0 = ANIMS.length
  dblAt('x@1') // the press pair is clock-pinned inside dblAt: the deliberate pair is deterministic
  await sleep(350)
  assert.deepEqual(S().focus, { rootId: 'x@1', depth: null }, 'C: the deliberate same-target pair ENTERS — the gate is not a wall (the R49 door survives)')
  assert.deepEqual(S().pathStack, [], 'an entry, not a walk')
  assert.equal(ANIMS.length - anims0, 0, 'and it is still zero camera ops (R50 untouched)')
  leftAt(6, 6) // back to the plain view for the hygiene test
  await sleep(350)
  assert.equal(S().focus, null, 'the exit is intact — the door rides the same funnel as always')
})

// =========================================================================
// V2.8 R57 — the DELIBERATE gate on the two structure doors (group card and
// zone shell). The v27-fix premise already proven on this harness: the frozen
// dist synthesizes dbltap from the 2nd LEFT mouseup within 250ms of the 1st,
// target = hit-test at press 2, and a SWALLOWED tap still feeds that clock.
// So the reachable false-open is tap → right-click (menu) → dismissing tap,
// and the trailing dbltap lands on the card/zone. Both doors now share the
// package door's gate (dblTapIsDeliberate) — the dismiss-pair must spend
// NOTHING on the collapse toggle while a true double-click keeps it.
// =========================================================================

test('V2.8 R57 case 1: the group-card dismiss-pair (tap → cxttap → swallowing tap) must NOT toggle collapse', async () => {
  await sleep(300) // clear the dbl window of any previous gesture
  if (S().focus) { leftAt(6, 6); await sleep(350) } // self-normalize the cold precondition
  fire(doc.getElementById('retry'), 'click') // the real freshView boot (same as matrix 4/6)
  await sleep(250)
  assert.equal(S().focus, null, 'cold start after the real boot')
  assert.equal(S().view.collapsedGroups, null, 'freshView: the all-collapsed default (null) is back')
  const g1 = rp('g:bundle')
  assert.ok(g1, 'the bundle card renders')
  pinned(() => { // same pin as the package-door negatives: the trailing dbltap is guaranteed
    leftAt(g1.x, g1.y) // tap 1: a REAL lightweight tap — arms the dist dbl clock
    assert.equal(S().selected, 'g:bundle', 'tap 1 selected normally (nothing swallowed yet)')
    const g2 = rp('g:bundle') || g1
    rightAt(g2.x, g2.y) // the card menu opens (right presses never feed the dbl clock)
    assert.equal(menuEl().hidden, false, 'the menu is open before the dismissing press')
    const g3 = rp('g:bundle') || g2
    leftAt(g3.x, g3.y) // mousedown closes + arms the swallow; the tap is EATEN —
  })
  await sleep(350)   // …yet the dist still fires a dbltap on the card here
  assert.equal(menuEl().hidden, true, 'the press dismissed the menu')
  assert.equal(S().view.collapsedGroups, null,
    'R57: a pair containing a swallowed tap NEVER reaches the collapse door (BASE lands with a materialized Set — the RED case)')
})

test('V2.8 R57 case 2: a TRUE double-click on a group card still expands (the gate is not a wall)', async () => {
  await sleep(300)
  assert.equal(S().view.collapsedGroups, null, 'precondition owned by case 1: everything is still collapsed')
  dblAt('g:fs') // two real same-card presses, same ms → deliberate pair
  await sleep(350)
  const cg = S().view.collapsedGroups
  assert.ok(cg && cg.has('bundle') && !cg.has('fs'),
    'the deliberate pair EXPANDED fs and left the rest of the materialized all-collapsed set alone')
})

test('V2.8 R57 case 3: the zone shell ignores the dismiss-pair but answers a true double-click', async () => {
  await sleep(300)
  fire(doc.getElementById('retry'), 'click') // cold, all-collapsed, nothing excluded
  await sleep(250)
  assert.equal(S().focus, null, 'cold start')
  assert.equal(S().view.collapsedCats.has('kernel'), false, 'kernel starts expanded')
  pinned(() => { // the dismiss shape on the pinned clock → the trailing dbltap is guaranteed
    const z1 = zonePt('cat:kernel')
    leftAt(z1.x, z1.y)
    assert.equal(S().selected, 'cat:kernel', 'press 1 front-hit the ZONE shell itself (the padding strip above the card)')
    const z2 = zonePt('cat:kernel')
    rightAt(z2.x, z2.y)
    assert.equal(menuEl().hidden, false, 'the zone menu is open')
    const z3 = zonePt('cat:kernel')
    leftAt(z3.x, z3.y) // the swallowing tap; the dist still emits the trailing dbltap
  })
  await sleep(350)
  assert.equal(menuEl().hidden, true, 'the press dismissed the zone menu')
  assert.equal(S().view.collapsedCats.has('kernel'), false,
    'R57: the dismiss-pair never collapsed the zone (BASE lands with kernel collapsed — the RED case)')
  // a TRUE double-click still collapses…
  const za = zonePt('cat:kernel')
  pinned(() => { leftAt(za.x, za.y); leftAt(za.x, za.y) })
  await sleep(350)
  assert.equal(S().view.collapsedCats.has('kernel'), true, '…two deliberate presses did collapse it')
  // …and one more deliberate double-click expands it back (leave the view clean)
  const zb = zonePt('cat:kernel')
  pinned(() => { leftAt(zb.x, zb.y); leftAt(zb.x, zb.y) })
  await sleep(350)
  assert.equal(S().view.collapsedCats.has('kernel'), false, 'the toggle is a TOGGLE — the door still opens both ways')
  leftAt(6, 6)
  await sleep(350)
})

// =========================================================================
// V2.9a R59 — DRAG SOVEREIGNTY, wired. A drag is the ONE gesture that moves
// cytoscape elements directly, so the whole override lifecycle is proven here
// against the REAL vendored dist: the press/move/release trio drives cytoscape's
// own node-drag interaction, which fires the app's registered 'dragfree'
// handler. Positions are then read back off the real elements across structural
// repaints — the model slot for a never-dragged element is captured from the
// untouched pipeline BEFORE any drag (R63: slots are PER-VIEW — each REF is
// captured in, and compared inside, the same view; see the R63 test below for
// the tier-switch case, where the reflow itself is under test).
// =========================================================================

/** Drag from a RENDERED point: press, MOVE, release (a dist-driven gesture). */
const dragFrom = (pt, dx, dy) => {
  fire(canvas, 'mousedown', { clientX: pt.x, clientY: pt.y, which: 1, button: 0 })
  fire(canvas, 'mousemove', { clientX: pt.x + dx, clientY: pt.y + dy, which: 1, button: 0 })
  fire(canvas, 'mouseup', { clientX: pt.x + dx, clientY: pt.y + dy, which: 1, button: 0 })
}
/** Drag an element by id from its rendered centre (zones need zonePt instead). */
const dragBy = (id, dx, dy) => {
  const a = rp(id)
  if (!a) throw new Error('dragBy: ' + id + ' is not rendered')
  dragFrom(a, dx, dy)
  return a
}
const posOf = (id) => {
  const el = S().cy.getElementById(id)
  return el.length ? { x: el.position('x'), y: el.position('y') } : null
}
const dragKeys = () => Object.keys(S().dragged).sort()
/** Model slots captured from the untouched pipeline BEFORE any drag. */
const REF = {}

test('R59 1: a real DOM drag records state.dragged, writes no view state, and survives structural repaints', async () => {
  await sleep(300)
  fire(doc.getElementById('retry'), 'click') // the real freshView boot: cold, all collapsed
  await sleep(250)
  assert.deepEqual(dragKeys(), [], 'a fresh boot starts with an empty override map')
  fire(segP, 'click') // 包级: every group expanded, so members render and can be dragged
  await sleep(250)
  REF.pkg = posOf('r1@1'); REF.card = posOf('g:bundle'); REF.zone = posOf('cat:tools')
  assert.ok(REF.pkg && REF.card && REF.zone, 'reference model slots captured (r1@1 / g:bundle / cat:tools)')
  const anims0 = ANIMS.length
  const before = posOf('r1@1')
  const view0 = { tier: S().view.granularity, focus: S().focus, cats: [...S().view.filterCats] }
  dragBy('r1@1', 70, 45)
  await sleep(120)
  const rec = S().dragged['r1@1']
  assert.ok(rec && isFinite(rec.x) && isFinite(rec.y), 'dragfree RECORDED the release point: ' + JSON.stringify(rec))
  // The gesture is +70/+45 in RENDERED px; the record is MODEL space, so the
  // dist's own zoom divides it (model Δ = rendered Δ ÷ zoom — pinned, not guessed).
  const z = S().cy.zoom()
  assert.ok(Math.abs(rec.x - before.x - 70 / z) < 2 && Math.abs(rec.y - before.y - 45 / z) < 2,
    'the record is the model-coordinate release point (zoom ' + z.toFixed(4) + ', from ' + JSON.stringify(before) + ' to ' + JSON.stringify(rec) + ')')
  assert.ok(rec.x > before.x && rec.y > before.y, 'same direction as the gesture (no teleport, no sign flip)')
  assert.deepEqual(posOf('r1@1'), { x: rec.x, y: rec.y }, 'the live element sits where it was released')
  assert.equal(S().dragged['g:bundle'], undefined, 'a drag records its OWN element only')
  assert.deepEqual(dragKeys(), ['r1@1'], 'exactly one entry')
  assert.equal(S().focus, view0.focus, 'the drag wrote NO focus (a drag is not navigation)')
  assert.equal(S().view.granularity, view0.tier, '…no tier…')
  assert.deepEqual([...S().view.filterCats], view0.cats, '…and no filter change')
  assert.equal(ANIMS.length - anims0, 0, 'and it moved the camera ZERO times')
  // two structural repaints: 组级 (the member leaves the render set) then 包级 (it returns)
  fire(segG, 'click')
  await sleep(250)
  fire(segP, 'click')
  await sleep(250)
  assert.deepEqual(posOf('r1@1'), { x: rec.x, y: rec.y },
    'R59: the member came BACK from the repaint at its dragged spot, not its model slot')
  assert.deepEqual(posOf('g:bundle'), REF.card, 'a never-dragged element still lands on its model slot')
  assert.deepEqual(posOf('cat:tools'), REF.zone, '…same for the zone shell')
  assert.deepEqual(dragKeys(), ['r1@1'], 'structural repaints never prune a live override')
  assert.equal(ANIMS.length - anims0, 0, 'the two repaints moved the camera zero times (R50 intact)')
})

test('R59 2: ⌗ (header button) drops every override, repaints onto the model grid, and glides exactly once', async () => {
  const rec = S().dragged['r1@1']
  assert.ok(rec, 'precondition owned by R59 1: a drag override is live')
  const anims0 = ANIMS.length
  fire(doc.getElementById('arrange-view'), 'click')
  await sleep(350)
  assert.deepEqual(dragKeys(), [], '⌗ cleared the override map — its ONLY state write')
  const slot = posOf('r1@1')
  assert.deepEqual(slot, REF.pkg, 'the element is back on its MODEL slot')
  assert.notDeepEqual(slot, { x: rec.x, y: rec.y }, '…and demonstrably NOT on the dragged spot')
  assert.equal(ANIMS.length - anims0, 1, 'exactly ONE camera move, and it is the fit')
  const a = ANIMS[anims0]
  assert.ok(a && a.fit, 'the animate is a fit (not a center/zoom)')
  assert.equal(a.fit.padding, 40, 'the sanctioned ⌂ padding — one glide family, two doors')
  assert.equal(a.duration, 250, 'and the sanctioned 250ms')
  assert.equal(S().view.granularity, 'packages', '⌗ left the tier alone (a layout undo, not a view reset)')
  assert.equal(S().focus, null, '⌗ wrote no focus…')
  assert.deepEqual(S().pathStack, [], '…and started no path stack')
})

test('R59 3: the canvas menu offers 自动排布 ONLY while an override is live, and its row runs the same funnel', async () => {
  await sleep(300)
  assert.deepEqual(dragKeys(), [], 'precondition: nothing dragged (R59 2 cleared it)')
  rightAt(6, 6) // blank canvas → the view menu
  await sleep(60)
  assert.ok(menuEl() && !menuEl().hidden, 'the canvas menu opened')
  assert.deepEqual(rows().map((b) => b.text), ['复位视图', '退出聚焦', '自动排布'], 'the canvas row set gained 自动排布')
  assert.equal(rows()[2].disabled, true, 'nothing dragged → the row ships GREYED (the one rule: disabled, never hidden)')
  assert.equal(rows()[2].hidden, false, 'greyed, not removed')
  leftAt(770, 570) // dismiss the way a browser does: container press (+ swallowed tap)
  await sleep(300)
  dragBy('r1@1', -60, -30)
  await sleep(120)
  assert.deepEqual(dragKeys(), ['r1@1'], 'a drag is live again')
  rightAt(6, 6)
  await sleep(60)
  assert.equal(rows()[2].disabled, false, 'override live → the command is offered')
  const bgAnims = ANIMS.length
  pressRow(rows()[2], { clientX: 6, clientY: 6 })
  await sleep(350)
  assert.deepEqual(dragKeys(), [], 'the menu command cleared the map (the SAME autoArrange funnel as ⌗)')
  assert.deepEqual(posOf('r1@1'), REF.pkg, '…and the element returned to its model slot')
  assert.equal(ANIMS.length - bgAnims, 1, '…plus exactly one fit')
  assert.equal(ANIMS[bgAnims].fit.padding, 40)
  assert.equal(S().focus, null, 'no focus side effect')
})

test('R59 4: a dragged ZONE moves its subtree and every moved element records itself; a rescan prunes exactly the vanished id', async () => {
  await sleep(300)
  // the tools zone's own universe, derived from the fixture (never hardcoded)
  const toolsGids = GRAPH.groups.filter((g) => g.category === 'tools').map((g) => 'g:' + g.id)
  const toolsPkgs = GRAPH.nodes.filter((n) => toolsGids.indexOf('g:' + n.group) >= 0).map((n) => n.id)
  const EXPECT = ['cat:tools'].concat(toolsGids, toolsPkgs, ['r1@1']).sort()
  const beforeZone = posOf('cat:tools'), beforeCard = posOf('g:fs')
  dragBy('r1@1', 40, 20)
  await sleep(120)
  dragFrom(zonePt('cat:tools'), 30, -25) // a dragged ZONE SHELL (grabbed on its label strip)
  await sleep(120)
  assert.deepEqual(dragKeys(), EXPECT,
    'dragging a COMPOUND parent drags its whole subtree (frozen-dist behavior) and dragfree fires per element — so the shell, its cards and its members each recorded themselves')
  const dz = S().dragged['cat:tools'], dc = S().dragged['g:fs']
  assert.ok(dz && dc, 'both the shell and one of its cards hold overrides')
  assert.ok(Math.abs((dz.x - beforeZone.x) - (dc.x - beforeCard.x)) < 1e-6
    && Math.abs((dz.y - beforeZone.y) - (dc.y - beforeCard.y)) < 1e-6,
    'the subtree moved RIGIDLY (identical Δ vector) — that is why each element needs its own entry')
  const zoneRec = { x: dz.x, y: dz.y }
  // the rescan: r1@1 vanishes from the graph (the tools zone keeps its fs/db members)
  const GRAPH_COPY = JSON.parse(JSON.stringify(GRAPH))
  GRAPH.nodes = GRAPH.nodes.filter((n) => n.id !== 'r1@1')
  GRAPH.edges = GRAPH.edges.filter((e) => e.from !== 'r1@1' && e.to !== 'r1@1')
  try {
    fire(doc.getElementById('retry'), 'click') // the real loadGraph(false,false) → applyGraph
    await sleep(400)
    assert.equal(S().byId.has('r1@1'), false, 'the rescan really lost the package')
    assert.ok(S().cy.getElementById('cat:tools').length, '…while the tools zone shell still renders')
    assert.deepEqual(dragKeys(), EXPECT.filter((k) => k !== 'r1@1'),
      'exactly the vanished id was pruned; the surviving subtree overrides stayed (' + JSON.stringify(dragKeys()) + ')')
    assert.deepEqual({ x: S().dragged['cat:tools'].x, y: S().dragged['cat:tools'].y }, zoneRec,
      '…kept VERBATIM, not re-rounded or reset')
  } finally {
    GRAPH.nodes = GRAPH_COPY.nodes
    GRAPH.edges = GRAPH_COPY.edges
  }
})

test('R63: an id-keyed drag override survives the tier-switch REFLOW and re-applies where the element is a leaf', async () => {
  // R63 makes model slots a pure fn of (graph, view): a tier switch RE-FLOWS
  // every card onto the current view's slot. The app's dragged map is id-keyed
  // (state.dragged[id]) and applies AT PAINT (dragged[id] ?? model slot), so a
  // dragged id SURVIVES the reflow — it is keyed by id, never by slot.
  //
  // Honest scope note (report §drag): while the dragged element renders as a
  // LEAF (a collapsed card in the groups tier), cytoscape honours the override
  // position exactly. The moment it EXPANDS into a compound parent, cytoscape's
  // own re-centering re-anchors the parent on its children — a pre-existing
  // V2.9a render-layer behavior (verified: it also re-centers in BASE), NOT an
  // R63 change and not the model's doing (paint still passes dragged ?? slot;
  // the dist moves it after add). That is V2.10b parent-frame territory. So we
  // pin the id-keyed survival (map persists across both switches) and the
  // paint-level re-apply in the tier where the element is a leaf (groups tier),
  // plus the never-dragged card's reflow round-trip (per-view determinism).
  await sleep(300)
  fire(doc.getElementById('arrange-view'), 'click') // clear any override left by the prior test before booting refs
  await sleep(350)
  fire(doc.getElementById('retry'), 'click') // the real freshView boot: cold groups tier, all collapsed
  await sleep(250)
  assert.equal(S().view.granularity, 'groups', 'cold boot rides the default tier')
  assert.deepEqual(dragKeys(), [], 'the board starts with an empty override map')
  const REF = { fs: posOf('g:fs'), db: posOf('g:db') } // groups-tier model slots (both are LEAF cards)
  assert.ok(REF.fs && REF.db, 'both tools cards render at groups tier')
  dragBy('g:fs', 45, 60)
  await sleep(120)
  const rec = S().dragged['g:fs']
  assert.ok(rec && isFinite(rec.x) && isFinite(rec.y), 'the card drag recorded its release point')
  assert.deepEqual(dragKeys(), ['g:fs'], 'exactly one override')
  assert.deepEqual(posOf('g:fs'), { x: rec.x, y: rec.y }, 'while a leaf, the dragged card sits on its override')

  // TIER SWITCH → reflow: a never-dragged card moves off its groups-tier slot,
  // and the DRAGGED ID's override entry survives untouched (id-keyed, not slot).
  fire(segP, 'click')
  await sleep(250)
  assert.deepEqual(dragKeys(), ['g:fs'], 'the tier switch pruned nothing (all ids still live)')
  assert.deepEqual(S().dragged['g:fs'], rec, 'R63: the id-keyed override survived the tier-switch reflow verbatim')
  assert.notDeepEqual(posOf('g:db'), REF.db, 'R63: the never-dragged card really re-flowed off its groups-tier slot')

  // BACK TO GROUPS: g:fs is a leaf card again → paint re-applies the override
  // onto the re-flowed slot, and the clean card lands on the SAME per-view slot
  // it left (pure fn of (graph, view)).
  fire(segG, 'click')
  await sleep(250)
  assert.deepEqual(posOf('g:fs'), { x: rec.x, y: rec.y }, 'R63: back as a leaf, paint re-applies the surviving override')
  assert.deepEqual(posOf('g:db'), REF.db, 'the never-dragged card returns to its exact groups-tier slot')

  // ⌗ is the sanctioned exit: overrides drop, the card lands back on its slot.
  fire(doc.getElementById('arrange-view'), 'click')
  await sleep(350)
  assert.deepEqual(dragKeys(), [], '⌗ cleared the override map')
  assert.deepEqual(posOf('g:fs'), REF.fs, '…and the card returned to its (per-view) model slot')
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
