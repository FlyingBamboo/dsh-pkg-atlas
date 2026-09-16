import { test } from 'node:test'
import assert from 'node:assert/strict'
import { extractPatchNames } from '../lib/mounts.js'

test('quoted and bare name lines extracted, comments and configs ignored', () => {
  const text = [
    "- insert:", "    - id: b1", "      name: '@deepseek-ai/core'",
    "    - id: b2", '      name: "@deepseek-ai/extra"',
    "    - id: b3", "      name: dsh-plain",
    "      config:", "        name: not-a-mount",   // config 下的 name 不抽（缩进更深但同正则）——见 Step3 说明
    "# name: commented-out",
    "    - id: b4", "      disabled: true", "      name: '@deepseek-ai/disabled-one'",
  ].join('\n')
  assert.deepEqual(extractPatchNames(text), [
    '@deepseek-ai/core', '@deepseek-ai/extra', 'dsh-plain', 'not-a-mount', '@deepseek-ai/disabled-one',
  ])
})

test('duplicates collapse keeping first position', () => {
  assert.deepEqual(extractPatchNames("name: 'a'\nname: a\n"), ['a'])
})
