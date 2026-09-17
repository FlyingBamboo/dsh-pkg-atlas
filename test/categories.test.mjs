import test from 'node:test'
import assert from 'node:assert/strict'
import { CATEGORY_ORDER, SPECIAL_ZONES, GROUP_TO_CATEGORY, categoryOf, CATEGORIES } from '../lib/categories.js'

const OBSERVED = ['vendor','acp','bundle','core','context','preset','identity','api','boot','util','attachment','credentials','shell','extensions','code-runtime','compaction','feedback','goal','interaction','llm','fs','hooks','host','runtime-diagnostics','jobs','mcp','plan','guard','sandbox','schedule','sdk','session','session-query','settings','skill','spill','storage','subagent','subprocess','terminal','workflow','todo','web','typert','webhook','workspace'] // 实测 45 目录组 + broken/plugin/ungrouped/profiles 走特殊区
test('observed groups all map to a real category', () => {
  for (const g of OBSERVED) {
    const c = categoryOf(g)
    assert.ok(CATEGORY_ORDER.includes(c), `${g} -> ${c} 必须是 9 大类之一`)
  }
})
test('every category non-empty', () => {
  for (const c of CATEGORY_ORDER) {
    assert.ok(Object.values(GROUP_TO_CATEGORY).includes(c), `大类 ${c} 无成员`)
  }
})
test('special zones pass through; unknown falls back', () => {
  for (const z of SPECIAL_ZONES) assert.equal(categoryOf(z.id), z.id)
  assert.equal(categoryOf('brand-new-group'), 'ungrouped')
})
test('CATEGORIES: 13 entries, order = CATEGORY_ORDER + specials, bilingual', () => {
  assert.deepEqual(CATEGORIES.map((c) => c.id), [...CATEGORY_ORDER, ...SPECIAL_ZONES.map((s) => s.id)])
  for (const c of CATEGORIES) assert.ok(c.zh && c.en, `${c.id} 双语标签齐`)
})
test('mapping table exactly covers spec §3', () => {
  const expect = { core:'kernel', boot:'kernel', bundle:'kernel', context:'kernel', preset:'kernel', feedback:'kernel', settings:'kernel', 'runtime-diagnostics':'kernel',
    session:'session','session-query':'session',attachment:'session',compaction:'session',spill:'session',storage:'session',
    llm:'llm',
    fs:'tools',shell:'tools',subprocess:'tools',terminal:'tools','code-runtime':'tools',hooks:'tools',todo:'tools',schedule:'tools',
    subagent:'orchestration',jobs:'orchestration',workflow:'orchestration',goal:'orchestration',plan:'orchestration',skill:'orchestration',
    mcp:'integration',acp:'integration',sdk:'integration',extensions:'integration',webhook:'integration',
    web:'ui',client:'ui',interaction:'ui',workspace:'ui',typert:'ui',
    host:'platform',api:'platform',credentials:'platform',guard:'platform',sandbox:'platform',identity:'platform',
    util:'infra',vendor:'infra' }
  assert.deepEqual(GROUP_TO_CATEGORY, expect)
})
