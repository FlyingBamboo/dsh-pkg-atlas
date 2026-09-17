import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixture } from './fixtures.mjs'
import { apply, name } from '../lib/index.js'

const fakeCtx = ({ throwOnRegister = false } = {}) => {
  const registered = []
  const errors = []
  let disposed = 0
  const inner = {
    webServer: {
      register(route) {
        if (throwOnRegister) throw new Error('duplicate (kind, path)')
        registered.push(route)
        return () => { disposed++ }
      },
    },
    effect(fn) { registered.disposer = fn(); return true },
    logger: { error: (...a) => errors.push(a.join(' ')) },
  }
  return {
    registered, errors, inner,
    inject(services, cb) { assert.deepEqual(services, ['webServer']); cb(inner) },
    isDisposed: () => disposed,
  }
}

const mockRes = () => {
  const res = { code: 0, headers: {}, body: '' }
  res.writeHead = (c, h) => { res.code = c; Object.assign(res.headers, h) }
  res.end = (b) => { res.body = b }
  return res
}

test('plugin name and route registration on inject', async () => {
  assert.equal(name, 'dsh-pkg-atlas')
  const home = await mkdtemp(join(tmpdir(), 'atlas-idx-'))
  await buildFixture(home)
  const ctx = fakeCtx()
  apply(ctx, { dshHome: home })
  assert.equal(ctx.registered.length, 1)
  const route = ctx.registered[0]
  assert.equal(route.kind, 'prefix')
  assert.equal(route.path, '/dsh-pkg-atlas')
  const res = mockRes()
  await route.handler({ method: 'GET', url: '/dsh-pkg-atlas/api/graph' }, res)
  assert.equal(res.code, 200)
  assert.equal(JSON.parse(res.body).schema, 1)
  ctx.registered.disposer()
  assert.equal(ctx.isDisposed(), 1)
  await rm(home, { recursive: true, force: true })
})

test('register conflict degrades to logged error, never throws', () => {
  const ctx = fakeCtx({ throwOnRegister: true })
  apply(ctx, { dshHome: process.env.TEMP }) // scanner 不立即扫描（首请求才扫），home 无效无碍
  assert.equal(ctx.registered.length, 0)
  assert.match(ctx.errors.join(''), /registration failed/)
})

// ==================== Task V3：启动预热 + getStatus 接线 ====================

/** 通过已注册的 handler 读 /api/status——不开后门，走的就是 V3 新路由本身。 */
const statusVia = async (route) => {
  const res = mockRes()
  await route.handler({ method: 'GET', url: '/dsh-pkg-atlas/api/status' }, res)
  assert.equal(res.code, 200, 'GET /api/status 必须经 handler 返回 200')
  return JSON.parse(res.body)
}

const waitReady = async (route, budgetMs = 200) => {
  const t0 = Date.now()
  let st = await statusVia(route)
  while (st.state !== 'ready' && Date.now() - t0 <= budgetMs) {
    await new Promise((r) => setTimeout(r, 5))
    st = await statusVia(route)
  }
  return st
}

test('V3 启动预热：apply 后 ≤200ms status 即 ready；首个 /api/graph 走缓存不触发新扫描', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-warm-'))
  try {
    await buildFixture(home)
    const ctx = fakeCtx()
    apply(ctx, { dshHome: home })
    const route = ctx.registered[0]
    const st = await waitReady(route)
    assert.equal(st.state, 'ready', '预热扫描须在 200ms 内完成（fire-and-forget 预热未生效？）')
    assert.equal(st.phase, 'done')
    assert.ok(st.finishedAt >= st.startedAt)
    const res = mockRes()
    await route.handler({ method: 'GET', url: '/dsh-pkg-atlas/api/graph' }, res)
    assert.equal(res.code, 200)
    assert.equal(JSON.parse(res.body).schema, 1)
    // 预热效应 = 该请求走 TTL 缓存：快照逐字段不变（无新扫描 => 无复位/无新 finishedAt）。
    // 这也是承接项 3 的语义钉：缓存 serve 后 status 仍描述上一次扫描，finishedAt 是新鲜度信号。
    assert.deepEqual(await statusVia(route), st, '首个 graph 请求后快照必须原样——不得触发新扫描')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('V3 预热空 home：root-unreadable 是 warning 级——status ready、图正常、logger 静默', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-warm-empty-'))
  try {
    const ctx = fakeCtx()
    apply(ctx, { dshHome: home })
    const route = ctx.registered[0]
    const st = await waitReady(route)
    assert.equal(st.state, 'ready', '空根是 warning 级（I-3/R25），预热必须能到 ready')
    assert.equal(st.error, null)
    const res = mockRes()
    await route.handler({ method: 'GET', url: '/dsh-pkg-atlas/api/graph' }, res)
    assert.equal(res.code, 200)
    const g = JSON.parse(res.body)
    assert.equal(g.schema, 1)
    assert.ok(g.warnings.some((w) => w.type === 'root-unreadable'))
    assert.equal(ctx.errors.length, 0, 'warning 级发现进图，不进 logger.error')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
