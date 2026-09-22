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

/** 一次经 handler 的请求 + 它的往返耗时（含 sendJson，不含调用方的后续处理）。 */
const timedGet = async (route, url) => {
  const t0 = performance.now()
  const res = mockRes()
  await route.handler({ method: 'GET', url }, res)
  return { res, ms: performance.now() - t0 }
}

// —— 预热预算的 deflake（V28+）：为什么「≤200ms 即 ready」换成了分层判据 ——
//
// 原断言在满载机器上是环境噪声，不是回归信号。实测复现（本机 8 逻辑核，另起 24 个
// CPU 忙等进程把机器压到 ~3x 超订阅）：预热扫描自身耗时 235–283ms，
// `node --test test/index.test.mjs` 跑 8 次红 7 次，actual 恒为 'scanning'——
// 扫描在跑，只是被机器压慢。BASE 与 HEAD 同红 ⇒ 与发货代码无关（独立评审员同样复现）。
//
// 这条测试的存在目的 = 抓「预热没生效 / 首请求没吃到热缓存」。该回归有两个与耗时
// 无关的判据，它们才是一级守卫：
//   G1 轮询只打 /api/status，全程不碰 /api/graph。扫描只有两个入口：apply() 里的
//      fire-and-forget 预热，和 /api/graph 请求自身（lib/http.js 的 getGraph）。于是
//      「status 自己走到 ready」就是预热跑过的证明；预热一旦被删，status 永远停在
//      'idle'，G1 必红——与被机器压慢的 200ms 无关。
//   G2 首个 /api/graph 之后 /api/status 快照逐字段不变 ⇒ 没有新扫描 ⇒ 首请求确实吃了
//      TTL 缓存（同时是承接项 3 的新鲜度语义钉：缓存 serve 后 status 仍描述上一次扫描）。
// 耗时只剩兜底与相对量，全部按重载实测取值（空载 → 重载两组数字都记在这里）：
//   C1 ready 必须在上限内到达：空载 ~15ms，重载 237–465ms ⇒ 上限 2000ms（≥4x 余量）。
//      它挡「预热卡死/空转、靠别的请求救回来」这类畸形，不再挡 CI 快慢。
//   P1 首个 /api/graph 往返必须在上限内：V3 原话「页面首请求直接吃缓存」的可观测形式。
//      空载 0.3ms，重载最差 19ms ⇒ 上限 500ms。
//   R1 相对判据（同一次运行内自比较，冷热两端同时受载 ⇒ 比值是结构量）：一次真扫描——
//      同一路径的 forced rescan（?refresh=1），也就是「没有热缓存时首请求要付的钱」，
//      ≈300 次 fs 调用——必须显著贵过缓存 serve（≈0 次 fs 调用）。serve 成本取 3 次缓存
//      请求里最快的一次，避免被单次调度抖动放大。实测比值：空载 ~15x，3x 超订阅重载
//      2000x+ ⇒ 门槛 4x。真回归（预热跑了但首请求没吃到缓存）会把比值压到 ≈1。
const WARM_READY_CEILING_MS = 2000
const WARM_SERVE_CEILING_MS = 500
const COLD_VS_WARM_MIN_RATIO = 4

/**
 * 只读 /api/status 等到终态（G1：绝不打 /api/graph，那会自己触发扫描）。
 * 'failed' 是终态（lib/scan.js：只有新一轮扫描才改写它），提前退出，红得快一点。
 * @returns `{ st, waitedMs }` — 末次快照 + 自 apply() 起实际等待的毫秒
 */
const waitReady = async (route, ceilingMs = WARM_READY_CEILING_MS) => {
  const t0 = Date.now()
  let st = await statusVia(route)
  while (st.state !== 'ready' && st.state !== 'failed' && Date.now() - t0 <= ceilingMs) {
    await new Promise((r) => setTimeout(r, 5))
    st = await statusVia(route)
  }
  return { st, waitedMs: Date.now() - t0 }
}

test('V3 启动预热：不碰 /api/graph 也能自走 ready；首个 /api/graph 吃缓存不触发新扫描', async () => {
  const home = await mkdtemp(join(tmpdir(), 'atlas-warm-'))
  try {
    await buildFixture(home)
    const ctx = fakeCtx()
    apply(ctx, { dshHome: home })
    const route = ctx.registered[0]
    const { st, waitedMs } = await waitReady(route)
    // G1 + C1：能自己到 ready ⇒ 预热启动过；上限只挡卡死/空转
    assert.equal(st.state, 'ready',
      `预热扫描必须在 ${WARM_READY_CEILING_MS}ms 内自走到 ready（等待 ${waitedMs}ms，末次快照 ${JSON.stringify(st)}）`
      + '——停在 idle = fire-and-forget 预热根本没启动；停在 scanning = 预热被拖死；停在 failed = 预热报错')
    assert.equal(st.phase, 'done')
    assert.ok(st.finishedAt >= st.startedAt)
    const warm1 = await timedGet(route, '/dsh-pkg-atlas/api/graph')
    assert.equal(warm1.res.code, 200)
    assert.equal(JSON.parse(warm1.res.body).schema, 1)
    // P1：首请求必须快——「页面首请求直接吃缓存」的可观测形式
    assert.ok(warm1.ms <= WARM_SERVE_CEILING_MS,
      `P1：首个 /api/graph 往返 ${warm1.ms.toFixed(1)}ms 必须 ≤ ${WARM_SERVE_CEILING_MS}ms（首请求像是在自己扫描）`)
    // G2：预热效应 = 该请求走 TTL 缓存：快照逐字段不变（无新扫描 => 无复位/无新 finishedAt）。
    // 这也是承接项 3 的语义钉：缓存 serve 后 status 仍描述上一次扫描，finishedAt 是新鲜度信号。
    assert.deepEqual(await statusVia(route), st, '首个 graph 请求后快照必须原样——不得触发新扫描')
    // R1：冷/热对照。两次重复的缓存 serve 与 warm1 一起给出缓存路径的成本下界，
    // forced rescan 给出「无热缓存时首请求要付的钱」。
    const warm2 = await timedGet(route, '/dsh-pkg-atlas/api/graph')
    const warm3 = await timedGet(route, '/dsh-pkg-atlas/api/graph')
    const cacheMs = Math.min(warm1.ms, warm2.ms, warm3.ms)
    const cold = await timedGet(route, '/dsh-pkg-atlas/api/graph?refresh=1')
    assert.equal(cold.res.code, 200, 'forced rescan 走的是同一条 /api/graph 路径')
    assert.ok(cold.ms >= COLD_VS_WARM_MIN_RATIO * cacheMs,
      `R1：forced rescan ${cold.ms.toFixed(1)}ms 必须 ≥ ${COLD_VS_WARM_MIN_RATIO}x 缓存 serve ${cacheMs.toFixed(2)}ms`
      + `（实测比值 ${(cold.ms / Math.max(cacheMs, 0.01)).toFixed(1)}x）——首请求没吃到热缓存时两者会趋同`)
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
    const { st, waitedMs } = await waitReady(route)
    assert.equal(st.state, 'ready',
      `空根是 warning 级（I-3/R25），预热必须能到 ready（等待 ${waitedMs}ms，末次快照 ${JSON.stringify(st)}）`)
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
