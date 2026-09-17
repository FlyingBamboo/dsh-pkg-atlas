import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFixture } from './fixtures.mjs'
import { scan, createScanner } from '../lib/scan.js'
import { createRequestHandler, loadAssets, PREFIX } from '../lib/http.js'

let server, base, home, refreshCalls, assets

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'atlas-http-'))
  await buildFixture(home)
  const scanner = createScanner({ dshHome: home })
  refreshCalls = []
  const getGraph = async (refresh = false) => { refreshCalls.push(refresh); return scanner.get(refresh) }
  assets = loadAssets(fileURLToPath(new URL('../web', import.meta.url)))
  server = createServer((req, res) => { createRequestHandler({ getGraph, getStatus: () => scanner.status(), assets })(req, res) })
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
  // P1#6: sendJson 显式 Content-Length 与真实字节数一致（中文多字节 => byteLength 而非 length）
  assert.equal(res.headers.get('content-length'), String(Buffer.byteLength(raw)))
  // M-12: groups[].kind 封闭集断言（前端按 kind 上色，出现未知 kind 即契约破坏）
  const KINDS = new Set(['official', 'plugin', 'vendor', 'broken', 'ungrouped', 'profile'])
  assert.ok(json.groups.length > 0)
  for (const g of json.groups) assert.ok(KINDS.has(g.kind), `group kind 越界: ${JSON.stringify(g)}`)
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
  for (const bad of ['..%2F..%2Fetc%2Fpasswd%401', 'a%40b%40c', '.', '..%40x', 'a%252e%252e@1', 'x@1%2Fy', 'a%5Cb@1', ''] ) {
    res = await fetch(`${base}${PREFIX}/api/readme?id=${bad}`)
    assert.equal(res.status, 400, bad)
  }
  // M-12: 大写 id 通过卫生校验（NAME_RE 收 A-Za-z），但 npm 名大小写敏感，快照查找必 miss => 404 而非 400
  res = await fetch(`${base}${PREFIX}/api/readme?id=${encodeURIComponent('@DeepSeek-AI/Util@1.0.0')}`)
  assert.equal(res.status, 404)
  assert.equal((await res.json()).error, 'unknown-id')
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

test('HEAD /api/graph: 200 JSON headers, empty body, getGraph NOT called (P1#6)', async () => {
  let called = false
  const srv = createServer((req, res) => createRequestHandler({
    getGraph: async () => { called = true; return { nodes: [] } },
    assets,
  })(req, res))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${PREFIX}/api/graph`, { method: 'HEAD' })
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(await res.text(), '')
    assert.equal(called, false, 'HEAD 不得触发 getGraph——避免 scan() 副作用/开销')
  } finally {
    await new Promise((r) => srv.close(r))
  }
})

test('HEAD on unknown /api/* mirrors GET: 404, not a blanket 200 (RFC 9110 truthfulness)', async () => {
  const srv = createServer((req, res) => createRequestHandler({ getGraph: async () => ({ nodes: [] }), assets })(req, res))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${PREFIX}/api/nope`, { method: 'HEAD' })
    assert.equal(res.status, 404) // unknown api path: HEAD must agree with GET
  } finally {
    await new Promise((r) => srv.close(r))
  }
})

test('internal error: 500 body is opaque, logger receives the real error (I-5/T-1)', async () => {
  const seen = []
  const err = new Error('secret /abs/path E:\\x')
  const srv = createServer((req, res) => createRequestHandler({
    getGraph: async () => { throw err },
    assets,
    logger: { error: (e) => seen.push(e) },
  })(req, res))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}${PREFIX}/api/graph`)
    assert.equal(res.status, 500)
    const text = await res.text()
    assert.equal(text, '{"error":"internal-error"}') // 精确体：不含 secret/路径 任何片段
    assert.ok(!text.includes('secret'))
    assert.ok(!text.includes('E:'))
    assert.equal(seen.length, 1, 'logger.error 恰好一次')
    assert.equal(seen[0], err, '记录的是原始 err 对象（栈/路径只进日志，不进响应）')
  } finally {
    await new Promise((r) => srv.close(r))
  }
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

// ==================== Task V3：/api/status 路由 ====================

test('V3 GET /api/status: 200 + body 逐字段等于快照 + nosniff + CL；HEAD headers-only；POST 405', async () => {
  const fake = { state: 'scanning', phase: 'manifests', scanned: 3, total: 10, startedAt: 111, finishedAt: null, error: null }
  let statusCalls = 0
  const srv = createServer((req, res) => createRequestHandler({
    getGraph: async () => ({ nodes: [] }),
    getStatus: () => { statusCalls += 1; return fake },
    assets,
  })(req, res))
  await new Promise((r) => srv.listen(0, '127.0.0.1', r))
  try {
    const url = `http://127.0.0.1:${srv.address().port}${PREFIX}/api/status`
    const res = await fetch(url)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type'), /application\/json/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    const text = await res.text()
    assert.deepEqual(JSON.parse(text), fake, 'status JSON 必须逐字段等于快照（不掺水、不丢字段）')
    assert.equal(res.headers.get('content-length'), String(Buffer.byteLength(text)))
    assert.equal(statusCalls, 1)
    // HEAD：与 /api/graph 同形态的 headers-only 200（无 CL——不撒谎原则同样适用）
    const h = await fetch(url, { method: 'HEAD' })
    assert.equal(h.status, 200)
    assert.match(h.headers.get('content-type'), /application\/json/)
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(await h.text(), '')
    assert.equal(statusCalls, 1, 'HEAD 不得触发 getStatus（与 HEAD /api/graph 的无副作用纪律一致）')
    // POST：被全局方法闸拦截（既有闸，路由本身不需自证）
    const p = await fetch(url, { method: 'POST' })
    assert.equal(p.status, 405)
    assert.equal(p.headers.get('allow'), 'GET, HEAD')
  } finally {
    await new Promise((r) => srv.close(r))
  }
})

test('V3 主服务器 GET /api/status：描述真实扫描器终态（前置测试已扫完）且无路径/栈泄漏', async () => {
  const res = await fetch(`${base}${PREFIX}/api/status`)
  assert.equal(res.status, 200)
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
  const st = await res.json()
  // 本文件此前的 graph/refresh 测试都已 await 落定 → 终态必须 ready 且计满（快照即最后一次扫描）
  assert.equal(st.state, 'ready')
  assert.equal(st.phase, 'done')
  assert.equal(st.scanned, st.total)
  assert.ok(st.total > 0)
  assert.equal(st.error, null)
  assert.ok(!JSON.stringify(st).includes(':\\'), 'status JSON 不得含绝对路径（X- 泄漏纪律）')
})
