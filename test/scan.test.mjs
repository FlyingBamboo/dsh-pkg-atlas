import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixture, EXPECTED_PACKAGES } from './fixtures.mjs'
import { scan, resolveDshHome } from '../lib/scan.js'

let home, graph

before(async () => {
  home = await mkdtemp(join(tmpdir(), 'atlas-'))
  await buildFixture(home)
  graph = await scan({ dshHome: home })
  await rm(home, { recursive: true, force: true })
})

test('schema and profiles', () => {
  assert.equal(graph.schema, 1)
  assert.deepEqual(graph.profiles.map((p) => p.name), ['web'])
  assert.deepEqual(graph.profiles[0].bundles, ['@deepseek-ai/base'])
})

test('universe: referenced-only for non-official; hoisted and @types excluded', () => {
  // 两侧都排序：EXPECTED_PACKAGES 的声明序并非字典序（'patched-plugin' < 'plugin-x'）
  assert.deepEqual(graph.nodes.filter((n) => n.kind === 'package').map((n) => n.id).sort(), [...EXPECTED_PACKAGES].sort())
})

test('broken junction dir becomes broken pseudo-node + warning', () => {
  const broken = graph.nodes.filter((n) => n.kind === 'broken')
  assert.deepEqual(broken.map((n) => n.id), ['broken:@deepseek-ai/pkg-broken'])
  assert.ok(graph.warnings.some((x) => x.type === 'unreadable' && x.path.includes('pkg-broken')))
})

test('referenced-but-absent name warns missing-install; commented names do not', () => {
  assert.ok(graph.warnings.some((x) => x.type === 'missing-install' && x.message.includes('@deepseek-ai/ghost')))
  assert.ok(!graph.warnings.some((x) => x.message?.includes('commented-out-plugin')))
})

test('profile virtual nodes exist with group profiles', () => {
  const p = graph.nodes.find((n) => n.id === 'profile:web')
  assert.equal(p.kind, 'profile'); assert.equal(p.group, 'profiles')
})

test('groups derived from repository.directory; plugin/broken/profile groups', () => {
  const g = Object.fromEntries(graph.groups.map((x) => [x.id, x.packageCount]))
  assert.equal(g.bundle, 1); assert.equal(g.core, 1); assert.equal(g.util, 2)
  assert.equal(g.plugin, 2); assert.equal(g.broken, 1); assert.equal(g.ungrouped, 1) // extra 无 repository
  assert.equal(g.profiles, 1)
})

test('description: core zh from README.zh front-matter; plugin-x zh from README prose', () => {
  const core = graph.nodes.find((n) => n.id === '@deepseek-ai/core@1.0.0')
  assert.equal(core.description, '核心内核')
  const px = graph.nodes.find((n) => n.id === 'plugin-x@1.0.0')
  assert.equal(px.description, 'X 插件。')
})

test('scope classification', () => {
  const base = graph.nodes.find((n) => n.id === '@deepseek-ai/base@1.0.0')
  const px = graph.nodes.find((n) => n.id === 'plugin-x@1.0.0')
  assert.equal(base.scope, 'official'); assert.equal(px.scope, 'third-party')
})

test('resolveDshHome precedence with injected env', () => {
  const saved = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '   '
    assert.match(resolveDshHome(), /(\.dsh|tmp)/)
    assert.equal(resolveDshHome('D:/explicit'), 'D:\\explicit')
    process.env.DSH_HOME = 'D:/env-home'
    assert.equal(resolveDshHome(), 'D:\\env-home')
    assert.equal(resolveDshHome('D:/explicit'), 'D:\\explicit')
  } finally { if (saved === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = saved }
})
