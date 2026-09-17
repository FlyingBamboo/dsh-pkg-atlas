import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { CATEGORIES } from '../lib/categories.js'
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

// ==================== Task V2：并行化 + 进度状态机 + category 契约增量 ====================
//
// 裁决 R30（V3 已废止）：原裁决称 scan() 不存在可注入的失败面、failed 无测试只能源码审查。
// 前提是假的：非字符串 dshHome 会让 scan() 首行的 path.join 同步抛 TypeError——failed 真实
// 可达，见文末 V3 测试钉（rejects + state:'failed' + error 只有码）。rejection 分支置
// failed 后继续 throw（v1 throw 语义不变）、下一次 get() 复位重试，这两条语义不变。

const GOLDEN_URL = new URL('./golden/scan-fixture.json', import.meta.url)
const PHASES = ['listing', 'manifests', 'assembling', 'done']
const CATEGORY_IDS = ['kernel', 'session', 'llm', 'tools', 'orchestration', 'integration', 'ui', 'platform', 'infra', 'plugin', 'profiles', 'broken', 'ungrouped']

/** 相邻同名 phase 折叠成一段：断言「四阶段各恰出现一次，且按全序推进、不回跳不打断」。 */
const phaseRuns = (events) => events.map((e) => e.phase).filter((p, i, a) => i === 0 || a[i - 1] !== p)

/**
 * golden 的 `_dir` 是生成当时那台临时 home 的绝对路径，等价性测试必然用另一台新临时
 * home——先把 golden 的 home 根换成当前根再比对。根从 golden 自身反推（`_dir` 去掉
 * `path` 去掉 `$DSH_HOME` 标签后的尾段），不硬编码，golden 重生成也不失效。
 * 替换在 JSON 原文上做，故两侧都要用 JSON 转义后的形态（原文里反斜杠是双写的）。
 * 其余字段（含 warnings/nodes.path 的 `$DSH_HOME` 展示路径）与 home 无关，零处理。
 */
function goldenReplanted(text, home) {
  const golden = JSON.parse(text)
  const probe = golden.nodes.find((n) => typeof n._dir === 'string' && typeof n.path === 'string')
  assert.ok(probe, 'golden 必须含带 _dir 的探针节点')
  assert.ok(probe.path.startsWith('$DSH_HOME'), `probe.path 必须以 $DSH_HOME 标签开头（tail 切片推导的前提）: ${probe.path}`)
  const tail = probe.path.slice('$DSH_HOME'.length)
  const root = probe._dir.slice(0, probe._dir.length - tail.length)
  assert.ok(isAbsolute(root), `golden home 根必须是绝对路径: ${root}`)
  const esc = (v) => JSON.stringify(v).slice(1, -1)
  // 强「真的命中」：原文里 root 只以各 _dir 节点值的前缀出现（展示路径全是 $DSH_HOME 标签），
  // 替换次数必须恰等于带 _dir 的节点数——少了是 root 反推没命中，多了是误伤别的字段。
  const dirNodes = golden.nodes.filter((x) => typeof x._dir === 'string').length
  const hits = text.split(esc(root)).length - 1
  assert.equal(hits, dirNodes, `root 替换次数必须等于带 _dir 节点数 ${dirNodes}，实测 ${hits}`)
  const replanted = JSON.parse(text.split(esc(root)).join(esc(home)))
  return replanted
}

/** R27：等价性只钉 v1 字段——比对前剥掉 generatedAt 与 v2 增量（顶层 categories / node.category / groups[].category）。 */
const stripForGolden = ({ generatedAt, categories, ...rest }) => ({
  ...rest,
  nodes: rest.nodes.map(({ category, ...n }) => n),
  groups: rest.groups.map(({ category, ...g }) => g),
})

