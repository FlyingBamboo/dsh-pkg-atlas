import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compareVersions, maxSatisfying } from '../lib/semver.js'

test('compareVersions core + prerelease-aware', () => {
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0)
  assert.ok(compareVersions('0.1.5-rc.1', '0.1.5') < 0)
  assert.ok(compareVersions('0.1.5-rc.2', '0.1.5-rc.1') > 0)
})

test('exact string hit wins (rc ecosystem)', () => {
  assert.deepEqual(maxSatisfying(['0.1.5-rc.1', '0.1.4'], '^0.1.5-rc.1'),
    { version: '0.1.5-rc.1', satisfied: true })
})

test('caret tilde gte range star', () => {
  const v = ['0.9.0', '1.0.0', '1.4.0', '2.0.0']
  assert.deepEqual(maxSatisfying(v, '^1.0.0'), { version: '1.4.0', satisfied: true })
  assert.deepEqual(maxSatisfying(v, '~1.0.0'), { version: '1.0.0', satisfied: true })
  assert.deepEqual(maxSatisfying(v, '>=1.4.0'), { version: '2.0.0', satisfied: true })
  assert.deepEqual(maxSatisfying(v, '*'), { version: '2.0.0', satisfied: true })
  assert.deepEqual(maxSatisfying(v, ''), { version: '2.0.0', satisfied: true })
  assert.deepEqual(maxSatisfying(v, '^3.0.0'), { version: '2.0.0', satisfied: false })
  assert.equal(maxSatisfying([], '^1.0.0'), null)
})

test('caret 0.x semantics and or-ranges', () => {
  assert.deepEqual(maxSatisfying(['0.2.9', '0.3.0'], '^0.2.9'), { version: '0.2.9', satisfied: true })
  assert.deepEqual(maxSatisfying(['1.0.0', '3.1.0'], '^1.0.0 || ^3.0.0'), { version: '3.1.0', satisfied: true })
})

test('or-range returns highest satisfier across ALL alternatives', () => {
  assert.deepEqual(maxSatisfying(['1.4.0', '3.1.0'], '^3.0.0 || ^1.0.0'),
    { version: '3.1.0', satisfied: true })
})

test('or-range with no satisfier still falls back to attach-highest', () => {
  assert.deepEqual(maxSatisfying(['1.0.0', '2.0.0'], '^5.0.0 || ^9.0.0'),
    { version: '2.0.0', satisfied: false })
})

test('intentional divergence: caret on 0.x base is rc-tolerant for DSH rc ecosystem', () => {
  assert.deepEqual(maxSatisfying(['0.1.5', '0.1.6-rc.1'], '^0.1.5'),
    { version: '0.1.6-rc.1', satisfied: true })
})

test('opaque descriptor ranges (github:/link:/workspace:/URL) attach max as satisfied (R23)', () => {
  assert.deepEqual(maxSatisfying(['1.6.0'], 'github:bradegithub/dsh-plugins-marketplace'),
    { version: '1.6.0', satisfied: true })
  assert.deepEqual(maxSatisfying(['1.0.0', '2.0.0'], 'workspace:*'),
    { version: '2.0.0', satisfied: true })
  assert.deepEqual(maxSatisfying(['1.2.3'], 'git+ssh://git@example.com/x.git'),
    { version: '1.2.3', satisfied: true })
  assert.deepEqual(maxSatisfying(['1.0.0'], 'https://example.com/x.tgz'),
    { version: '1.0.0', satisfied: true })
  // genuine semver violation still flags unsatisfied
  assert.deepEqual(maxSatisfying(['1.6.0'], '^2.0.0'),
    { version: '1.6.0', satisfied: false })
})
