import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixture, EXPECTED_PACKAGES } from './fixtures.mjs'
import { scan, resolveDshHome, createScanner } from '../lib/scan.js'

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

// ---- Task 5: dependency edges, mount surface, mountedBy ----

test('dep edge resolves to highest satisfying version (util ^2 -> 2.0.0)', () => {
  const e = graph.edges.find((x) => x.from === 'plugin-x@1.0.0' && x.kind === 'dep' && x.to.startsWith('@deepseek-ai/util@'))
  assert.equal(e.to, '@deepseek-ai/util@2.0.0'); assert.equal(e.unsatisfied, undefined)
})

test('dep edge resolves caret range to best match among versions (base ^1 -> util 1.0.0)', () => {
  const e = graph.edges.find((x) => x.from === '@deepseek-ai/base@1.0.0' && x.kind === 'dep' && x.to.startsWith('@deepseek-ai/util@'))
  assert.equal(e.to, '@deepseek-ai/util@1.0.0')
})

test('optional peer -> peer-optional edge', () => {
  const e = graph.edges.find((x) => x.from === 'plugin-x@1.0.0' && x.to === '@deepseek-ai/core@1.0.0')
  assert.equal(e.kind, 'peer-optional')
})

test('universe-external dep excluded from edges and listed in externalDeps', () => {
  const px = graph.nodes.find((n) => n.id === 'plugin-x@1.0.0')
  assert.deepEqual(px.externalDeps, [{ name: 'lodash', range: '^4.0.0' }])
  assert.ok(!graph.edges.some((x) => x.to.startsWith('lodash@')))
})

test('mount edges: profile -> bundles/deps, bundle BFS -> members', () => {
  const mounts = graph.edges.filter((x) => x.kind === 'mount').map((x) => `${x.from}->${x.to}`)
  assert.ok(mounts.includes('profile:web->@deepseek-ai/base@1.0.0'))
  assert.ok(mounts.includes('profile:web->plugin-x@1.0.0'))
  assert.ok(mounts.includes('@deepseek-ai/base@1.0.0->@deepseek-ai/core@1.0.0'))
  assert.ok(mounts.includes('profile:web->@deepseek-ai/extra@1.0.0'))   // 用户 patch insert extra
  assert.ok(mounts.includes('profile:web->patched-plugin@0.1.0'))       // 共享层第三方经 patch 挂载
})

test('mountedBy propagates; unmounted older version stays empty', () => {
  assert.deepEqual(graph.nodes.find((n) => n.id === '@deepseek-ai/core@1.0.0').mountedBy, ['web'])
  assert.deepEqual(graph.nodes.find((n) => n.id === '@deepseek-ai/util@2.0.0').mountedBy, ['web'])
  assert.deepEqual(graph.nodes.find((n) => n.id === '@deepseek-ai/util@1.0.0').mountedBy, [])
})

test('mountedBy dedupes across multiple mount paths of one profile', () => {
  // base 同时经 bundles 行 + dependencies 行可达；extra 同时经用户 patch + base bundle patch BFS 可达
  assert.deepEqual(graph.nodes.find((n) => n.id === '@deepseek-ai/base@1.0.0').mountedBy, ['web'])
  assert.deepEqual(graph.nodes.find((n) => n.id === '@deepseek-ai/extra@1.0.0').mountedBy, ['web'])
})

test('mount seed edge honors profile declared range; unsatisfied when nothing satisfies (§6.5 / R17)', () => {
  // profiles/web 声明 patched-plugin ^9.0.0，装机只有 0.1.0：maxSatisfying 挂最高版 + satisfied:false
  const e = graph.edges.find((x) => x.from === 'profile:web' && x.kind === 'mount' && x.to === 'patched-plugin@0.1.0')
  assert.ok(e, 'profile:web -> patched-plugin@0.1.0 mount 边应存在')
  assert.equal(e.unsatisfied, true)
})

test('bundle patch escaping the package dir is refused and warned (Windows lexical guard)', () => {
  // escaper 的 dsh.bundle.patch = '../escape.yml'：resolve 落在 @deepseek-ai/ 层，
  // 守卫拒绝（parse-fail 越界）且不读文件，故不得产生任何 mount 展开边
  const esc = graph.edges.filter((x) => x.from === '@deepseek-ai/escaper@1.0.0' && x.kind === 'mount')
  assert.deepEqual(esc.map((x) => x.to), [])
  const w = graph.warnings.find((x) => x.type === 'parse-fail' && x.path.includes('escaper'))
  assert.ok(w, '应有 parse-fail warning 指向 escaper')
  assert.match(w.message, /路径越出包目录/)
  assert.ok(w.message.includes('../escape.yml'))
})

test('plugin own patch members are NOT expanded (v1 boundary)', () => {
  assert.ok(!graph.edges.some((x) => x.from === 'plugin-x@1.0.0' && x.kind === 'mount'))
})

test('createScanner serves cache then honors refresh', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-cache-'))
  await buildFixture(h)
  const scanner = createScanner({ dshHome: h })
  const g1 = await scanner.get()
  assert.equal((await scanner.get()).generatedAt, g1.generatedAt)
  await writeFile(join(h, 'profiles/web/node_modules/plugin-x/package.json'),
    JSON.stringify({ name: 'plugin-x', version: '1.0.1' }), 'utf8')
  assert.equal((await scanner.get()).generatedAt, g1.generatedAt) // still cached (TTL)
  const g3 = await scanner.get(true)
  assert.notEqual(g3.generatedAt, g1.generatedAt)
  assert.ok(g3.nodes.some((n) => n.id === 'plugin-x@1.0.1'))
  await rm(h, { recursive: true, force: true })
})
