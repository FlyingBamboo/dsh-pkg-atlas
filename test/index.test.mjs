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
