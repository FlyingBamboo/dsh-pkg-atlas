import { test } from 'node:test'
import assert from 'node:assert/strict'
import { frontMatterDescription, firstProseLine, resolveDescription } from '../lib/roles.js'

const files = (map) => async (p) => {
  const key = p.split(/[\\/]/).slice(-2).join('/')
  return map[key] ?? null
}

test('front-matter description parsed and unquoted', () => {
  const text = '---\nname: x\ndescription: "带引号的: 描述"\n---\n# H1\n'
  assert.equal(frontMatterDescription(text), '带引号的: 描述')
  assert.equal(frontMatterDescription('# no fm\n'), null)
})

test('first prose line skips front-matter, headings, badges', () => {
  const text = '---\ndescription: d\n---\n\n# Title\n[![ci](badge)](url)\n\n真实首句。\n'
  assert.equal(firstProseLine(text), '真实首句。')
  assert.equal(firstProseLine('---\nd: 1\n---\n# Only heading\n'), null)
})

test('zh chain: cordis manifest wins', async () => {
  const { zh } = await resolveDescription(
    { description: 'fallback', '@deepseek-ai/cordis': { description: { zh: '清单中文', en: 'manifest en' } } },
    { dir: 'x', read: files({}) },
  )
  assert.equal(zh, '清单中文')
})

test('zh chain falls back README.zh front-matter before pkg.description', async () => {
  const { zh } = await resolveDescription(
    { description: 'pkg-desc' },
    { dir: 'p', read: files({ 'p/README.zh.md': '---\ndescription: zh-fm\n---\n# T\n' }) },
  )
  assert.equal(zh, 'zh-fm')
})

test('zh chain order: cordis.zh > zh-fm > zh-prose > pkg.description > md-fm > md-prose', async () => {
  const { zh } = await resolveDescription({}, {
    dir: 'p', read: files({
      'p/README.zh.md': '# T\n\nzh 正文行。\n',
      'p/README.md': '---\ndescription: md-fm\n---\n\nmd prose.\n',
    }),
  })
  assert.equal(zh, 'zh 正文行。')
})

test('en chain: pkg.description before README.md prose; zh as last fallback', async () => {
  const { en } = await resolveDescription({ description: 'pkg-desc' }, { dir: 'p', read: files({}) })
  assert.equal(en, 'pkg-desc')
  const r = await resolveDescription({}, { dir: 'p', read: files({ 'p/README.zh.md': '中文正文\n' }) })
  assert.equal(r.en, '中文正文')
})

test('en chain: README.md front-matter beats pkg.description (spec §6.4: README.md before package.json)', async () => {
  const { en } = await resolveDescription(
    { description: 'pkg-desc' },
    { dir: 'p', read: files({ 'p/README.md': '---\ndescription: md-fm\n---\n# T\n' }) },
  )
  assert.equal(en, 'md-fm')
})

test('en chain: README.md without front-matter or meaningful prose falls back to pkg.description', async () => {
  const { en } = await resolveDescription(
    { description: 'pkg-desc' },
    { dir: 'p', read: files({ 'p/README.md': '---\nname: p\n---\n\n# Title\n\n[![ci](badge)](url)\n' }) },
  )
  assert.equal(en, 'pkg-desc')
})

test('all empty -> null', async () => {
  const { zh, en } = await resolveDescription({}, { dir: 'p', read: files({}) })
  assert.equal(zh, null); assert.equal(en, null)
})
