import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildFixture, EXPECTED_PACKAGES } from './fixtures.mjs'
// 命名空间导入：新导出（withinDir）缺失时只让该测试断言失败，不炸整个文件（RED 可读性）
import * as scanMod from '../lib/scan.js'
const { scan, resolveDshHome, createScanner } = scanMod

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

// ---- 复审修复轮 (post-review) ----

const isWin = process.platform === 'win32'

test('withinDir: inside / equal / escaped / sibling-prefix trap / per-platform case rules (I-1)', () => {
  const withinDir = scanMod.withinDir
  assert.equal(typeof withinDir, 'function', 'scan.js 必须导出 withinDir')
  const sep = isWin ? '\\' : '/'
  const base = isWin ? 'D:\\pkgs\\pkg' : '/pkgs/pkg'
  assert.equal(withinDir(base, `${base}${sep}sub${sep}cordis.patch.yml`), true) // 子目录 => inside
  assert.equal(withinDir(base, base), true) // 相等 => inside-equal
  assert.equal(withinDir(base, `${base}${sep}..${sep}escape.yml`), false) // '../' 越出
  // 兄弟前缀陷阱：startsWith 会说 D:\pkg2（或 /pkg2）在 D:\pkg（或 /pkg）之内——relative 不会
  assert.equal(withinDir(base, isWin ? 'D:\\pkgs\\pkg2\\cordis.patch.yml' : '/pkgs/pkg2/cordis.patch.yml'), false)
  if (isWin) {
    assert.equal(withinDir('D:\\PKGS\\pkg', 'd:\\pkgs\\PKG\\sub\\f.yml'), true) // Windows 大小写不敏感
    assert.equal(withinDir('D:\\pkgs\\pkg', 'C:\\pkgs\\pkg\\sub\\f.yml'), false) // 换盘符 => relative 绝对 => out
  } else {
    assert.equal(withinDir('/pkgs/pkg', '/pkgs/PKG/sub/f.yml'), false) // POSIX 大小写敏感
  }
})

test('referenced broken dir: unreadable warning only, NO false missing-install (I-2)', () => {
  // pkg-broken 现被 profile patch 点名引用（fixtures p5 行）
  assert.ok(graph.warnings.some((x) => x.type === 'unreadable' && x.path.includes('pkg-broken')),
    'unreadable 警告必须在')
  assert.ok(!graph.warnings.some((x) => x.type === 'missing-install' && x.message.includes('pkg-broken')),
    '目录真实存在（只是读不到 package.json），missing-install 是假警报')
  // ghost（真不存在）仍须 missing-install——回归面确认
  assert.ok(graph.warnings.some((x) => x.type === 'missing-install' && x.message.includes('@deepseek-ai/ghost')))
})

test('profiles root absent/empty: honest root-unreadable warning, schema stays ok (I-3, R25)', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-noroot-'))
  try {
    const g = await scan({ dshHome: h }) // 只有临时目录本身，没有 profiles 树
    assert.equal(g.schema, 1)
    assert.deepEqual(g.nodes, [])
    assert.deepEqual(g.profiles, [])
    const w = g.warnings.find((x) => x.type === 'root-unreadable')
    assert.ok(w, '零 profile 必须开 root-unreadable 警告，不得静默空图')
    assert.ok(w.path.includes('$DSH_HOME'), `path 需脱敏: ${w.path}`)
    assert.ok(w.message.length > 0)
    // profiles 存在但为空：同 type，措辞区分「不存在」vs「存在但空/不可读」
    await mkdir(join(h, 'profiles'), { recursive: true })
    const g2 = await scan({ dshHome: h })
    const w2 = g2.warnings.find((x) => x.type === 'root-unreadable')
    assert.ok(w2)
    assert.notEqual(w2.message, w.message)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('mount cycle loop-a ⇄ loop-b: scan returns, each edge exactly once (T-3 pin)', () => {
  // 若 BFS 没有 visited 集，本测试所在文件的 scan()（before 钩子里）根本不返回——挂起即失败。
  const m = (from, to) => graph.edges.filter((x) => x.kind === 'mount' && x.from === from && x.to === to)
  assert.ok(m('profile:web', '@deepseek-ai/loop-a@1.0.0').length >= 1, 'seed 边存在')
  assert.equal(m('@deepseek-ai/loop-a@1.0.0', '@deepseek-ai/loop-b@1.0.0').length, 1)
  assert.equal(m('@deepseek-ai/loop-b@1.0.0', '@deepseek-ai/loop-a@1.0.0').length, 1)
})

test('createScanner single-flight: overlapping get() share one scan; refresh rescans (M-2)', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-sf-'))
  try {
    await buildFixture(h)
    const scanner = createScanner({ dshHome: h })
    const [a, b] = await Promise.all([scanner.get(), scanner.get()])
    assert.equal(a, b, '并发 get() 必须共享同一 in-flight scan（同一对象 => 同 generatedAt）')
    assert.equal(a.generatedAt, b.generatedAt)
    await writeFile(join(h, 'profiles/web/node_modules/plugin-x/package.json'),
      JSON.stringify({ name: 'plugin-x', version: '1.0.1' }), 'utf8')
    const [r, plain] = await Promise.all([scanner.get(true), scanner.get()])
    assert.notEqual(r, a, 'refresh 必须产生新 scan 结果（等在途 scan 结束后重扫）')
    assert.equal(plain, a, 'refresh 在途期间普通 get() 仍可回缓存')
    assert.equal(await scanner.get(), r, 'refresh 结果成为新缓存')
    assert.ok(r.nodes.some((n) => n.id === 'plugin-x@1.0.1'))
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('@types scope excluded even when profile-referenced: no node, no warning (M-9)', () => {
  // profiles/web dependencies 现显式引用 @types/node（fixtures）
  assert.ok(!graph.nodes.some((n) => n.name === '@types/node'), '@types/node 不得成为节点')
  assert.ok(!graph.warnings.some((x) => x.message?.includes('@types/node')),
    '@types 引用在 missing-install 之前就被剔除，不得出现在任何警告里')
})
