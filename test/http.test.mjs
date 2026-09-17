import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixture } from './fixtures.mjs'
import { scan, createScanner } from '../lib/scan.js'
import { createRequestHandler, loadAssets, PREFIX } from '../lib/http.js'

let server, base, home, refreshCalls

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'atlas-http-'))
  await buildFixture(home)
  const scanner = createScanner({ dshHome: home })
  refreshCalls = []
  const getGraph = async (refresh = false) => { refreshCalls.push(refresh); return scanner.get(refresh) }
  const assets = loadAssets(new URL('../web', import.meta.url).pathname.replace(/^\//, '')) // Task 8 前占位需要 web 目录最小存在
  server = createServer((req, res) => { createRequestHandler({ getGraph, assets })(req, res) })
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${server.address().port}`
})
after(async () => {
  await new Promise((r) => server.close(r))
  await rm(home, { recursive: true, force: true })
})

test('GET / returns HTML with CSP and nosniff', async () => {
  const res = await fetch(`${base}${PREFIX}/`)
  assert.equal(res.status, 200)
  assert.match(res.headers.get('content-type'), /text\/html/)
  assert.match(res.headers.get('content-security-policy'), /default-src 'self'/)
  assert.match(res.headers.get('content-security-policy'), /style-src 'self' 'unsafe-inline'/)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('GET /api/graph returns schema-1 without internal fields', async () => {
  const res = await fetch(`${base}${PREFIX}/api/graph`)
  const json = await res.json()
  assert.equal(json.schema, 1)
  assert.ok(!res.headers.get('content-type').includes('html'))
  const raw = JSON.stringify(json)
  assert.ok(!raw.includes('"_manifest"'))
  assert.ok(!raw.includes('"_dir"'))
  assert.ok(json.nodes[0].path.startsWith('$DSH_HOME'))
})

test('refresh=1 is forwarded to getGraph', async () => {
  await fetch(`${base}${PREFIX}/api/graph?refresh=1`)
  assert.ok(refreshCalls.at(-1) === true)
})

test('readme from snapshot path: md then zh fallback', async () => {
  const a = await (await fetch(`${base}${PREFIX}/api/readme?id=${encodeURIComponent('plugin-x@1.0.0')}`)).text()
  assert.match(a, /X 插件。/)
  const b = await (await fetch(`${base}${PREFIX}/api/readme?id=${encodeURIComponent('@deepseek-ai/core@1.0.0')}`))
  assert.match(await b.text(), /核心内核|core/) // core 无 README.md → README.zh.md 兜底
})

test('readme errors: no-readme / unknown-id / not-a-package / invalid-id', async () => {
  const g = await scan({ dshHome: home })
  const noReadme = g.nodes.find((n) => n.kind === 'package' && !['plugin-x@1.0.0', '@deepseek-ai/core@1.0.0'].includes(n.id)).id
  // 排序敏感性守卫：选中的必须是 fixture 里确认无 README 的节点，否则上面那行 find 需要改。
  assert.ok(
    ['@deepseek-ai/base@1.0.0', '@deepseek-ai/extra@1.0.0', '@deepseek-ai/util@1.0.0', '@deepseek-ai/util@2.0.0',
      '@deepseek-ai/escaper@1.0.0', 'patched-plugin@0.1.0'].includes(noReadme),
    `fixture ordering changed: noReadme=${noReadme}`)
  let res = await fetch(`${base}${PREFIX}/api/readme?id=${encodeURIComponent(noReadme)}`)
  assert.equal(res.status, 404); assert.equal((await res.json()).error, 'no-readme')
  res = await fetch(`${base}${PREFIX}/api/readme?id=nope%409.9.9`)
  assert.equal((await res.json()).error, 'unknown-id')
  res = await fetch(`${base}${PREFIX}/api/readme?id=profile%3Aweb`)
  assert.equal((await res.json()).error, 'not-a-package')
  // R16：broken id 带 scoped ref，同样必须是 not-a-package（不得被卫生正则误判成 400）
  res = await fetch(`${base}${PREFIX}/api/readme?id=${encodeURIComponent('broken:@deepseek-ai/pkg-broken')}`)
  assert.equal(res.status, 404); assert.equal((await res.json()).error, 'not-a-package')
  for (const bad of ['..%2F..%2Fetc%2Fpasswd%401', 'a%40b%40c', '.', '..%40x', 'a%252e%252e@1', 'x@1%2Fy', ''] ) {
    res = await fetch(`${base}${PREFIX}/api/readme?id=${bad}`)
    assert.equal(res.status, 400, bad)
  }
})

test('unknown route 404 JSON; POST 405 with Allow', async () => {
  let res = await fetch(`${base}${PREFIX}/nope`)
  assert.equal(res.status, 404); assert.equal((await res.json()).error, 'not-found')
  res = await fetch(`${base}${PREFIX}/api/graph`, { method: 'POST' })
  assert.equal(res.status, 405); assert.equal(res.headers.get('allow'), 'GET, HEAD')
})

test('HEAD / is served like GET: 200, content-length, empty body (R18)', async () => {
  const res = await fetch(`${base}${PREFIX}/`, { method: 'HEAD' })
  assert.equal(res.status, 200)
  assert.ok(res.headers.get('content-length'), 'HEAD must carry content-length')
  assert.equal(await res.text(), '')
})

test('outside prefix is not ours: 404 (no cross-route interference)', async () => {
  const res = await fetch(`${base}/other-plugin`)
  assert.equal(res.status, 404)
})

test('bare PREFIX (no trailing slash) 301s to trailing slash and serves index (R21)', async () => {
  // Relative asset refs in index.html (app.js, vendor/…) only resolve at the trailing-slash URL.
  const r = await fetch(base + PREFIX, { redirect: 'follow' })
  assert.equal(r.redirected, true)
  assert.equal(r.status, 200)
  assert.equal(r.url, base + PREFIX + '/')
  assert.match(r.headers.get('content-type'), /text\/html/)
})