test('V2 等价性：并行 scan 与 v1 golden 逐字段一致（含节点/边数组序，R27 剥增量字段）', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-eq-'))
  try {
    await buildFixture(h)
    const g = await scan({ dshHome: h })
    assert.ok(g.generatedAt, 'generatedAt 仍须存在（仅比对前剔除）')
    // 先确认 R27 要剥的增量字段确实在（字段丢了的输出剥完也能“等价”，那是假绿）
    assert.ok(Array.isArray(g.categories), '顶层 categories 必须在')
    assert.ok(g.nodes.every((n) => 'category' in n), '每个 node.category 必须在')
    assert.ok(g.groups.every((x) => 'category' in x), '每个 groups[].category 必须在')
    assert.deepEqual(stripForGolden(g), goldenReplanted(await readFile(GOLDEN_URL, 'utf8'), h))
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('V2 mapLimit：槽位保序 + 并发上限 + 空输入/超限（并发核单元钉，同 withinDir 先例导出）', async () => {
  const { mapLimit } = scanMod
  assert.equal(typeof mapLimit, 'function', 'scan.js 必须导出 mapLimit')
  const items = [0, 1, 2, 3, 4, 5, 6, 7, 8]
  let live = 0
  let peak = 0
  // 越靠后的项越早完成：不保序的实现（push 完成结果）会在这里给出反序数组
  const out = await mapLimit(items, 3, async (i) => {
    live += 1
    if (live > peak) peak = live
    await new Promise((r) => setTimeout(r, (items.length - i) * 3))
    live -= 1
    return `v${i}`
  })
  assert.deepEqual(out, items.map((i) => `v${i}`), '结果必须按输入槽位落位，与完成顺序无关')
  assert.ok(peak <= 3, `并发上限 3，实测峰值 ${peak}`)
  assert.ok(peak >= 2, `limit 3 至少该有并行度，实测峰值 ${peak}`)
  assert.deepEqual(await mapLimit([], 4, async () => 1), [], '空输入 => 空输出，不启动 worker')
  assert.deepEqual(await mapLimit([1, 2], 16, async (x) => x * 2), [2, 4], 'limit > 项数 合法')
  await assert.rejects(mapLimit([1, 2, 3], 2, async (x) => { if (x === 2) throw new Error('boom') }), /boom/,
    'fn 抛错必须向上传播（scan 的 throw 语义不被并发核吞掉）')
})

test('V2 进度：phase 恰一次全序推进、scanned 单调不减、total 恒为目录宇宙数、末次 scanned===total', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-prog-'))
  try {
    await buildFixture(h)
    const events = []
    const g = await scan({ dshHome: h, onProgress: (p) => events.push(p) })
    assert.ok(events.length > 0, 'onProgress 必须被调用')
    for (const e of events) {
      assert.ok(PHASES.includes(e.phase), `未知 phase: ${e.phase}`)
      assert.equal(typeof e.scanned, 'number')
      assert.equal(typeof e.total, 'number')
      assert.ok(e.scanned >= 0 && e.total >= e.scanned, `计数越界: ${JSON.stringify(e)}`)
    }
    assert.deepEqual(phaseRuns(events), PHASES, 'listing→manifests→assembling→done 各恰一次')
    // 宇宙 = manifests 事件数（每扫到一个目录恰一事件）。候选目录塌缩到同一节点 id
    // 是合法的（R15：pnpm 把同一包链进多层，last-wins；broken 同 ref 去重），非 profile
    // 节点数可以小于宇宙，绝不能在此断言相等——合法 R15 fixture 会把等值断言打挂。
    const n = events.filter((e) => e.phase === 'manifests').length
    const nonProfile = g.nodes.filter((x) => x.kind !== 'profile').length
    assert.ok(nonProfile > 0)
    assert.ok(events.every((e) => e.total === n), `total 必须恒等于 manifests 事件数（实扫目录宇宙数）${n}`)
    assert.ok(nonProfile <= n, `非 profile 节点数不得超过目录宇宙数 ${n}，实测 ${nonProfile}`)
    for (let i = 1; i < events.length; i += 1) {
      assert.ok(events[i].scanned >= events[i - 1].scanned, `scanned 回退: ${JSON.stringify(events[i - 1])} → ${JSON.stringify(events[i])}`)
    }
    assert.equal(events[0].phase, 'listing')
    assert.equal(events[0].scanned, 0, 'listing 事件给出 total，scanned 从 0 起（否则单调性被自己打破）')
    assert.deepEqual(events.filter((e) => e.phase === 'manifests').map((e) => e.scanned),
      Array.from({ length: n }, (_, i) => i + 1), '每完成一个目录一个 manifests 事件，计数 1..n')
    const last = events.at(-1)
    assert.equal(last.phase, 'done')
    assert.equal(last.scanned, n)
    assert.equal(last.total, n)
    assert.deepEqual(events.filter((e) => e.phase === 'assembling').map((e) => [e.scanned, e.total]), [[n, n]])
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('V2 进度：零目录宇宙（空 home）也走完四阶段各一次 0/0', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-prog0-'))
  try {
    const events = []
    await scan({ dshHome: h, onProgress: (p) => events.push(p) })
    assert.deepEqual(phaseRuns(events), PHASES)
    assert.equal(events.length, 4, '无作业时每阶段恰一事件')
    for (const e of events) assert.deepEqual([e.scanned, e.total], [0, 0])
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('V2 scanner.status()：idle → scanning（并发 get 共享单次扫描）→ ready 带计数与时间戳', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-status-'))
  try {
    await buildFixture(h)
    const scanner = createScanner({ dshHome: h })
    assert.deepEqual(scanner.status(), { state: 'idle', phase: null, scanned: 0, total: 0, startedAt: null, finishedAt: null, error: null })
    const both = Promise.all([scanner.get(), scanner.get()]) // 同步进入 scanning
    const mid = scanner.status()
    assert.equal(mid.state, 'scanning')
    assert.equal(mid.error, null)
    assert.equal(mid.finishedAt, null)
    assert.equal(typeof mid.startedAt, 'number')
    assert.ok(mid.phase === null || PHASES.includes(mid.phase), `在飞 phase 非法: ${mid.phase}`)
    const [a, b] = await both
    assert.equal(a, b, '并发两个 get 必须共享同一次扫描（同一对象）')
    const st = scanner.status()
    assert.equal(st.state, 'ready')
    assert.equal(st.phase, 'done')
    assert.equal(st.error, null)
    assert.equal(typeof st.finishedAt, 'number')
    assert.ok(st.finishedAt >= st.startedAt)
    assert.ok(st.total > 0)
    assert.equal(st.scanned, st.total, 'ready 必须计满')
    // total 是目录宇宙数而非节点数：多层同包目录 last-wins 塌缩成单节点（R15）时
    // 节点数 < 宇宙是合法的，只能钉 ≤（宇宙===manifests 事件数由进度测试钉）。
    assert.ok(a.nodes.filter((x) => x.kind !== 'profile').length <= st.total,
      `非 profile 节点数不得超过宇宙数 ${st.total}`)
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('V2 scanner.status() 返回浅拷贝：外部改不动内部状态', () => {
  const scanner = createScanner({ dshHome: join(tmpdir(), 'atlas-status-copy-none') }) // 不建目录：全程不扫描
  const snap = scanner.status()
  snap.state = 'hacked'
  snap.scanned = 9999
  snap.error = 'leaked-stack'
  assert.notEqual(scanner.status(), snap, '每次调用必须给新对象')
  assert.deepEqual(scanner.status(), { state: 'idle', phase: null, scanned: 0, total: 0, startedAt: null, finishedAt: null, error: null })
})

test('V2 status() 在 refresh 重扫时重新推进（ready→scanning→ready，error 复位）', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-status-refresh-'))
  try {
    await buildFixture(h)
    const scanner = createScanner({ dshHome: h })
    await scanner.get()
    assert.equal(scanner.status().state, 'ready')
    await writeFile(join(h, 'profiles/web/node_modules/plugin-x/package.json'),
      JSON.stringify({ name: 'plugin-x', version: '1.0.1' }), 'utf8')
    const p = scanner.get(true)
    const mid = scanner.status()
    assert.equal(mid.state, 'scanning', 'refresh 必须让 status 重新进入 scanning')
    assert.equal(mid.scanned, 0, '重扫从零重新计数')
    assert.equal(mid.error, null)
    await p
    assert.equal(scanner.status().state, 'ready')
    assert.equal(scanner.status().phase, 'done')
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

test('V2 category 契约：node.category、groups[].category、顶层 categories（13，kernel 首位）', () => {
  const node = (id) => graph.nodes.find((x) => x.id === id)
  // 组→大类走 lib/categories.js（V1）：bundle/core→kernel，util→infra，未知组→ungrouped 兜底
  assert.equal(node('@deepseek-ai/base@1.0.0').category, 'kernel')
  assert.equal(node('@deepseek-ai/core@1.0.0').category, 'kernel')
  assert.equal(node('@deepseek-ai/util@2.0.0').category, 'infra')
  assert.equal(node('@deepseek-ai/extra@1.0.0').category, 'ungrouped') // 无 repository → ungrouped 组
  assert.equal(node('@deepseek-ai/escaper@1.0.0').category, 'ungrouped') // escaper 组不在映射表 → 兜底
  assert.equal(node('plugin-x@1.0.0').category, 'plugin') // 第三方目录组包走组 category（plugin）
  assert.equal(node('patched-plugin@0.1.0').category, 'plugin')
  assert.equal(node('broken:@deepseek-ai/pkg-broken').category, 'broken')
  assert.equal(node('profile:web').category, 'profiles')
  assert.deepEqual(Object.fromEntries(graph.groups.map((g) => [g.id, g.category])), {
    bundle: 'kernel', core: 'kernel', escaper: 'ungrouped', ungrouped: 'ungrouped', loop: 'ungrouped',
    broken: 'broken', util: 'infra', plugin: 'plugin', profiles: 'profiles',
  })
  // 结构不变量：每个节点的 category 与它所属组的 category 一致，且必属 13 大类
  const groupCat = Object.fromEntries(graph.groups.map((g) => [g.id, g.category]))
  for (const n of graph.nodes) {
    assert.equal(n.category, groupCat[n.group], `${n.id} 的 category 与其组不符`)
    assert.ok(CATEGORY_IDS.includes(n.category), `${n.id} 的 category 不在 13 大类内: ${n.category}`)
  }
  assert.equal(graph.categories.length, 13)
  assert.equal(graph.categories[0].id, 'kernel')
  assert.deepEqual(graph.categories.map((c) => c.id), CATEGORY_IDS)
  for (const c of graph.categories) assert.ok(c.zh && c.en, `${c.id} 缺双语标签`)
})

test('V2 顶层 categories 是本次扫描自有副本：跨 scan 与 lib/categories.js 常量互不串味', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-cats-'))
  try {
    await buildFixture(h)
    const g1 = await scan({ dshHome: h })
    const g2 = await scan({ dshHome: h })
    assert.deepEqual(g1.categories, CATEGORIES)
    assert.notEqual(g1.categories, g2.categories, '两次扫描不得共享同一数组引用')
    assert.notEqual(g1.categories[0], CATEGORIES[0], '条目对象也不得共享引用（下游改动不得回写模块常量）')
    g1.categories[0].id = 'tampered'
    g1.categories.length = 0
    assert.deepEqual((await scan({ dshHome: h })).categories.map((c) => c.id), CATEGORY_IDS, '下一次扫描不受污染')
    assert.equal(CATEGORIES[0].id, 'kernel', 'lib/categories.js 的模块常量不得被外部改动波及')
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})

// ==================== Task V3：scan 层承接项（token 防串扰 + failed 可达性） ====================

/** 测试专用：纯 @deepseek-ai 包目录宇宙（official 整体入场，无需 profile）。
 *  小 fixture 下重叠两扫描近同步推进、共享 status 的写入几乎永不相同值——串扰症状
 *  （ready + 半程计数）只有宇宙够大、扫描间产生真实漂移后才可被宏观任务采样观测到。 */
async function buildDirUniverse(root, n) {
  const nm = join(root, 'profiles/node_modules/@deepseek-ai')
  for (let i = 0; i < n; i += 1) {
    const id = `pkg-${String(i).padStart(3, '0')}`
    await mkdir(join(nm, id), { recursive: true })
    await writeFile(join(nm, id, 'package.json'), JSON.stringify({ name: `@deepseek-ai/${id}`, version: '1.0.0' }), 'utf8')
  }
}

test('V3 failed 可达：非字符串 dshHome → scan 同步抛 → rejects + state:failed（error 只有码，无路径/栈）', async () => {
  // V2 复审承接项 2（R30 废止）：path.join(42,'profiles') 在 scan() 体内第一行同步抛
  // TypeError——async 吞进 rejection，是 scan 唯一天然失败面（其余读路径都被 safe 吞掉）。
  const scanner = createScanner({ dshHome: 42 })
  await assert.rejects(scanner.get(), TypeError)
  const st = scanner.status()
  assert.deepEqual(Object.keys(st).sort(), ['error', 'finishedAt', 'phase', 'scanned', 'startedAt', 'state', 'total'].sort())
  assert.equal(st.state, 'failed')
  assert.equal(st.error, 'scan-failed')
  assert.equal(st.phase, null) // 先于任何 emit 就抛了：连 listing 都不曾出现
  assert.equal(st.scanned, 0)
  assert.equal(st.total, 0)
  assert.equal(typeof st.startedAt, 'number')
  assert.equal(typeof st.finishedAt, 'number')
  assert.ok(st.finishedAt >= st.startedAt)
  // X- 泄漏纪律：整个快照只含基元，无绝对路径/盘符片段（error 只放码不放消息）
  assert.ok(!JSON.stringify(st).includes(':\\'), `泄漏嫌疑: ${JSON.stringify(st)}`)
  // 同一 scanner 可反复重试：再 get 仍 rejects（下一次 get 复位 scanning 后重新失败，V2 复位语义不变）
  await assert.rejects(scanner.get(), TypeError)
  assert.equal(scanner.status().state, 'failed')
})

test('V3 scan token 防串扰：多 refresh 在飞不混写 status，终态属最后启动的扫描', async () => {
  const h = await mkdtemp(join(tmpdir(), 'atlas-token-'))
  try {
    await buildDirUniverse(h, 150)
    const scanner = createScanner({ dshHome: h })
    // 重叠的构造（承接项 1）：先种一个在飞 scan，再让两个 get(true) 排到**同一个** inflight 上。
    // 它落定后两条 refresh 续体在同一个微任务排空里各自 startScan()——refresh 分支 await 之后
    // 不复检 inflight，第二次 scan 在第一次仍处飞行时启动：两个 onProgress 写手同时挂上
    // 共享 status。（严格说，只发两个 get(true) 且无在先 inflight 时 await 会把它们串行化；
    // 「快速连点重扫」的页面形态——首轮扫描在飞时双击——正是这里的 p0 + p1/p2 形状。）
    const p0 = scanner.get()
    const p1 = scanner.get(true)
    const p2 = scanner.get(true)
    const corrupt = []
    let samples = 0
    let maxStartedAtSeen = 0
    let stop = false
    const poll = () => {
      if (stop) return
      const s = scanner.status()
      samples += 1
      // 观测面 1：ready 快照永不得被另一扫描的半程进度污染。无 token 守卫的基线上，
      //   同形状竞态实测出过 {state:'ready', phase:'manifests', scanned:295, total:300}
      //   与 scanning 态内 scanned 回退（RED 证据见 task-V3-report.md）。
      if (s.state === 'ready' && (s.phase !== 'done' || s.scanned !== s.total)) corrupt.push(s)
      // 观测面 2：'done' 与终态 .then 之间无宏观任务边界（纯微任务链），宏观采样器不得
      //   观测到 state 仍 scanning 而 phase 已 done。
      if (s.state === 'scanning' && s.phase === 'done') corrupt.push(s)
      if (typeof s.startedAt === 'number' && s.startedAt > maxStartedAtSeen) maxStartedAtSeen = s.startedAt
      setImmediate(poll)
    }
    poll()
    const [, g1, g2] = await Promise.all([p0, p1, p2])
    await new Promise((r) => setTimeout(r, 20)) // 让任何迟到的 superseded 事件先落地再停采
    stop = true
    assert.ok(samples > 50, `采样过少，竞态未真正展开: ${samples}`)
    assert.deepEqual(corrupt, [], `出现串扰快照: ${JSON.stringify(corrupt.slice(0, 3))}`)
    assert.notEqual(g1, g2, '两次 refresh 都真实扫描（竞态真实存在，测试非空洞）')
    const st = scanner.status()
    assert.equal(st.state, 'ready')
    assert.equal(st.phase, 'done')
    assert.equal(st.scanned, st.total)
    assert.ok(st.total >= 150, `目录宇宙缩水: ${st.total}`)
    // 「终态属最后启动的扫描」：startedAt 只在 startScan 的复位块写，最后启动者 token 最大且
    // 复位最晚——终态 startedAt 必须等于采样所见最大值；superseded 扫描的终态 .then 被 token
    // 拦截，不得回写 state/finishedAt。
    assert.equal(st.startedAt, maxStartedAtSeen)
    // 构造性质（承接项 1 的明示）：守卫后仅 myToken===scanSeq 可写 status，新扫描复位与换 token
    // 同步原子完成（采样器不可能撕开中间态），单扫描内 scanned 1..n 单调由 V2 进度测试钉死
    // ——故「扫描进行中 scanned 回退」在守卫后**构造上不可能**，不对其做时序依赖的采样断言；
    // 上面观测面 1/2 是该构造性质在宏观采样下的可观测量，且在无守卫基线上已被实测违反。
  } finally {
    await rm(h, { recursive: true, force: true })
  }
})
